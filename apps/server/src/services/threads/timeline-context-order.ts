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

export interface TimelineTurnBlock {
  completionSequence: number | null;
  lastContextSequence: number;
  sequenceStart: number;
  startedSequence: number;
  turnId: string;
}

export interface TimelineGroupingContext {
  externalUserBoundaries: TimelineExternalUserBoundaries;
  orderingBoundarySequence: number | null;
  parentedBoundarySequence: number | null;
  turnBlocks: readonly TimelineTurnBlock[];
  acceptedTurnIds: ReadonlyMap<string, string>;
  clientRequestIdsBySequence: ReadonlyMap<number, string>;
  clientRequests: ReadonlyMap<string, TimelineClientRequestContext>;
}

interface TimelineGroupingContextArgs {
  maxSeq: number;
  sequenceStart: number;
  threadId: string;
}

export interface TimelineExternalUserBoundaries {
  acceptances: readonly {
    acceptanceSequence: number;
    requestSequence: number;
  }[];
  messages: readonly ExternalUserBoundaryMessage[];
  spans: ReadonlyMap<string, ExternalUserBoundaryTurnSpan>;
}

export function lastAcceptanceSequencesInTurnSpans(
  boundaries: TimelineExternalUserBoundaries,
  turnIds: Iterable<string>,
): Map<string, number> {
  const result = new Map<string, number>();
  for (const turnId of turnIds) {
    const span = boundaries.spans.get(turnId);
    if (span === undefined) continue;
    const end = span.completionSequence ?? Infinity;
    for (
      let index = boundaries.acceptances.length - 1;
      index >= 0;
      index -= 1
    ) {
      const acceptance = boundaries.acceptances[index]!;
      if (acceptance.acceptanceSequence < span.sequenceStart) break;
      if (acceptance.requestSequence <= end) {
        result.set(turnId, acceptance.acceptanceSequence);
        break;
      }
    }
  }
  return result;
}

export function externalUserBoundarySequencesForTurns(
  boundaries: TimelineExternalUserBoundaries,
  turnIds: Iterable<string>,
): Map<string, number[]> {
  const result = new Map<string, number[]>();
  const { messages } = boundaries;
  for (const turnId of turnIds) {
    const span = boundaries.spans.get(turnId);
    if (span === undefined) continue;
    let low = 0;
    let high = messages.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (messages[middle]!.sequence <= span.sequenceStart) low = middle + 1;
      else high = middle;
    }
    const sequences = new Set<number>();
    for (let index = low; index < messages.length; index += 1) {
      const message = messages[index]!;
      if (
        span.completionSequence !== null &&
        message.sequence >= span.completionSequence
      ) {
        break;
      }
      if (isExternalUserBoundaryForTurn(span, message)) {
        sequences.add(message.sequence);
      }
    }
    if (sequences.size > 0) result.set(turnId, [...sequences]);
  }
  return result;
}

interface TimelineOrderingContext {
  acceptedTurnIds: ReadonlyMap<string, string>;
  externalUserBoundaries: TimelineExternalUserBoundaries;
  clientRequestIdsBySequence: ReadonlyMap<number, string>;
  boundarySequence: number | null;
  boundaryScanThroughSequence: number;
  clientRequests: ReadonlyMap<string, TimelineClientRequestContext>;
  turnBlocks: readonly TimelineTurnBlock[];
}

type TimelineOrderingContextRow = ReturnType<
  typeof listTimelineOrderingContext
>[number];

interface TimelineOrderingContextLog {
  dataVersion: number;
  generation: number;
  rows: TimelineOrderingContextRow[];
  threadId: string;
  throughSequence: number;
}

interface TimelineGroupingContextEntry {
  orderingContext: TimelineOrderingContext;
  context: TimelineGroupingContext;
  dataVersion: number;
  generation: number;
  maxSeq: number;
  threadId: string;
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

export function forgetTimelineGroupingContexts(
  db: DbConnection,
  threadId: string,
): void {
  const contexts = orderingContexts.get(db);
  if (contexts !== undefined) {
    for (const [key, entries] of contexts) {
      if (entries[0]?.threadId === threadId) contexts.delete(key);
    }
  }
  const logs = orderingContextLogs.get(db);
  if (logs !== undefined) {
    for (const [key, log] of logs) {
      if (log.threadId === threadId) logs.delete(key);
    }
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
      threadId: args.threadId,
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
    externalUserBoundaries: orderingContext.externalUserBoundaries,
    parentedBoundarySequence: parentedBoundary,
    clientRequestIdsBySequence: orderingContext.clientRequestIdsBySequence,
    acceptedTurnIds: orderingContext.acceptedTurnIds,
    clientRequests: orderingContext.clientRequests,
    turnBlocks: orderingContext.turnBlocks,
    orderingBoundarySequence:
      parentedBoundary !== null &&
      parentedBoundary <= orderingContext.boundaryScanThroughSequence
        ? parentedBoundary
        : (orderingContext.boundarySequence ?? parentedBoundary),
  };
  cache.set(key, [
    {
      context,
      orderingContext,
      dataVersion,
      generation,
      maxSeq: args.maxSeq,
      threadId: args.threadId,
    },
    ...entries.slice(0, GROUPING_CONTEXT_ENTRIES_PER_KEY - 1),
  ]);
  if (cache.size > GROUPING_CONTEXT_KEY_LIMIT) {
    cache.delete(cache.keys().next().value!);
  }
  return context;
}

function effectiveOrderingBoundary(
  orderingContext: Pick<
    TimelineOrderingContext,
    "boundarySequence" | "boundaryScanThroughSequence"
  >,
  parentedBoundary: number | null,
): number | null {
  return parentedBoundary !== null &&
    parentedBoundary <= orderingContext.boundaryScanThroughSequence
    ? parentedBoundary
    : (orderingContext.boundarySequence ?? parentedBoundary);
}

const parentedBoundaryChangeSequences = new WeakMap<
  DbConnection,
  Map<string, number>
>();

function parentedBoundaryChangeSequence(
  db: DbConnection,
  args: TimelineGroupingContextArgs & { afterSequence: number },
  current: number | null,
  generation: number,
): number | null {
  const parentedAt = (maxSeq: number) =>
    getFirstParentedTimelineBoundarySequence(db, { ...args, maxSeq });
  let cache = parentedBoundaryChangeSequences.get(db);
  if (cache === undefined) {
    cache = new Map();
    parentedBoundaryChangeSequences.set(db, cache);
  }
  const key = JSON.stringify([
    args.threadId,
    args.sequenceStart,
    generation,
    current,
  ]);
  const cached = cache.get(key);
  if (cached !== undefined && cached <= args.maxSeq) {
    return cached > args.afterSequence ? cached : null;
  }
  if (parentedAt(args.afterSequence) === current) return null;
  let low = args.afterSequence + 1;
  let high = args.maxSeq;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (parentedAt(middle) === current) high = middle;
    else low = middle + 1;
  }
  cache.delete(key);
  cache.set(key, low);
  if (cache.size > GROUPING_CONTEXT_KEY_LIMIT) {
    cache.delete(cache.keys().next().value!);
  }
  return low;
}

interface OrderingChangeEntry {
  afterSequence: number;
  suffixStartPosition: number | null;
  dataVersion: number;
  generation: number;
  maxSeq: number;
  result: number | null;
}

const orderingChangeEntries = new WeakMap<
  DbConnection,
  Map<string, OrderingChangeEntry>
>();

interface TimelineOrderingChangeArgs extends TimelineGroupingContextArgs {
  afterSequence: number;
  parentedSequences: readonly number[];
  suffixStartPosition: number | null;
}

function hasSequenceIn(
  sequences: readonly number[],
  afterSequence: number,
  throughSequence: number,
): boolean {
  let low = 0;
  let high = sequences.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (sequences[middle]! <= afterSequence) low = middle + 1;
    else high = middle;
  }
  return low < sequences.length && sequences[low]! <= throughSequence;
}

function orderingChangesInRange(
  rows: readonly TimelineOrderingContextRow[],
  parentedSequences: readonly number[],
  afterSequence: number,
  throughSequence: number,
): { ordering: boolean; parented: boolean } {
  const first = sequenceCut(rows, afterSequence);
  return {
    ordering: first < rows.length && rows[first]!.sequence <= throughSequence,
    parented: hasSequenceIn(parentedSequences, afterSequence, throughSequence),
  };
}

export function getTimelineOrderingChangeSequence(
  db: DbConnection,
  args: TimelineOrderingChangeArgs,
): number | null {
  if (args.afterSequence >= args.maxSeq) return null;
  let entries = orderingChangeEntries.get(db);
  if (entries === undefined) {
    entries = new Map();
    orderingChangeEntries.set(db, entries);
  }
  const key = JSON.stringify([args.threadId, args.sequenceStart]);
  const generation = getThreadEventRewriteGeneration(args.threadId);
  const dataVersion = getDatabaseDataVersion(db);
  const rows = listOrderingContextRows(db, args, key, generation, dataVersion);
  const previous = entries.get(key);
  entries.delete(key);
  if (
    previous !== undefined &&
    previous.generation === generation &&
    previous.dataVersion === dataVersion &&
    previous.afterSequence === args.afterSequence &&
    previous.suffixStartPosition === args.suffixStartPosition &&
    previous.maxSeq <= args.maxSeq
  ) {
    const changes = orderingChangesInRange(
      rows,
      args.parentedSequences,
      previous.maxSeq,
      args.maxSeq,
    );
    if (!changes.ordering && !changes.parented) {
      entries.set(key, { ...previous, maxSeq: args.maxSeq });
      return previous.result;
    }
  }
  const result = computeTimelineOrderingChangeSequence(db, args, rows);
  entries.set(key, {
    afterSequence: args.afterSequence,
    suffixStartPosition: args.suffixStartPosition,
    dataVersion,
    generation,
    maxSeq: args.maxSeq,
    result,
  });
  if (entries.size > GROUPING_CONTEXT_KEY_LIMIT) {
    entries.delete(entries.keys().next().value!);
  }
  return result;
}

function computeTimelineOrderingChangeSequence(
  db: DbConnection,
  args: TimelineOrderingChangeArgs,
  rows: readonly TimelineOrderingContextRow[],
): number | null {
  const changes = orderingChangesInRange(
    rows,
    args.parentedSequences,
    args.afterSequence,
    args.maxSeq,
  );
  if (!changes.ordering && !changes.parented) return null;
  const generation = getThreadEventRewriteGeneration(args.threadId);
  const parentedAt = (maxSeq: number) =>
    getFirstParentedTimelineBoundarySequence(db, { ...args, maxSeq });
  const { orderingBoundarySequence: current, parentedBoundarySequence } =
    getTimelineGroupingContext(db, args);
  const parentedNow = parentedBoundarySequence;
  const boundaryAt = (sequence: number, parented: number | null) =>
    effectiveOrderingBoundary(
      computeTimelineOrderingContext(
        rows.slice(0, sequenceCut(rows, sequence)),
      ),
      parented,
    );
  const atWindowStart = boundaryAt(
    args.afterSequence,
    changes.parented ? parentedAt(args.afterSequence) : parentedNow,
  );
  if (
    atWindowStart === current ||
    Math.min(
      atWindowStart ?? Infinity,
      current ?? Infinity,
      args.suffixStartPosition ?? Infinity,
    ) > args.afterSequence
  ) {
    return null;
  }
  const parentedChange = changes.parented
    ? parentedBoundaryChangeSequence(db, args, parentedNow, generation)
    : null;
  const points = new Set<number>();
  if (changes.ordering) {
    for (const row of rows) {
      if (row.sequence > args.afterSequence) points.add(row.sequence);
    }
  }
  if (parentedChange !== null) points.add(parentedChange);
  for (const point of [...points].sort((left, right) => right - left)) {
    const parented =
      parentedChange === null || point > parentedChange
        ? parentedNow
        : parentedAt(point - 1);
    const before = boundaryAt(point - 1, parented);
    if (
      before !== current &&
      Math.min(
        before ?? Infinity,
        current ?? Infinity,
        args.suffixStartPosition ?? Infinity,
      ) <= args.afterSequence
    ) {
      return point;
    }
  }
  return null;
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
  const childSpans = new Map<string, ExternalUserBoundaryTurnSpan>();
  const startedSequences = new Map<string, number>();
  const lastContextSequences = new Map<string, number>();
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
    lastContextSequences.set(row.turnId, row.sequence);
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
      startedSequences.set(row.turnId, row.sequence);
    }
    if (
      row.type === "turn/started" &&
      row.parentToolCallId !== null &&
      !spans.has(row.turnId) &&
      !childSpans.has(row.turnId)
    ) {
      childSpans.set(row.turnId, {
        completionSequence: null,
        sequenceStart: row.sequence,
        turnId: row.turnId,
      });
    }
    const span = spans.get(row.turnId) ?? childSpans.get(row.turnId);
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
  const orderedSpans = [...spans.values(), ...childSpans.values()].sort(
    (left, right) => left.sequenceStart - right.sequenceStart,
  );
  let nextSpan = 0;
  let longest: ExternalUserBoundaryTurnSpan | null = null;
  let secondLongest: ExternalUserBoundaryTurnSpan | null = null;
  const spanEnd = (span: ExternalUserBoundaryTurnSpan | null): number =>
    span === null ? -Infinity : (span.completionSequence ?? Infinity);
  const messages = requests
    .flatMap((row): ExternalUserBoundaryMessage[] => {
      if (row.hasVisibleUserInput !== 1) return [];
      const acceptance = accepted.get(row.requestId!);
      const steered =
        acceptance !== undefined &&
        row.expectedTurnId !== null &&
        acceptance.turnId === row.expectedTurnId;
      return [
        {
          sequence: steered ? acceptance.sequence : row.sequence,
          turnId: acceptance?.turnId ?? row.expectedTurnId,
        },
      ];
    })
    .sort((left, right) => left.sequence - right.sequence);
  for (const message of messages) {
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
    externalUserBoundaries: {
      acceptances: requests
        .flatMap((row) => {
          const acceptance = accepted.get(row.requestId!);
          return acceptance === undefined
            ? []
            : [
                {
                  acceptanceSequence: acceptance.sequence,
                  requestSequence: row.sequence,
                },
              ];
        })
        .sort(
          (left, right) => left.acceptanceSequence - right.acceptanceSequence,
        ),
      messages,
      spans: new Map(
        [...spans.values(), ...childSpans.values()].map((span) => [
          span.turnId,
          span,
        ]),
      ),
    },
    clientRequestIdsBySequence,
    boundarySequence: boundary,
    boundaryScanThroughSequence,
    clientRequests,
    turnBlocks: [...spans.values()]
      .map((span) => ({
        completionSequence: span.completionSequence,
        lastContextSequence:
          lastContextSequences.get(span.turnId) ?? span.sequenceStart,
        sequenceStart: span.sequenceStart,
        startedSequence:
          startedSequences.get(span.turnId) ?? span.sequenceStart,
        turnId: span.turnId,
      }))
      .sort((left, right) => left.sequenceStart - right.sequenceStart),
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
