import type { ThreadEventWithMeta } from "@bb/thread-view";
import type { TimelineRow } from "@bb/server-contract";
import {
  getDatabaseDataVersion,
  getFirstParentedTimelineBoundarySequence,
  getThreadEventRewriteGeneration,
  hasTimelineGroupingContextRowsInRange,
  listTimelineOrderingContext,
  type DbConnection,
} from "@bb/db";

interface TimelineGroupingContext {
  orderingBoundarySequence: number | null;
  acceptedTurnIds: ReadonlyMap<string, string>;
}

interface TimelineGroupingContextArgs {
  maxSeq: number;
  sequenceStart: number;
  threadId: string;
}

interface TimelineGroupingContextEntry {
  context: TimelineGroupingContext;
  dataVersion: number;
  generation: number;
  maxSeq: number;
}

const GROUPING_CONTEXT_KEY_LIMIT = 128;
const GROUPING_CONTEXT_ENTRIES_PER_KEY = 4;
const GROUPING_CONTEXT_REUSE_SEQUENCE_SPAN = 1024;

const orderingContexts = new WeakMap<
  DbConnection,
  Map<string, TimelineGroupingContextEntry[]>
>();

export function clearTimelineOrderingContextCache(db: DbConnection): void {
  orderingContexts.delete(db);
}

function nearestEntry(
  entries: readonly TimelineGroupingContextEntry[],
  maxSeq: number,
  side: "above" | "below",
): TimelineGroupingContextEntry | undefined {
  let nearest: TimelineGroupingContextEntry | undefined;
  for (const entry of entries) {
    const onSide =
      side === "above" ? entry.maxSeq > maxSeq : entry.maxSeq < maxSeq;
    if (
      onSide &&
      Math.abs(entry.maxSeq - maxSeq) <= GROUPING_CONTEXT_REUSE_SEQUENCE_SPAN &&
      (nearest === undefined ||
        Math.abs(entry.maxSeq - maxSeq) < Math.abs(nearest.maxSeq - maxSeq))
    ) {
      nearest = entry;
    }
  }
  return nearest;
}

function findReusableEntry(
  db: DbConnection,
  args: TimelineGroupingContextArgs,
  entries: readonly TimelineGroupingContextEntry[],
): TimelineGroupingContextEntry | undefined {
  const exact = entries.find((entry) => entry.maxSeq === args.maxSeq);
  if (exact !== undefined) return exact;
  const below = nearestEntry(entries, args.maxSeq, "below");
  if (
    below !== undefined &&
    !hasTimelineGroupingContextRowsInRange(db, {
      afterSequence: below.maxSeq,
      threadId: args.threadId,
      throughSequence: args.maxSeq,
    })
  ) {
    below.maxSeq = args.maxSeq;
    return below;
  }
  const above = nearestEntry(entries, args.maxSeq, "above");
  if (
    above !== undefined &&
    !hasTimelineGroupingContextRowsInRange(db, {
      afterSequence: args.maxSeq,
      threadId: args.threadId,
      throughSequence: above.maxSeq,
    })
  ) {
    return above;
  }
  return undefined;
}

export function getTimelineGroupingContext(
  db: DbConnection,
  args: TimelineGroupingContextArgs,
): TimelineGroupingContext {
  let cache = orderingContexts.get(db);
  if (cache === undefined) {
    cache = new Map();
    orderingContexts.set(db, cache);
  }
  const key = JSON.stringify([args.threadId, args.sequenceStart]);
  const generation = getThreadEventRewriteGeneration(args.threadId);
  const dataVersion = getDatabaseDataVersion(db);
  const entries = (cache.get(key) ?? []).filter(
    (entry) =>
      entry.generation === generation && entry.dataVersion === dataVersion,
  );
  cache.delete(key);
  const reusable = findReusableEntry(db, args, entries);
  if (reusable !== undefined) {
    cache.set(key, [
      reusable,
      ...entries.filter((entry) => entry !== reusable),
    ]);
    return reusable.context;
  }
  const context = computeTimelineGroupingContext(db, args);
  cache.set(key, [
    { context, dataVersion, generation, maxSeq: args.maxSeq },
    ...entries.slice(0, GROUPING_CONTEXT_ENTRIES_PER_KEY - 1),
  ]);
  while (cache.size > GROUPING_CONTEXT_KEY_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  return context;
}

function computeTimelineGroupingContext(
  db: DbConnection,
  args: TimelineGroupingContextArgs,
): TimelineGroupingContext {
  const context = listTimelineOrderingContext(db, args);
  const turns = new Map<string, { start: number; end: number }>();
  const accepted = new Map<string, string>();
  for (const row of context) {
    if (row.turnId === null) continue;
    if (row.type === "turn/input/accepted" && row.clientRequestId !== null)
      accepted.set(row.clientRequestId, row.turnId);
    if (
      row.type === "turn/started" &&
      row.parentToolCallId === null &&
      !turns.has(row.turnId)
    )
      turns.set(row.turnId, { start: row.sequence, end: row.sequence });
    const turn = turns.get(row.turnId);
    if (turn !== undefined) turn.end = row.sequence;
  }
  let boundary = getFirstParentedTimelineBoundarySequence(db, args) ?? Infinity;
  const spans = turns.entries();
  let next = spans.next();
  let longest: { id: string; end: number } | null = null;
  let secondLongestEnd = -Infinity;
  for (const row of context) {
    if (row.sequence >= boundary) break;
    if (
      row.type !== "client/turn/requested" ||
      row.initiator !== "user" ||
      row.requestId === null
    )
      continue;
    while (!next.done && next.value[1].start < row.sequence) {
      const [id, turn] = next.value;
      if (longest === null || turn.end > longest.end) {
        secondLongestEnd = longest?.end ?? -Infinity;
        longest = { id, end: turn.end };
      } else {
        secondLongestEnd = Math.max(secondLongestEnd, turn.end);
      }
      next = spans.next();
    }
    const end =
      longest?.id === accepted.get(row.requestId)
        ? secondLongestEnd
        : (longest?.end ?? -Infinity);
    if (row.sequence < end) {
      boundary = row.sequence;
      break;
    }
  }
  const sequence = Number.isFinite(boundary) ? boundary : null;
  return {
    orderingBoundarySequence: sequence,
    acceptedTurnIds: accepted,
  };
}

export function orderTimelineRowsUsingContext(
  rows: readonly TimelineRow[],
  events: readonly ThreadEventWithMeta[],
  parentedBoundary: number | null,
): TimelineRow[] {
  const turns = new Map<string, { start: number; end: number }>();
  const accepted = new Map<string, string>();
  const requests: { sequence: number; id: string }[] = [];
  for (const { event, meta } of events) {
    if (event.type === "client/turn/requested" && event.initiator === "user") {
      requests.push({ sequence: meta.seq, id: event.requestId });
    }
    if (event.scope.kind !== "turn") continue;
    const turnId = event.scope.turnId;
    if (event.type === "turn/input/accepted")
      accepted.set(event.clientRequestId, turnId);
    if (
      event.type === "turn/started" &&
      !event.parentToolCallId &&
      !turns.has(turnId)
    ) {
      turns.set(turnId, { start: meta.seq, end: meta.seq });
    }
    const turn = turns.get(turnId);
    if (turn) turn.end = Math.max(turn.end, meta.seq);
  }
  let boundary = parentedBoundary ?? Infinity;
  for (const [turnId, turn] of turns) {
    for (const request of requests) {
      if (request.sequence >= boundary || request.sequence >= turn.end) break;
      if (
        request.sequence > turn.start &&
        accepted.get(request.id) !== turnId
      ) {
        boundary = request.sequence;
        break;
      }
    }
  }
  const index = rows.findIndex((row) => row.sourceSeqStart >= boundary);
  if (index < 0) return [...rows];
  return [
    ...rows.slice(0, index),
    ...rows
      .slice(index)
      .sort(
        (left, right) =>
          left.sourceSeqStart - right.sourceSeqStart ||
          left.sourceSeqEnd - right.sourceSeqEnd,
      ),
  ];
}
