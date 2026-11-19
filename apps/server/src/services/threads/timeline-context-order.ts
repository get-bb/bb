import { threadEventJoinsRunningTurn } from "@bb/thread-view";
import {
  getDatabaseDataVersion,
  getThreadEventRewriteGeneration,
  hasTimelineGroupingContextChangesInRange,
  listTimelineOrderingContext,
  type DbConnection,
  type StoredEventRow,
} from "@bb/db";
import { decodeStoredEventRowCached } from "./stored-event-decode-cache.js";

export interface TimelineClientRequestContext {
  acceptedSequences: readonly number[];
  requestedSequences: readonly number[];
}

export interface TimelineTurnBlock {
  completionSequence: number | null;
  startedSequence: number;
  turnId: string;
}

export function rootTurnRunningAtSequence(
  turnBlocks: readonly TimelineTurnBlock[],
  sequence: number,
): TimelineTurnBlock | null {
  let running: TimelineTurnBlock | null = null;
  for (const block of turnBlocks) {
    if (block.startedSequence >= sequence) continue;
    if (
      block.completionSequence !== null &&
      block.completionSequence < sequence
    ) {
      continue;
    }
    if (running === null || block.startedSequence > running.startedSequence) {
      running = block;
    }
  }
  return running;
}

export function rootTurnJoinedByThreadRow(
  db: DbConnection,
  row: StoredEventRow,
  turnBlocks: readonly TimelineTurnBlock[],
): TimelineTurnBlock | null {
  return row.turnId === null &&
    threadEventJoinsRunningTurn(decodeStoredEventRowCached(db, row))
    ? rootTurnRunningAtSequence(turnBlocks, row.sequence)
    : null;
}

export interface TimelineGroupingContext {
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
): TimelineGroupingContextEntry | undefined {
  const exact = entries.find((entry) => entry.maxSeq === args.maxSeq);
  if (exact !== undefined) return exact;
  for (const side of ["below", "above"] as const) {
    const entry = nearestEntry(entries, args.maxSeq, side);
    if (entry === undefined) continue;
    const changed = hasTimelineGroupingContextChangesInRange(db, {
      afterSequence: Math.min(entry.maxSeq, args.maxSeq),
      threadId: args.threadId,
      throughSequence: Math.max(entry.maxSeq, args.maxSeq),
    });
    if (changed) continue;
    if (side === "below") entry.maxSeq = args.maxSeq;
    return entry;
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
  const context = computeTimelineGroupingContext(
    listOrderingContextRows(db, args, key, generation, dataVersion),
  );
  cache.set(key, [
    {
      context,
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

function computeTimelineGroupingContext(
  context: readonly TimelineOrderingContextRow[],
): TimelineGroupingContext {
  const turnBlocks = new Map<string, TimelineTurnBlock>();
  const acceptedTurnIds = new Map<string, string>();
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
      acceptedTurnIds.set(row.clientRequestId, row.turnId);
      clientRequestIdsBySequence.set(row.sequence, row.clientRequestId);
      clientRequestContext(
        clientRequests,
        row.clientRequestId,
      ).acceptedSequences.push(row.sequence);
    }
    if (
      row.type === "turn/started" &&
      row.parentToolCallId === null &&
      !turnBlocks.has(row.turnId)
    ) {
      turnBlocks.set(row.turnId, {
        completionSequence: null,
        startedSequence: row.sequence,
        turnId: row.turnId,
      });
    }
    const block = turnBlocks.get(row.turnId);
    if (
      block !== undefined &&
      row.type === "turn/completed" &&
      block.completionSequence === null
    ) {
      block.completionSequence = row.sequence;
    }
  }
  return {
    acceptedTurnIds,
    clientRequestIdsBySequence,
    clientRequests,
    turnBlocks: [...turnBlocks.values()].sort(
      (left, right) => left.startedSequence - right.startedSequence,
    ),
  };
}
