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
  getTimelineGroupingContextChangesInRange,
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

interface TimelineOrderingContextLog {
  dataVersion: number;
  generation: number;
  rows: TimelineOrderingContextRow[];
  throughSequence: number;
}

interface TimelineGroupingContextEntry {
  orderingContext: TimelineOrderingContext;
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

const orderingContextLogs = new WeakMap<
  DbConnection,
  Map<string, TimelineOrderingContextLog>
>();

export function clearTimelineOrderingContextCache(db: DbConnection): void {
  orderingContexts.delete(db);
  orderingContextLogs.delete(db);
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

function listOrderingContextRows(
  db: DbConnection,
  args: TimelineGroupingContextArgs,
  key: string,
  generation: number,
  dataVersion: number,
): readonly TimelineOrderingContextRow[] {
  let logs = orderingContextLogs.get(db);
  if (logs === undefined) {
    logs = new Map();
    orderingContextLogs.set(db, logs);
  }
  let log = logs.get(key);
  logs.delete(key);
  if (
    log === undefined ||
    log.generation !== generation ||
    log.dataVersion !== dataVersion
  ) {
    log = {
      dataVersion,
      generation,
      rows: [],
      throughSequence: args.sequenceStart - 1,
    };
  }
  if (log.throughSequence < args.maxSeq) {
    log.rows.push(
      ...listTimelineOrderingContext(db, {
        maxSeq: args.maxSeq,
        sequenceStart: log.throughSequence + 1,
        threadId: args.threadId,
      }),
    );
    log.throughSequence = args.maxSeq;
  }
  logs.set(key, log);
  if (logs.size > GROUPING_CONTEXT_KEY_LIMIT) {
    logs.delete(logs.keys().next().value!);
  }
  const cut = sequenceCut(log.rows, args.maxSeq);
  return cut === log.rows.length ? log.rows : log.rows.slice(0, cut);
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
):
  | { entry: TimelineGroupingContextEntry; parentedChanged: boolean }
  | undefined {
  const exact = entries.find((entry) => entry.maxSeq === args.maxSeq);
  if (exact !== undefined) return { entry: exact, parentedChanged: false };
  for (const side of ["below", "above"] as const) {
    const entry = nearestEntry(entries, args.maxSeq, side);
    if (entry === undefined) continue;
    const changes = getTimelineGroupingContextChangesInRange(db, {
      afterSequence: Math.min(entry.maxSeq, args.maxSeq),
      threadId: args.threadId,
      throughSequence: Math.max(entry.maxSeq, args.maxSeq),
    });
    if (changes.ordering) continue;
    if (!changes.parented && side === "below") entry.maxSeq = args.maxSeq;
    return { entry, parentedChanged: changes.parented };
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
  if (reusable !== undefined && !reusable.parentedChanged) {
    cache.set(key, [
      reusable.entry,
      ...entries.filter((entry) => entry !== reusable.entry),
    ]);
    return reusable.entry.context;
  }
  const orderingContext =
    reusable?.entry.orderingContext ??
    computeTimelineOrderingContext(
      listOrderingContextRows(db, args, key, generation, dataVersion),
    );
  const parentedBoundary = getFirstParentedTimelineBoundarySequence(db, args);
  const context: TimelineGroupingContext = {
    clientRequestIdsBySequence: orderingContext.clientRequestIdsBySequence,
    acceptedTurnIds: orderingContext.acceptedTurnIds,
    clientRequests: orderingContext.clientRequests,
    orderingBoundarySequence:
      parentedBoundary !== null &&
      parentedBoundary <= orderingContext.boundaryScanThroughSequence
        ? parentedBoundary
        : (orderingContext.boundarySequence ?? parentedBoundary),
  };
  cache.set(key, [
    { context, orderingContext, dataVersion, generation, maxSeq: args.maxSeq },
    ...entries.slice(0, GROUPING_CONTEXT_ENTRIES_PER_KEY - 1),
  ]);
  if (cache.size > GROUPING_CONTEXT_KEY_LIMIT) {
    cache.delete(cache.keys().next().value!);
  }
  return context;
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
