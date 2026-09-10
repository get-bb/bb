import type { ThreadEventWithMeta } from "@bb/thread-view";
import type { TimelineRow } from "@bb/server-contract";
import {
  getFirstParentedTimelineBoundarySequence,
  listTimelineOrderingContext,
  type DbConnection,
} from "@bb/db";

interface TimelineGroupingContext {
  orderingBoundarySequence: number | null;
  acceptedTurnIds: ReadonlyMap<string, string>;
}

const orderingContexts = new WeakMap<
  DbConnection,
  Map<string, TimelineGroupingContext>
>();

export function clearTimelineOrderingContextCache(db: DbConnection): void {
  orderingContexts.delete(db);
}

export function getTimelineGroupingContext(
  db: DbConnection,
  args: { threadId: string; sequenceStart: number; maxSeq: number },
): TimelineGroupingContext {
  let cache = orderingContexts.get(db);
  if (cache === undefined) {
    cache = new Map();
    orderingContexts.set(db, cache);
  }
  const key = JSON.stringify([args.threadId, args.sequenceStart, args.maxSeq]);
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
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
  const result = {
    orderingBoundarySequence: sequence,
    acceptedTurnIds: accepted,
  };
  cache.set(key, result);
  if (cache.size > 128) cache.delete(cache.keys().next().value!);
  return result;
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
