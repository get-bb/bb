import type { ThreadEventWithMeta } from "@bb/thread-view";
import type { TimelineRow } from "@bb/server-contract";
import {
  getFirstParentedTimelineBoundarySequence,
  getThreadTimelineHistoryRevision,
  type DbConnection,
} from "@bb/db";

const orderingContexts = new WeakMap<
  DbConnection,
  Map<string, number | null>
>();

export function clearTimelineOrderingContextCache(db: DbConnection): void {
  orderingContexts.delete(db);
}

export function getTimelineOrderingBoundary(
  db: DbConnection,
  args: { threadId: string; sequenceStart: number; maxSeq: number },
): number | null {
  let cache = orderingContexts.get(db);
  if (cache === undefined) {
    cache = new Map();
    orderingContexts.set(db, cache);
  }
  const key = JSON.stringify([
    args.threadId,
    args.sequenceStart,
    args.maxSeq,
    getThreadTimelineHistoryRevision(db, args.threadId),
  ]);
  if (cache.has(key)) return cache.get(key) ?? null;
  const sequence = getFirstParentedTimelineBoundarySequence(db, args);
  cache.set(key, sequence);
  if (cache.size > 128) cache.delete(cache.keys().next().value!);
  return sequence;
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
