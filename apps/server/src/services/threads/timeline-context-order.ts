import type { TimelineRow } from "@bb/server-contract";
import {
  isExternalUserBoundaryForTurn,
  type ExternalUserBoundaryMessage,
  type ExternalUserBoundaryTurnSpan,
} from "@bb/thread-view";
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
  if (cache.size > GROUPING_CONTEXT_KEY_LIMIT) {
    cache.delete(cache.keys().next().value!);
  }
  return context;
}

function computeTimelineGroupingContext(
  db: DbConnection,
  args: TimelineGroupingContextArgs,
): TimelineGroupingContext {
  const context = listTimelineOrderingContext(db, args);
  const spans = new Map<string, ExternalUserBoundaryTurnSpan>();
  const accepted = new Map<string, { sequence: number; turnId: string }>();
  for (const row of context) {
    if (row.turnId === null) continue;
    if (row.type === "turn/input/accepted" && row.clientRequestId !== null) {
      accepted.set(row.clientRequestId, {
        sequence: row.sequence,
        turnId: row.turnId,
      });
    }
    if (
      row.type === "turn/started" &&
      row.parentToolCallId === null &&
      !spans.has(row.turnId)
    ) {
      spans.set(row.turnId, {
        completionSequence: null,
        sequenceStart: row.sequence,
        turnId: row.turnId,
      });
    }
    const span = spans.get(row.turnId);
    if (
      span !== undefined &&
      row.type === "turn/completed" &&
      span.completionSequence === null
    ) {
      span.completionSequence = row.sequence;
    }
  }
  const requests = context.filter(
    (row) => row.type === "client/turn/requested" && row.requestId !== null,
  );
  for (const row of requests) {
    const acceptance = accepted.get(row.requestId!);
    const span = acceptance === undefined ? undefined : spans.get(acceptance.turnId);
    if (span !== undefined) {
      span.sequenceStart = Math.min(span.sequenceStart, row.sequence);
    }
  }
  let boundary = getFirstParentedTimelineBoundarySequence(db, args) ?? Infinity;
  const orderedSpans = [...spans.values()].sort(
    (left, right) => left.sequenceStart - right.sequenceStart,
  );
  let nextSpan = 0;
  let longest: ExternalUserBoundaryTurnSpan | null = null;
  let secondLongest: ExternalUserBoundaryTurnSpan | null = null;
  const spanEnd = (span: ExternalUserBoundaryTurnSpan | null): number =>
    span === null ? -Infinity : (span.completionSequence ?? Infinity);
  for (const row of requests) {
    if (row.initiator !== "user" || row.hasInput !== 1) continue;
    const acceptance = accepted.get(row.requestId!);
    const steered =
      acceptance !== undefined &&
      row.expectedTurnId !== null &&
      acceptance.turnId === row.expectedTurnId;
    const message: ExternalUserBoundaryMessage = {
      sequence: steered ? acceptance.sequence : row.sequence,
      turnId: acceptance?.turnId ?? row.expectedTurnId,
    };
    if (message.sequence >= boundary) break;
    while (
      nextSpan < orderedSpans.length &&
      orderedSpans[nextSpan]!.sequenceStart < message.sequence
    ) {
      const span = orderedSpans[nextSpan]!;
      if (spanEnd(span) > spanEnd(longest)) {
        secondLongest = longest;
        longest = span;
      } else if (spanEnd(span) > spanEnd(secondLongest)) {
        secondLongest = span;
      }
      nextSpan += 1;
    }
    const candidate =
      longest !== null && longest.turnId === message.turnId
        ? secondLongest
        : longest;
    if (candidate !== null && isExternalUserBoundaryForTurn(candidate, message)) {
      boundary = message.sequence;
      break;
    }
  }
  return {
    orderingBoundarySequence: Number.isFinite(boundary) ? boundary : null,
    acceptedTurnIds: new Map(
      [...accepted].map(([requestId, entry]) => [requestId, entry.turnId]),
    ),
  };
}

export function orderTimelineRowsUsingContext(
  rows: readonly TimelineRow[],
  boundary: number | null,
): TimelineRow[] {
  if (boundary === null) return [...rows];
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
