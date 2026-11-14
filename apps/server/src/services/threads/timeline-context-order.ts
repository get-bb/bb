import type { TimelineRow } from "@bb/server-contract";
import {
  isExternalUserBoundaryForTurn,
  type ExternalUserBoundaryMessage,
  type ExternalUserBoundaryTurnSpan,
} from "@bb/thread-view";
import {
  getFirstParentedTimelineBoundarySequence,
  listTimelineOrderingContext,
  type DbConnection,
} from "@bb/db";

export interface TimelineClientRequestContext {
  acceptedSequences: readonly number[];
  requestedSequences: readonly number[];
}

export interface TimelineGroupingContext {
  orderingBoundarySequence: number | null;
  acceptedTurnIds: ReadonlyMap<string, string>;
  clientRequestIdsBySequence: ReadonlyMap<number, string>;
  clientRequests: ReadonlyMap<string, TimelineClientRequestContext>;
}

interface TimelineGroupingContextArgs {
  maxSeq: number;
  sequenceStart: number;
  threadId: string;
}

interface TimelineOrderingContext {
  acceptedTurnIds: ReadonlyMap<string, string>;
  clientRequestIdsBySequence: ReadonlyMap<number, string>;
  boundarySequence: number | null;
  boundaryScanThroughSequence: number;
  clientRequests: ReadonlyMap<string, TimelineClientRequestContext>;
}

type TimelineOrderingContextRow = ReturnType<
  typeof listTimelineOrderingContext
>[number];

export interface TimelineOrderingContextLog {
  computed: ComputedTimelineGroupingContext | null;
  readonly rows: TimelineOrderingContextRow[];
  readonly sequenceStart: number;
  readonly threadId: string;
  throughSequence: number;
}

interface ComputedTimelineGroupingContext {
  readonly context: TimelineGroupingContext;
  readonly cut: number;
  readonly ordering: TimelineOrderingContext;
}

export function createTimelineOrderingContextLog(
  threadId: string,
  sequenceStart: number,
): TimelineOrderingContextLog {
  return {
    computed: null,
    rows: [],
    sequenceStart,
    threadId,
    throughSequence: sequenceStart - 1,
  };
}

export function extendTimelineOrderingContextLog(
  db: DbConnection,
  log: TimelineOrderingContextLog,
  maxSeq: number,
): void {
  if (log.throughSequence >= maxSeq) return;
  log.rows.push(
    ...listTimelineOrderingContext(db, {
      maxSeq,
      sequenceStart: log.throughSequence + 1,
      threadId: log.threadId,
    }),
  );
  log.throughSequence = maxSeq;
}

export function advanceTimelineOrderingContextLog(
  log: TimelineOrderingContextLog,
  scannedThroughSequence: number,
  throughSequence: number,
): void {
  if (log.throughSequence >= scannedThroughSequence) {
    log.throughSequence = Math.max(log.throughSequence, throughSequence);
  }
}

function sequenceCut(
  rows: readonly TimelineOrderingContextRow[],
  maxSeq: number,
): number {
  let low = 0;
  let high = rows.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (rows[middle]!.sequence <= maxSeq) low = middle + 1;
    else high = middle;
  }
  return low;
}

export function readTimelineGroupingContext(
  db: DbConnection,
  log: TimelineOrderingContextLog,
  maxSeq: number,
): TimelineGroupingContext {
  extendTimelineOrderingContextLog(db, log, maxSeq);
  const cut = sequenceCut(log.rows, maxSeq);
  const ordering =
    log.computed?.cut === cut
      ? log.computed.ordering
      : computeTimelineOrderingContext(
          cut === log.rows.length ? log.rows : log.rows.slice(0, cut),
        );
  const parentedBoundary = getFirstParentedTimelineBoundarySequence(db, {
    maxSeq,
    sequenceStart: log.sequenceStart,
    threadId: log.threadId,
  });
  const orderingBoundarySequence =
    parentedBoundary !== null &&
    parentedBoundary <= ordering.boundaryScanThroughSequence
      ? parentedBoundary
      : (ordering.boundarySequence ?? parentedBoundary);
  if (
    log.computed?.cut === cut &&
    log.computed.context.orderingBoundarySequence === orderingBoundarySequence
  ) {
    return log.computed.context;
  }
  const context: TimelineGroupingContext = {
    clientRequestIdsBySequence: ordering.clientRequestIdsBySequence,
    acceptedTurnIds: ordering.acceptedTurnIds,
    clientRequests: ordering.clientRequests,
    orderingBoundarySequence,
  };
  log.computed = { context, cut, ordering };
  return context;
}

export function getTimelineGroupingContext(
  db: DbConnection,
  args: TimelineGroupingContextArgs,
): TimelineGroupingContext {
  return readTimelineGroupingContext(
    db,
    createTimelineOrderingContextLog(args.threadId, args.sequenceStart),
    args.maxSeq,
  );
}

function clientRequestContext(
  clientRequests: Map<
    string,
    { acceptedSequences: number[]; requestedSequences: number[] }
  >,
  requestId: string,
): { acceptedSequences: number[]; requestedSequences: number[] } {
  let request = clientRequests.get(requestId);
  if (request === undefined) {
    request = { acceptedSequences: [], requestedSequences: [] };
    clientRequests.set(requestId, request);
  }
  return request;
}

function computeTimelineOrderingContext(
  context: readonly TimelineOrderingContextRow[],
): TimelineOrderingContext {
  const spans = new Map<string, ExternalUserBoundaryTurnSpan>();
  const accepted = new Map<string, { sequence: number; turnId: string }>();
  const clientRequestIdsBySequence = new Map<number, string>();
  const clientRequests = new Map<
    string,
    { acceptedSequences: number[]; requestedSequences: number[] }
  >();
  for (const row of context) {
    if (row.type === "client/turn/requested" && row.requestId !== null) {
      clientRequestContext(
        clientRequests,
        row.requestId,
      ).requestedSequences.push(row.sequence);
      clientRequestIdsBySequence.set(row.sequence, row.requestId);
    }
    if (row.turnId === null) continue;
    if (row.type === "turn/input/accepted" && row.clientRequestId !== null) {
      accepted.set(row.clientRequestId, {
        sequence: row.sequence,
        turnId: row.turnId,
      });
      clientRequestIdsBySequence.set(row.sequence, row.clientRequestId);
      clientRequestContext(
        clientRequests,
        row.clientRequestId,
      ).acceptedSequences.push(row.sequence);
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
    const span =
      acceptance === undefined ? undefined : spans.get(acceptance.turnId);
    if (span !== undefined) {
      span.sequenceStart = Math.min(span.sequenceStart, row.sequence);
    }
  }
  let boundary: number | null = null;
  let boundaryScanThroughSequence = -Infinity;
  const orderedSpans = [...spans.values()].sort(
    (left, right) => left.sequenceStart - right.sequenceStart,
  );
  let nextSpan = 0;
  let longest: ExternalUserBoundaryTurnSpan | null = null;
  let secondLongest: ExternalUserBoundaryTurnSpan | null = null;
  const spanEnd = (span: ExternalUserBoundaryTurnSpan | null): number =>
    span === null ? -Infinity : (span.completionSequence ?? Infinity);
  for (const row of requests) {
    if (row.hasVisibleUserInput !== 1) continue;
    const acceptance = accepted.get(row.requestId!);
    const steered =
      acceptance !== undefined &&
      row.expectedTurnId !== null &&
      acceptance.turnId === row.expectedTurnId;
    const message: ExternalUserBoundaryMessage = {
      sequence: steered ? acceptance.sequence : row.sequence,
      turnId: acceptance?.turnId ?? row.expectedTurnId,
    };
    boundaryScanThroughSequence = Math.max(
      boundaryScanThroughSequence,
      message.sequence,
    );
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
    if (
      candidate !== null &&
      isExternalUserBoundaryForTurn(candidate, message)
    ) {
      boundary = message.sequence;
      break;
    }
  }
  return {
    clientRequestIdsBySequence,
    boundarySequence: boundary,
    boundaryScanThroughSequence,
    clientRequests,
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
