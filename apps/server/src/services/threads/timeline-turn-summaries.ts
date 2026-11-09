import { z } from "zod";
import {
  getDatabaseDataVersion,
  getThreadEventRewriteGeneration,
  listCompletedRootTurns,
  listEventTurnRefsBetween,
  listThreadTurnSummaryRecords,
  markThreadTurnSummariesValidated,
  upsertThreadTurnSummaryRecords,
  type CompletedRootTurn,
  type DbConnection,
  type EventTurnRef,
  type StoredEventRow,
} from "@bb/db";
import { timelineTurnRowSchema } from "@bb/server-contract";

const TURN_SUMMARY_VERSION = 1;

const storedTurnSummarySchema = z.object({
  dependentItemIds: z.array(z.string()),
  relatedTurnIds: z.array(z.string()),
  summary: z.object({
    externalUserBoundarySeqs: z.array(z.number()),
    items: z.array(
      z.union([
        z.object({
          kind: z.literal("message"),
          messageId: z.string(),
          sourceSeqEnd: z.number(),
          sourceSeqStart: z.number(),
        }),
        z.object({ kind: z.literal("summary"), row: timelineTurnRowSchema }),
      ]),
    ),
    startedSequence: z.number(),
  }),
});

export type StoredTurnSummary = z.infer<typeof storedTurnSummarySchema>;

export interface TurnSummaryContext {
  db: DbConnection;
  maxSeq: number;
  projectionKey: string;
  threadId: string;
}

export function turnSummaryProjectionKey(args: {
  historySequenceStart: number;
  includeDiagnosticOperations: boolean;
}): string {
  return JSON.stringify([
    TURN_SUMMARY_VERSION,
    args.historySequenceStart,
    args.includeDiagnosticOperations,
  ]);
}

function parseStoredTurnSummary(json: string): StoredTurnSummary | null {
  try {
    const parsed = storedTurnSummarySchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

interface CachedThreadSummaries {
  chars: number;
  dataVersion: number;
  generation: number;
  projectionKey: string;
  summaries: Map<string, StoredTurnSummary>;
  validatedThrough: number;
}

const SUMMARY_CACHE_MAX_THREADS = 64;
const SUMMARY_CACHE_MAX_CHARS = 16_000_000;
const PERSIST_VALIDATION_AFTER_EVENTS = 1_024;
const summaryCaches = new WeakMap<
  DbConnection,
  { chars: number; threads: Map<string, CachedThreadSummaries> }
>();

function touchesSummary(
  ref: EventTurnRef,
  turnId: string,
  summary: StoredTurnSummary,
) {
  return (
    ref.turnId === turnId ||
    (ref.itemId !== null && summary.dependentItemIds.includes(ref.itemId)) ||
    (ref.parentToolCallId !== null &&
      summary.dependentItemIds.includes(ref.parentToolCallId))
  );
}

function touchedTurnIds(
  refs: readonly EventTurnRef[],
  summaries: ReadonlyMap<string, StoredTurnSummary>,
): Set<string> {
  const touched = new Set<string>();
  const dependents = new Map<string, string>();
  for (const [turnId, summary] of summaries) {
    for (const itemId of summary.dependentItemIds)
      dependents.set(itemId, turnId);
  }
  for (const ref of refs) {
    if (ref.turnId !== null && summaries.has(ref.turnId))
      touched.add(ref.turnId);
    for (const itemId of [ref.itemId, ref.parentToolCallId]) {
      const turnId = itemId === null ? undefined : dependents.get(itemId);
      if (turnId !== undefined) touched.add(turnId);
    }
  }
  return touched;
}

function threadSummaryCache(
  context: TurnSummaryContext,
): CachedThreadSummaries {
  const { db, maxSeq, projectionKey, threadId } = context;
  let cache = summaryCaches.get(db);
  if (cache === undefined) {
    cache = { chars: 0, threads: new Map() };
    summaryCaches.set(db, cache);
  }
  const dataVersion = getDatabaseDataVersion(db);
  const generation = getThreadEventRewriteGeneration(threadId);
  let entry = cache.threads.get(threadId);
  cache.threads.delete(threadId);
  if (
    entry === undefined ||
    entry.projectionKey !== projectionKey ||
    entry.generation !== generation ||
    entry.dataVersion !== dataVersion ||
    entry.validatedThrough > maxSeq
  ) {
    if (entry !== undefined) cache.chars -= entry.chars;
    entry = {
      chars: 0,
      dataVersion,
      generation,
      projectionKey,
      summaries: new Map(),
      validatedThrough: maxSeq,
    };
  } else if (entry.validatedThrough < maxSeq) {
    for (const turnId of touchedTurnIds(
      listEventTurnRefsBetween(db, {
        afterSequence: entry.validatedThrough,
        threadId,
        throughSequence: maxSeq,
      }),
      entry.summaries,
    )) {
      entry.summaries.delete(turnId);
    }
    entry.validatedThrough = maxSeq;
  }
  cache.threads.set(threadId, entry);
  return entry;
}

function rememberSummaries(
  context: TurnSummaryContext,
  entry: CachedThreadSummaries,
  summaries: ReadonlyMap<string, StoredTurnSummary>,
): void {
  const cache = summaryCaches.get(context.db)!;
  for (const [turnId, summary] of summaries) {
    if (!entry.summaries.has(turnId)) {
      const chars = JSON.stringify(summary).length;
      entry.chars += chars;
      cache.chars += chars;
    }
    entry.summaries.set(turnId, summary);
  }
  while (
    cache.threads.size > SUMMARY_CACHE_MAX_THREADS ||
    cache.chars > SUMMARY_CACHE_MAX_CHARS
  ) {
    const [oldestId, oldest] = cache.threads.entries().next().value!;
    cache.threads.delete(oldestId);
    cache.chars -= oldest.chars;
    if (oldest === entry) break;
  }
}

function loadTurnSummaries(
  context: TurnSummaryContext,
  turnIds: readonly string[],
): {
  missing: Map<string, CompletedRootTurn>;
  summaries: Map<string, StoredTurnSummary>;
} {
  const { db, maxSeq, projectionKey, threadId } = context;
  const entry = threadSummaryCache(context);
  const summaries = new Map<string, StoredTurnSummary>();
  const unknown: string[] = [];
  for (const turnId of turnIds) {
    const summary = entry.summaries.get(turnId);
    if (summary === undefined) unknown.push(turnId);
    else summaries.set(turnId, summary);
  }
  const missing = new Map<string, CompletedRootTurn>();
  if (unknown.length === 0) return { missing, summaries };
  const records = listThreadTurnSummaryRecords(db, {
    threadId,
    turnIds: unknown,
  }).flatMap((record) => {
    const summary =
      record.projectionKey === projectionKey &&
      record.validatedThrough <= maxSeq
        ? parseStoredTurnSummary(record.summaryJson)
        : null;
    return summary === null ? [] : [{ ...record, summary }];
  });
  if (records.length > 0) {
    const validatedThrough = Math.min(
      ...records.map((record) => record.validatedThrough),
    );
    const refs = listEventTurnRefsBetween(db, {
      afterSequence: validatedThrough,
      threadId,
      throughSequence: maxSeq,
    }).filter((ref) => ref.sequence > validatedThrough);
    const valid = new Map<string, StoredTurnSummary>();
    const stale: string[] = [];
    for (const record of records) {
      const isTouched = refs.some(
        (ref) =>
          ref.sequence > record.validatedThrough &&
          touchesSummary(ref, record.turnId, record.summary),
      );
      if (isTouched) continue;
      valid.set(record.turnId, record.summary);
      if (maxSeq - record.validatedThrough > PERSIST_VALIDATION_AFTER_EVENTS) {
        stale.push(record.turnId);
      }
    }
    if (stale.length > 0) {
      markThreadTurnSummariesValidated(db, {
        threadId,
        turnIds: stale,
        validatedThrough: maxSeq,
      });
    }
    rememberSummaries(context, entry, valid);
    for (const [turnId, summary] of valid) summaries.set(turnId, summary);
  }
  const unresolved = unknown.filter((turnId) => !summaries.has(turnId));
  if (unresolved.length === 0) return { missing, summaries };
  for (const [turnId, turn] of listCompletedRootTurns(db, {
    maxSeq,
    threadId,
    turnIds: unresolved,
  })) {
    missing.set(turnId, turn);
  }
  return { missing, summaries };
}

export function storeTurnSummaries(
  context: TurnSummaryContext,
  summaries: ReadonlyMap<string, StoredTurnSummary>,
): void {
  if (summaries.size === 0) return;
  upsertThreadTurnSummaryRecords(context.db, {
    records: [...summaries].map(([turnId, summary]) => ({
      projectionKey: context.projectionKey,
      summaryJson: JSON.stringify(summary),
      turnId,
      validatedThrough: context.maxSeq,
    })),
    threadId: context.threadId,
  });
  rememberSummaries(context, threadSummaryCache(context), summaries);
}

export interface ResolvedTurnSummaries {
  summaries: Map<string, StoredTurnSummary>;
  unsummarizedTurns: Map<string, CompletedRootTurn>;
}

export function resolveTurnSummaries(
  context: TurnSummaryContext,
  turnIds: readonly string[],
  build: (
    turns: ReadonlyMap<string, CompletedRootTurn>,
  ) => Map<string, StoredTurnSummary>,
  options: {
    buildBudget: number;
    readWhole: (turnId: string, turn: CompletedRootTurn) => boolean;
  },
): ResolvedTurnSummaries {
  if (turnIds.length === 0) {
    return { summaries: new Map(), unsummarizedTurns: new Map() };
  }
  const { missing, summaries } = loadTurnSummaries(context, turnIds);
  const unbuilt = [...missing]
    .filter(([turnId, turn]) => !options.readWhole(turnId, turn))
    .sort(([, left], [, right]) => right.end - left.end);
  const toBuild = new Map<string, CompletedRootTurn>();
  let budget = options.buildBudget;
  for (const [turnId, turn] of unbuilt) {
    budget -= turn.end - turn.startedSequence + 1;
    if (budget < 0) break;
    toBuild.set(turnId, turn);
  }
  if (toBuild.size > 0) {
    const built = build(toBuild);
    storeTurnSummaries(context, built);
    for (const [turnId, summary] of built) summaries.set(turnId, summary);
  }
  return {
    summaries,
    unsummarizedTurns: new Map(
      [...missing].filter(([turnId]) => !summaries.has(turnId)),
    ),
  };
}

const TERMINAL_ITEM_EVENT_TYPES = new Set([
  "item/completed",
  "item/backgroundTask/completed",
  "item/delegation/completed",
]);

export function collectTurnSummaryDependencies(
  rows: readonly StoredEventRow[],
): Map<string, Omit<StoredTurnSummary, "summary">> {
  const parentByItemId = new Map<string, string>();
  const turnByItemId = new Map<string, string>();
  const startedItemKinds = new Map<string, string>();
  const settledItemIds = new Set<string>();
  for (const row of rows) {
    if (row.itemId === null) continue;
    if (row.parentToolCallId !== null && row.parentToolCallId.length > 0) {
      parentByItemId.set(row.itemId, row.parentToolCallId);
    }
    if (row.turnId !== null && !turnByItemId.has(row.itemId)) {
      turnByItemId.set(row.itemId, row.turnId);
    }
    if (TERMINAL_ITEM_EVENT_TYPES.has(row.type)) settledItemIds.add(row.itemId);
    if (row.type === "item/started" && row.itemKind !== null) {
      startedItemKinds.set(row.itemId, row.itemKind);
    }
  }
  const rootTurnOf = (itemId: string): string | undefined => {
    const visited = new Set<string>();
    let current = itemId;
    while (parentByItemId.has(current) && !visited.has(current)) {
      visited.add(current);
      current = parentByItemId.get(current)!;
    }
    return turnByItemId.get(current);
  };
  const dependencies = new Map<
    string,
    { dependentItemIds: Set<string>; relatedTurnIds: Set<string> }
  >();
  const dependenciesOf = (turnId: string) => {
    let entry = dependencies.get(turnId);
    if (entry === undefined) {
      entry = { dependentItemIds: new Set(), relatedTurnIds: new Set() };
      dependencies.set(turnId, entry);
    }
    return entry;
  };
  for (const [itemId, itemKind] of startedItemKinds) {
    const reportsAfterItsTurn =
      itemKind === "backgroundTask" || itemKind === "delegation";
    if (
      !reportsAfterItsTurn &&
      (itemKind !== "toolCall" || settledItemIds.has(itemId))
    ) {
      continue;
    }
    const turnId = rootTurnOf(itemId);
    if (turnId !== undefined)
      dependenciesOf(turnId).dependentItemIds.add(itemId);
  }
  for (const row of rows) {
    if (row.turnId === null || row.parentToolCallId === null) continue;
    const turnId = rootTurnOf(row.parentToolCallId);
    if (turnId !== undefined && turnId !== row.turnId) {
      dependenciesOf(turnId).relatedTurnIds.add(row.turnId);
    }
  }
  return new Map(
    [...dependencies].map(([turnId, entry]) => [
      turnId,
      {
        dependentItemIds: [...entry.dependentItemIds],
        relatedTurnIds: [...entry.relatedTurnIds],
      },
    ]),
  );
}
