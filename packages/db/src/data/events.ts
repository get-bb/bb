import {
  and,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  lt,
  lte,
  max,
  notExists,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type {
  ClientTurnRequestId,
  StoredThreadEventDataForType,
  SystemThreadInterruptedReason,
  ThreadEventItemType,
  ThreadEventScope,
  ThreadEventScopeKind,
  ThreadEventType,
} from "@bb/domain";
import {
  clientTurnRequestIdSchema,
  getThreadEventScopeTurnId,
  systemThreadInterruptedReasonSchema,
} from "@bb/domain";
import type {
  DbConnection,
  DbQueryConnection,
  DbTransaction,
} from "../connection.js";
import { alias } from "drizzle-orm/sqlite-core";
import type { DbNotifier } from "../notifier.js";
import { environments, events, threads } from "../schema.js";
import { createEventId } from "../ids.js";
import { deriveStoredEventItemFieldsFromSource } from "../stored-event-item-fields.js";

const STORED_EVENT_SEQUENCE_LOOKUP_CHUNK_SIZE = 250;

export interface InsertEventInput {
  threadId: string;
  environmentId?: string | null;
  scope: ThreadEventScope;
  providerThreadId?: string | null;
  sequence: number;
  type: ThreadEventType;
  itemId: string | null;
  itemKind: ThreadEventItemType | null;
  createdAt?: number;
  data: string;
}

export interface InsertEventsResult {
  insertedCount: number;
  insertedInputIndexes: number[];
}

export interface AppendDaemonEventInput {
  data: string;
  environmentId: string | null;
  itemId: string | null;
  itemKind: ThreadEventItemType | null;
  providerThreadId: string | null;
  scope: ThreadEventScope;
  threadId: string;
  type: ThreadEventType;
}

export interface AcceptedDaemonEvent {
  sequence: number;
  threadId: string;
}

export interface AppendDaemonEventsResult {
  acceptedEvents: AcceptedDaemonEvent[];
  insertedInputIndexes: number[];
  /**
   * Indexes of inputs dropped because they were orphan thread-state snapshots
   * (token/context usage scoped to a turn with no stored turn/started). Surfaced
   * so callers can log them; they are not inserted and trigger no effects.
   */
  skippedTurnUnstartedInputIndexes: number[];
}

export interface MissingStoredTurnStartedDetails {
  eventType: ThreadEventType;
  scopeKind: ThreadEventScopeKind;
  threadId: string;
  turnId: string;
}

export class MissingStoredTurnStartedError extends Error {
  readonly details: MissingStoredTurnStartedDetails;

  constructor(details: MissingStoredTurnStartedDetails) {
    super(
      `Cannot append ${details.eventType} for turn ${details.turnId} before turn/started is stored`,
    );
    this.name = "MissingStoredTurnStartedError";
    this.details = details;
  }
}

export type AppendStoredThreadEventArgs<
  TType extends ThreadEventType = ThreadEventType,
> = {
  [TEventType in TType]: {
    data: StoredThreadEventDataForType<TEventType>;
    environmentId?: string | null;
    providerThreadId?: string | null;
    scope: ThreadEventScope;
    threadId: string;
    type: TEventType;
  };
}[TType];

export interface StoredTurnRequestEventRow {
  data: string;
  sequence: number;
  threadId: string;
  type: ThreadEventType;
}

export interface CompletedStoredTurnRow {
  threadId: string;
  turnId: string;
}

export interface ListThreadIdsWithLatestHostDaemonRestartInterruptionArgs {
  threadIds: readonly string[];
}

export interface ListThreadTurnInterruptionEventStatesArgs {
  threadIds: readonly string[];
}

export interface ThreadTurnInterruptionEventState {
  activeTurnId: string | null;
  latestProviderThreadId: string | null;
  threadId: string;
}

/**
 * Insert events with dedup on (threadId, sequence).
 * Uses INSERT OR IGNORE to skip duplicates.
 * Returns the count and input indexes of actually inserted events.
 */
export function insertEvents(
  db: DbQueryConnection,
  notifier: DbNotifier,
  eventInputs: InsertEventInput[],
): InsertEventsResult {
  if (eventInputs.length === 0) {
    return {
      insertedCount: 0,
      insertedInputIndexes: [],
    };
  }

  let insertedCount = 0;
  const insertedInputIndexes: number[] = [];

  const eventTypesByThreadId = new Map<string, Set<ThreadEventType>>();

  for (const [index, input] of eventInputs.entries()) {
    const id = createEventId();
    const createdAt = input.createdAt ?? Date.now();
    const turnId = getThreadEventScopeTurnId(input.scope) ?? null;
    const result = db.run(
      sql`INSERT OR IGNORE INTO events (id, thread_id, environment_id, scope_kind, turn_id, provider_thread_id, sequence, type, item_id, item_kind, data, created_at)
          VALUES (${id}, ${input.threadId}, ${input.environmentId ?? null}, ${input.scope.kind}, ${turnId}, ${input.providerThreadId ?? null}, ${input.sequence}, ${input.type}, ${input.itemId}, ${input.itemKind}, ${input.data}, ${createdAt})`,
    );
    if (result.changes > 0) {
      insertedCount++;
      insertedInputIndexes.push(index);
      const eventTypes = eventTypesByThreadId.get(input.threadId);
      if (eventTypes) {
        eventTypes.add(input.type);
      } else {
        eventTypesByThreadId.set(input.threadId, new Set([input.type]));
      }
    }
  }

  for (const [threadId, eventTypes] of eventTypesByThreadId) {
    notifier.notifyThread(threadId, ["events-appended"], {
      eventTypes: Array.from(eventTypes),
    });
  }

  return {
    insertedCount,
    insertedInputIndexes,
  };
}

function buildThreadTurnKey(args: ThreadTurnKey): string {
  return `${args.threadId}\0${args.turnId}`;
}

function listUniqueThreadTurnKeys(
  keys: readonly ThreadTurnKey[],
): ThreadTurnKey[] {
  const uniqueKeys: ThreadTurnKey[] = [];
  const seenKeys = new Set<string>();

  for (const key of keys) {
    const lookupKey = buildThreadTurnKey(key);
    if (seenKeys.has(lookupKey)) {
      continue;
    }
    seenKeys.add(lookupKey);
    uniqueKeys.push(key);
  }

  return uniqueKeys;
}

function collectDaemonTurnStartLookupKeys(
  eventInputs: readonly AppendDaemonEventInput[],
): ThreadTurnKey[] {
  const keys: ThreadTurnKey[] = [];

  for (const input of eventInputs) {
    if (input.type === "turn/started") {
      continue;
    }
    const turnId = getThreadEventScopeTurnId(input.scope);
    if (turnId === undefined) {
      continue;
    }
    keys.push({ threadId: input.threadId, turnId });
  }

  return keys;
}

function listStoredTurnStartedKeySet(
  db: DbQueryConnection,
  keys: readonly ThreadTurnKey[],
): Set<string> {
  return new Set(
    listStoredTurnStartedKeys(db, { keys }).map((key) =>
      buildThreadTurnKey(key),
    ),
  );
}

// Thread-state snapshots (token + context-window usage) are idempotent and are
// re-emitted by providers when a session resumes. A native fork resumes the
// parent's session, which reports the parent's last-turn usage scoped to a turn
// the forked thread never started. Dropping such an orphan snapshot is correct
// and avoids wedging the whole event batch (which would otherwise roll back the
// fork's identity + turn events and retry forever). Turn-content events still
// require a stored turn/started, so genuine ordering bugs are still caught.
const ORPHAN_DROPPABLE_TURN_EVENT_TYPES: ReadonlySet<ThreadEventType> = new Set([
  "thread/tokenUsage/updated",
  "thread/contextWindowUsage/updated",
]);

type DaemonTurnStartDisposition = "append" | "skip-orphan-snapshot";

function resolveDaemonTurnStartDisposition(
  input: AppendDaemonEventInput,
  startedTurnKeys: ReadonlySet<string>,
): DaemonTurnStartDisposition {
  if (input.type === "turn/started") {
    return "append";
  }

  const turnId = getThreadEventScopeTurnId(input.scope);
  if (turnId === undefined) {
    return "append";
  }

  const key = buildThreadTurnKey({ threadId: input.threadId, turnId });
  if (startedTurnKeys.has(key)) {
    return "append";
  }

  if (ORPHAN_DROPPABLE_TURN_EVENT_TYPES.has(input.type)) {
    return "skip-orphan-snapshot";
  }

  throw new MissingStoredTurnStartedError({
    eventType: input.type,
    scopeKind: input.scope.kind,
    threadId: input.threadId,
    turnId,
  });
}

function parseAcceptedInputClientRequestIdFromInput(
  input: AppendDaemonEventInput,
): ClientTurnRequestId | null {
  if (input.type !== "turn/input/accepted") {
    return null;
  }
  let data: unknown;
  try {
    data = JSON.parse(input.data);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null) {
    return null;
  }
  if (!("clientRequestId" in data)) {
    return null;
  }
  const result = clientTurnRequestIdSchema.safeParse(data.clientRequestId);
  if (!result.success) {
    return null;
  }
  return result.data;
}

export function appendDaemonEventsInTransaction(
  db: DbTransaction,
  eventInputs: readonly AppendDaemonEventInput[],
): AppendDaemonEventsResult {
  if (eventInputs.length === 0) {
    return {
      acceptedEvents: [],
      insertedInputIndexes: [],
      skippedTurnUnstartedInputIndexes: [],
    };
  }

  const threadIds = [...new Set(eventInputs.map((input) => input.threadId))];
  const highWaterMarks = getHighWaterMarks(db, threadIds);
  const nextSequencesByThreadId = new Map(
    threadIds.map((threadId) => [
      threadId,
      (highWaterMarks[threadId] ?? 0) + 1,
    ]),
  );
  const acceptedEvents: AcceptedDaemonEvent[] = [];
  const insertedInputIndexes: number[] = [];
  const skippedTurnUnstartedInputIndexes: number[] = [];

  const startedTurnKeys = listStoredTurnStartedKeySet(
    db,
    collectDaemonTurnStartLookupKeys(eventInputs),
  );
  const now = Date.now();
  for (const [index, input] of eventInputs.entries()) {
    if (
      resolveDaemonTurnStartDisposition(input, startedTurnKeys) ===
      "skip-orphan-snapshot"
    ) {
      skippedTurnUnstartedInputIndexes.push(index);
      continue;
    }

    const sequence = nextSequencesByThreadId.get(input.threadId);
    if (sequence === undefined) {
      throw new Error(`Missing event sequence for thread: ${input.threadId}`);
    }
    const turnId = getThreadEventScopeTurnId(input.scope) ?? null;
    db.run(
      sql`INSERT INTO events
        (id, thread_id, environment_id, scope_kind, turn_id, provider_thread_id, sequence, type, item_id, item_kind, data, created_at)
        VALUES (
          ${createEventId()},
          ${input.threadId},
          ${input.environmentId},
          ${input.scope.kind},
          ${turnId},
          ${input.providerThreadId},
          ${sequence},
          ${input.type},
          ${input.itemId},
          ${input.itemKind},
          ${input.data},
          ${now}
        )`,
    );

    const acceptedEvent: AcceptedDaemonEvent = {
      sequence,
      threadId: input.threadId,
    };
    acceptedEvents.push(acceptedEvent);
    insertedInputIndexes.push(index);
    if (input.type === "turn/started") {
      const turnId = getThreadEventScopeTurnId(input.scope);
      if (turnId !== undefined) {
        startedTurnKeys.add(
          buildThreadTurnKey({ threadId: input.threadId, turnId }),
        );
      }
    }
    const acceptedClientRequestId =
      parseAcceptedInputClientRequestIdFromInput(input);
    if (acceptedClientRequestId !== null) {
      void acceptedClientRequestId;
    }
    nextSequencesByThreadId.set(input.threadId, sequence + 1);
  }

  return {
    acceptedEvents,
    insertedInputIndexes,
    skippedTurnUnstartedInputIndexes,
  };
}

export function appendStoredThreadEventInTransaction<
  TType extends ThreadEventType,
>(db: DbTransaction, args: AppendStoredThreadEventArgs<TType>): number;
export function appendStoredThreadEventInTransaction(
  db: DbTransaction,
  args: AppendStoredThreadEventArgs,
): number {
  const [sequence] = appendStoredThreadEventsInTransaction(db, [args]);
  if (sequence === undefined) {
    throw new Error("Expected one appended thread event sequence");
  }
  return sequence;
}

export function appendStoredThreadEventsInTransaction(
  db: DbTransaction,
  eventArgs: readonly AppendStoredThreadEventArgs[],
): number[] {
  if (eventArgs.length === 0) {
    return [];
  }

  const now = Date.now();
  const threadIds = [...new Set(eventArgs.map((args) => args.threadId))];
  const highWaterMarks = getHighWaterMarks(db, threadIds);
  const nextSequencesByThreadId = new Map(
    threadIds.map((threadId) => [
      threadId,
      (highWaterMarks[threadId] ?? 0) + 1,
    ]),
  );

  const sequences: number[] = [];
  for (const args of eventArgs) {
    const sequence = nextSequencesByThreadId.get(args.threadId);
    if (sequence === undefined) {
      throw new Error(`Missing event sequence for thread: ${args.threadId}`);
    }

    const itemFields = deriveStoredEventItemFieldsFromSource({
      type: args.type,
      item: "item" in args.data ? args.data.item : undefined,
      itemId: "itemId" in args.data ? args.data.itemId : undefined,
    });
    const turnId = getThreadEventScopeTurnId(args.scope) ?? null;

    db.run(
      sql`INSERT INTO events
        (id, thread_id, environment_id, scope_kind, turn_id, provider_thread_id, sequence, type, item_id, item_kind, data, created_at)
        VALUES (
          ${createEventId()},
          ${args.threadId},
          ${args.environmentId ?? null},
          ${args.scope.kind},
          ${turnId},
          ${args.providerThreadId ?? null},
          ${sequence},
          ${args.type},
          ${itemFields.itemId},
          ${itemFields.itemKind},
          ${JSON.stringify(args.data)},
          ${now}
        )`,
    );

    sequences.push(sequence);
    nextSequencesByThreadId.set(args.threadId, sequence + 1);
  }

  return sequences;
}

export function appendStoredThreadEvent<TType extends ThreadEventType>(
  db: DbConnection,
  notifier: DbNotifier,
  args: AppendStoredThreadEventArgs<TType>,
): number;
export function appendStoredThreadEvent(
  db: DbConnection,
  notifier: DbNotifier,
  args: AppendStoredThreadEventArgs,
): number {
  const sequence = db.transaction(
    (tx) => appendStoredThreadEventInTransaction(tx, args),
    { behavior: "immediate" },
  );
  notifier.notifyThread(args.threadId, ["events-appended"], {
    eventTypes: [args.type],
  });
  return sequence;
}

/**
 * Get high-water marks (max sequence) per thread.
 * Returns Record<threadId, maxSequence>.
 */
export function getHighWaterMarks(
  db: DbQueryConnection,
  threadIds?: string[],
): Record<string, number> {
  const result: Record<string, number> = {};

  if (threadIds && threadIds.length > 0) {
    const rows = db
      .select({
        threadId: events.threadId,
        maxSeq: max(events.sequence),
      })
      .from(events)
      .where(inArray(events.threadId, threadIds))
      .groupBy(events.threadId)
      .all();
    for (const row of rows) {
      if (row.maxSeq != null) {
        result[row.threadId] = row.maxSeq;
      }
    }
  } else {
    const rows = db
      .select({
        threadId: events.threadId,
        maxSeq: max(events.sequence),
      })
      .from(events)
      .groupBy(events.threadId)
      .all();
    for (const row of rows) {
      if (row.maxSeq != null) {
        result[row.threadId] = row.maxSeq;
      }
    }
  }

  return result;
}

export interface ListEventsOptions {
  threadId: string;
  afterSequence?: number;
  limit?: number;
}

const storedEventRowFields = {
  createdAt: events.createdAt,
  data: events.data,
  id: events.id,
  itemId: events.itemId,
  itemKind: events.itemKind,
  providerThreadId: events.providerThreadId,
  scopeKind: events.scopeKind,
  sequence: events.sequence,
  threadId: events.threadId,
  turnId: events.turnId,
  type: events.type,
};

export type StoredEventRow = Pick<
  typeof events.$inferSelect,
  keyof typeof storedEventRowFields
>;

export interface ListStoredEventRowsArgs {
  afterSequence?: number;
  limit?: number;
  threadId: string;
}

export interface FindStoredEventRowArgs {
  afterSequence?: number;
  threadId: string;
  type: ThreadEventType;
}

export interface ListStoredEventRowsInRangeArgs {
  seqEnd: number;
  seqStart: number;
  threadId: string;
}

export interface ListStoredTurnInputAcceptedRowsByClientRequestIdsArgs {
  afterSequence: number;
  clientRequestIds: readonly ClientTurnRequestId[];
  threadId: string;
}

export interface ListStoredClientTurnRequestIdsInRangeArgs {
  seqEnd: number;
  seqStart: number;
  threadId: string;
}

export interface FindStoredClientTurnRequestSequenceByRequestIdArgs {
  requestId: ClientTurnRequestId;
  threadId: string;
}

export interface ListStoredThreadProvisioningRowsByProvisioningIdArgs {
  provisioningId: string;
  threadId: string;
}

export interface GetLatestThreadInterruptedReasonArgs {
  threadId: string;
}

export interface ListStoredTurnStartedRowsByTurnIdsUpToSequenceArgs {
  sequenceCutoff: number;
  threadId: string;
  turnIds: readonly string[];
}

export interface HasStoredTurnStartedArgs {
  threadId: string;
  turnId: string;
}

export interface ThreadTurnKey {
  threadId: string;
  turnId: string;
}

export interface ListStoredTurnStartedKeysArgs {
  keys: readonly ThreadTurnKey[];
}

export interface ListRecentStoredEventRowsArgs {
  excludedTypes?: readonly ThreadEventType[];
  threadId: string;
}

export interface ListStoredTimelineWindowEventRowsArgs {
  beforeSequence?: number;
  excludedTypes?: readonly ThreadEventType[];
  sequenceStart: number;
  threadId: string;
}

export interface ListContextWindowUsageRowsArgs {
  threadId: string;
}

export interface GetLatestThreadOutputEventRowArgs {
  threadId: string;
}

export interface GetLatestThreadSystemErrorEventRowArgs {
  threadId: string;
}

export interface GetLatestThreadSequenceArgs {
  threadId: string;
}

export interface PruneThreadEventsBeforeSequenceArgs {
  sequenceCutoff: number;
  threadId: string;
  types: readonly ThreadEventType[];
}

export interface PruneContextWindowUsageEventsBeforeSequenceArgs {
  sequenceCutoff: number;
  threadId: string;
}

export interface PruneTokenUsageEventsBeforeSequenceArgs {
  sequenceCutoff: number;
  threadId: string;
}

export interface PruneResolvedItemDeltasArgs {
  threadId: string;
}

export interface PruneBackgroundTaskProgressEventsArgs {
  threadId: string;
}

export interface ListOpenBackgroundTaskItemRowsForHostArgs {
  hostId: string;
}

export interface OpenBackgroundTaskItemRow {
  /** Raw data JSON of the latest lifecycle row; carries the item payload. */
  data: string;
  environmentId: string | null;
  itemId: string;
  providerThreadId: string | null;
  threadId: string;
}

export function listEvents(db: DbConnection, options: ListEventsOptions) {
  const { threadId, afterSequence, limit } = options;

  if (afterSequence != null) {
    const q = db
      .select()
      .from(events)
      .where(
        sql`${events.threadId} = ${threadId} AND ${events.sequence} > ${afterSequence}`,
      )
      .orderBy(events.sequence);
    if (limit) return q.limit(limit).all();
    return q.all();
  }

  const q = db
    .select()
    .from(events)
    .where(eq(events.threadId, threadId))
    .orderBy(events.sequence);
  if (limit) return q.limit(limit).all();
  return q.all();
}

export function listStoredEventRows(
  db: DbConnection,
  args: ListStoredEventRowsArgs,
): StoredEventRow[] {
  return db
    .select(storedEventRowFields)
    .from(events)
    .where(
      args.afterSequence === undefined
        ? eq(events.threadId, args.threadId)
        : and(
            eq(events.threadId, args.threadId),
            gt(events.sequence, args.afterSequence),
          ),
    )
    .orderBy(events.sequence)
    .limit(args.limit ?? Number.MAX_SAFE_INTEGER)
    .all();
}

export function findStoredEventRow(
  db: DbConnection,
  args: FindStoredEventRowArgs,
): StoredEventRow | null {
  return (
    db
      .select(storedEventRowFields)
      .from(events)
      .where(
        args.afterSequence !== undefined
          ? and(
              eq(events.threadId, args.threadId),
              eq(events.type, args.type),
              gt(events.sequence, args.afterSequence),
            )
          : and(eq(events.threadId, args.threadId), eq(events.type, args.type)),
      )
      .orderBy(events.sequence)
      .limit(1)
      .get() ?? null
  );
}

export function listStoredEventRowsInRange(
  db: DbConnection,
  args: ListStoredEventRowsInRangeArgs,
): StoredEventRow[] {
  return db
    .select(storedEventRowFields)
    .from(events)
    .where(
      and(
        eq(events.threadId, args.threadId),
        gte(events.sequence, args.seqStart),
        lte(events.sequence, args.seqEnd),
      ),
    )
    .orderBy(events.sequence)
    .all();
}

export function listStoredClientTurnRequestIdsInRange(
  db: DbConnection,
  args: ListStoredClientTurnRequestIdsInRangeArgs,
): ClientTurnRequestId[] {
  const rows = db
    .select({
      requestId: sql<string | null>`json_extract(${events.data}, '$.requestId')`,
    })
    .from(events)
    .where(
      and(
        eq(events.threadId, args.threadId),
        eq(events.type, "client/turn/requested"),
        gte(events.sequence, args.seqStart),
        lte(events.sequence, args.seqEnd),
      ),
    )
    .orderBy(events.sequence)
    .all();

  return rows.map((row) => clientTurnRequestIdSchema.parse(row.requestId));
}

export function findStoredClientTurnRequestSequenceByRequestId(
  db: DbQueryConnection,
  args: FindStoredClientTurnRequestSequenceByRequestIdArgs,
): number | null {
  const row =
    db
      .select({
        sequence: events.sequence,
      })
      .from(events)
      .where(
        and(
          eq(events.threadId, args.threadId),
          eq(events.type, "client/turn/requested"),
          sql`json_extract(${events.data}, '$.requestId') = ${args.requestId}`,
        ),
      )
      .limit(1)
      .get() ?? null;
  return row?.sequence ?? null;
}

export function listStoredTurnInputAcceptedRowsByClientRequestIds(
  db: DbConnection,
  args: ListStoredTurnInputAcceptedRowsByClientRequestIdsArgs,
): StoredEventRow[] {
  if (args.clientRequestIds.length === 0) {
    return [];
  }

  const clientRequestIdConditions = args.clientRequestIds.map(
    (clientRequestId) =>
      sql`json_extract(${events.data}, '$.clientRequestId') = ${clientRequestId}`,
  );

  return db
    .select(storedEventRowFields)
    .from(events)
    .where(
      and(
        eq(events.threadId, args.threadId),
        eq(events.type, "turn/input/accepted"),
        gt(events.sequence, args.afterSequence),
        or(...clientRequestIdConditions),
      ),
    )
    .orderBy(events.sequence)
    .all();
}

export function listStoredThreadProvisioningRowsByProvisioningId(
  db: DbQueryConnection,
  args: ListStoredThreadProvisioningRowsByProvisioningIdArgs,
): StoredEventRow[] {
  return db
    .select(storedEventRowFields)
    .from(events)
    .where(
      and(
        eq(events.threadId, args.threadId),
        eq(events.type, "system/thread-provisioning"),
        sql`json_extract(${events.data}, '$.provisioningId') = ${args.provisioningId}`,
      ),
    )
    .orderBy(events.sequence)
    .all();
}

export function getLatestThreadInterruptedReason(
  db: DbQueryConnection,
  args: GetLatestThreadInterruptedReasonArgs,
): SystemThreadInterruptedReason | null {
  const row = db
    .select({
      reason: sql<string>`json_extract(${events.data}, '$.reason')`,
    })
    .from(events)
    .where(
      and(
        eq(events.threadId, args.threadId),
        eq(events.type, "system/thread/interrupted"),
      ),
    )
    .orderBy(desc(events.sequence))
    .limit(1)
    .get();
  if (!row) {
    return null;
  }
  return systemThreadInterruptedReasonSchema.parse(row.reason);
}

export function listStoredTurnStartedRowsByTurnIdsUpToSequence(
  db: DbConnection,
  args: ListStoredTurnStartedRowsByTurnIdsUpToSequenceArgs,
): StoredEventRow[] {
  if (args.turnIds.length === 0) {
    return [];
  }

  return db
    .select(storedEventRowFields)
    .from(events)
    .where(
      and(
        eq(events.threadId, args.threadId),
        eq(events.type, "turn/started"),
        inArray(events.turnId, [...args.turnIds]),
        lte(events.sequence, args.sequenceCutoff),
      ),
    )
    .orderBy(events.sequence)
    .all();
}

export interface ListLatestBackgroundTaskStateRowsByItemIdsArgs {
  itemIds: readonly string[];
  threadId: string;
}

/**
 * Latest thread-scoped lifecycle row per backgroundTask item, regardless of
 * sequence. Timeline windows backfill these for in-window items so a page
 * containing only the spawning turn still renders the task's current/terminal
 * state (which may live many sequences past the window's end).
 */
export function listLatestBackgroundTaskStateRowsByItemIds(
  db: DbConnection,
  args: ListLatestBackgroundTaskStateRowsByItemIdsArgs,
): StoredEventRow[] {
  if (args.itemIds.length === 0) {
    return [];
  }

  const stateTypes = [
    "item/backgroundTask/progress",
    "item/backgroundTask/completed",
  ] satisfies ThreadEventType[];
  const latest = alias(events, "latest_background_task_state");

  // (threadId, sequence) is unique, so matching the per-item MAX(sequence)
  // set selects exactly one row per item in SQL instead of loading every
  // snapshot row and folding in JS.
  return db
    .select(storedEventRowFields)
    .from(events)
    .where(
      and(
        eq(events.threadId, args.threadId),
        inArray(
          events.sequence,
          db
            .select({ sequence: max(latest.sequence) })
            .from(latest)
            .where(
              and(
                eq(latest.threadId, args.threadId),
                inArray(latest.itemId, [...args.itemIds]),
                inArray(latest.type, stateTypes),
              ),
            )
            .groupBy(latest.itemId),
        ),
      ),
    )
    .orderBy(events.sequence)
    .all();
}

function listStoredTurnStartedKeysChunk(
  db: DbQueryConnection,
  keys: readonly ThreadTurnKey[],
): ThreadTurnKey[] {
  const turnConditions = keys.map((key) =>
    and(eq(events.threadId, key.threadId), eq(events.turnId, key.turnId)),
  );

  const rows = db
    .select({ threadId: events.threadId, turnId: events.turnId })
    .from(events)
    .where(and(eq(events.type, "turn/started"), or(...turnConditions)))
    .all();

  return rows.flatMap((row) =>
    row.turnId === null
      ? []
      : [{ threadId: row.threadId, turnId: row.turnId }],
  );
}

export function listStoredTurnStartedKeys(
  db: DbQueryConnection,
  args: ListStoredTurnStartedKeysArgs,
): ThreadTurnKey[] {
  if (args.keys.length === 0) {
    return [];
  }

  const uniqueKeys = listUniqueThreadTurnKeys(args.keys);
  const rows: ThreadTurnKey[] = [];
  for (
    let offset = 0;
    offset < uniqueKeys.length;
    offset += STORED_EVENT_SEQUENCE_LOOKUP_CHUNK_SIZE
  ) {
    rows.push(
      ...listStoredTurnStartedKeysChunk(
        db,
        uniqueKeys.slice(
          offset,
          offset + STORED_EVENT_SEQUENCE_LOOKUP_CHUNK_SIZE,
        ),
      ),
    );
  }
  return rows;
}

export function hasStoredTurnStarted(
  db: DbQueryConnection,
  args: HasStoredTurnStartedArgs,
): boolean {
  const row = db
    .select({ sequence: events.sequence })
    .from(events)
    .where(
      and(
        eq(events.threadId, args.threadId),
        eq(events.type, "turn/started"),
        eq(events.turnId, args.turnId),
      ),
    )
    .limit(1)
    .get();

  return row !== undefined;
}

export function listRecentStoredEventRows(
  db: DbConnection,
  args: ListRecentStoredEventRowsArgs,
): StoredEventRow[] {
  const condition =
    args.excludedTypes && args.excludedTypes.length > 0
      ? and(
          eq(events.threadId, args.threadId),
          notInArray(events.type, [...args.excludedTypes]),
        )
      : eq(events.threadId, args.threadId);

  return db
    .select(storedEventRowFields)
    .from(events)
    .where(condition)
    .orderBy(events.sequence)
    .all();
}

export interface StandardTimelineSegmentAnchorRow {
  rowId: string;
  sequence: number;
}

function timelineSegmentAnchorSelection() {
  return {
    rowId: sql<string>`${events.threadId} || ':user-seed:' || ${events.sequence}`,
    sequence: events.sequence,
  };
}

function timelineSegmentAnchorConditions(threadId: string): SQL | undefined {
  return and(
    eq(events.threadId, threadId),
    eq(events.type, "client/turn/requested"),
    sql`(
      COALESCE(json_extract(${events.data}, '$.target.kind'), 'new-turn')
        IN ('thread-start', 'new-turn')
      OR (
        json_extract(${events.data}, '$.target.kind') = 'auto'
        AND json_extract(${events.data}, '$.target.expectedTurnId') IS NULL
      )
    )`,
    sql`EXISTS (
      SELECT 1
      FROM json_each(${events.data}, '$.input') AS input_part
      WHERE (
        json_extract(input_part.value, '$.type') = 'text'
        AND COALESCE(json_extract(input_part.value, '$.text'), '') <> ''
      )
      OR json_extract(input_part.value, '$.type')
        IN ('image', 'localImage', 'localFile')
    )`,
  );
}

export interface ListTimelineSegmentAnchorsDescendingArgs {
  threadId: string;
  /** Restrict to anchors strictly before this sequence (exclusive). */
  beforeSequence?: number;
  limit: number;
}

/**
 * Newest-first segment anchors, bounded by `limit` (and optionally by
 * `beforeSequence`). Lets the timeline resolve a page's window without
 * enumerating every anchor in the thread.
 */
export function listTimelineSegmentAnchorsDescending(
  db: DbConnection,
  args: ListTimelineSegmentAnchorsDescendingArgs,
): StandardTimelineSegmentAnchorRow[] {
  const conditions = timelineSegmentAnchorConditions(args.threadId);
  const where =
    args.beforeSequence === undefined
      ? conditions
      : and(conditions, lt(events.sequence, args.beforeSequence));
  return db
    .select(timelineSegmentAnchorSelection())
    .from(events)
    .where(where)
    .orderBy(desc(events.sequence))
    .limit(args.limit)
    .all();
}

export interface TimelineSegmentAnchorLookupArgs {
  threadId: string;
  sequence: number;
}

/** The first segment anchor strictly after `sequence`, if any. */
export function findTimelineSegmentAnchorSequenceAfter(
  db: DbConnection,
  args: TimelineSegmentAnchorLookupArgs,
): number | undefined {
  const row = db
    .select({ sequence: events.sequence })
    .from(events)
    .where(
      and(
        timelineSegmentAnchorConditions(args.threadId),
        gt(events.sequence, args.sequence),
      ),
    )
    .orderBy(events.sequence)
    .limit(1)
    .get();
  return row?.sequence;
}

/** The segment anchor at exactly `sequence`, if that turn qualifies as one. */
export function getTimelineSegmentAnchorAtSequence(
  db: DbConnection,
  args: TimelineSegmentAnchorLookupArgs,
): StandardTimelineSegmentAnchorRow | undefined {
  return db
    .select(timelineSegmentAnchorSelection())
    .from(events)
    .where(
      and(
        timelineSegmentAnchorConditions(args.threadId),
        eq(events.sequence, args.sequence),
      ),
    )
    .limit(1)
    .get();
}

export function listStoredTimelineWindowEventRows(
  db: DbConnection,
  args: ListStoredTimelineWindowEventRowsArgs,
): StoredEventRow[] {
  const conditions: SQL[] = [
    eq(events.threadId, args.threadId),
    gte(events.sequence, args.sequenceStart),
  ];
  if (args.beforeSequence !== undefined) {
    conditions.push(lt(events.sequence, args.beforeSequence));
  }
  if (args.excludedTypes && args.excludedTypes.length > 0) {
    conditions.push(notInArray(events.type, [...args.excludedTypes]));
  }

  return db
    .select(storedEventRowFields)
    .from(events)
    .where(and(...conditions))
    .orderBy(events.sequence)
    .all();
}

function listLatestRowsForContextWindowUsage(
  db: DbConnection,
  args: {
    contextWindowJsonPath: string;
    eventType:
      | "thread/contextWindowUsage/updated"
      | "thread/tokenUsage/updated";
    threadId: string;
  },
): StoredEventRow[] {
  const latestRow = db
    .select(storedEventRowFields)
    .from(events)
    .where(
      and(eq(events.threadId, args.threadId), eq(events.type, args.eventType)),
    )
    .orderBy(desc(events.sequence))
    .limit(1)
    .get();

  if (!latestRow) {
    return [];
  }

  const latestContextRow = db
    .select(storedEventRowFields)
    .from(events)
    .where(
      and(
        eq(events.threadId, args.threadId),
        eq(events.type, args.eventType),
        sql`json_extract(${events.data}, ${args.contextWindowJsonPath}) IS NOT NULL`,
      ),
    )
    .orderBy(desc(events.sequence))
    .limit(1)
    .get();

  if (!latestContextRow || latestContextRow.id === latestRow.id) {
    return [latestRow];
  }

  return [latestContextRow, latestRow];
}

export function listContextWindowUsageRows(
  db: DbConnection,
  args: ListContextWindowUsageRowsArgs,
): StoredEventRow[] {
  return listLatestRowsForContextWindowUsage(db, {
    threadId: args.threadId,
    eventType: "thread/contextWindowUsage/updated",
    contextWindowJsonPath: "$.contextWindowUsage.modelContextWindow",
  });
}

export function getLatestThreadOutputEventRow(
  db: DbConnection,
  args: GetLatestThreadOutputEventRowArgs,
): StoredEventRow | null {
  return (
    db
      .select(storedEventRowFields)
      .from(events)
      .where(
        sql`${events.threadId} = ${args.threadId} AND (
        (
          ${events.type} = 'system/manager/user_message'
          AND COALESCE(json_extract(${events.data}, '$.text'), '') <> ''
        )
        OR (
          ${events.type} = 'item/completed'
          AND ${events.itemKind} = 'agentMessage'
          AND COALESCE(json_extract(${events.data}, '$.item.text'), '') <> ''
        )
      )`,
      )
      .orderBy(desc(events.sequence))
      .limit(1)
      .get() ?? null
  );
}

export function getLatestThreadSystemErrorEventRow(
  db: DbConnection,
  args: GetLatestThreadSystemErrorEventRowArgs,
): StoredEventRow | null {
  return (
    db
      .select(storedEventRowFields)
      .from(events)
      .where(
        and(eq(events.threadId, args.threadId), eq(events.type, "system/error")),
      )
      .orderBy(desc(events.sequence))
      .limit(1)
      .get() ?? null
  );
}

export function getLatestThreadSequence(
  db: DbConnection,
  args: GetLatestThreadSequenceArgs,
): number {
  const row = db
    .select({
      maxSequence: max(events.sequence),
    })
    .from(events)
    .where(eq(events.threadId, args.threadId))
    .get();

  return row?.maxSequence ?? 0;
}

export function getActiveStoredTurnId(
  db: DbQueryConnection,
  threadId: string,
): string | null {
  const latestStarted = db
    .select({ turnId: events.turnId })
    .from(events)
    .where(
      and(
        eq(events.threadId, threadId),
        eq(events.type, "turn/started"),
        isNotNull(events.turnId),
      ),
    )
    .orderBy(desc(events.sequence))
    .limit(1)
    .get();

  if (!latestStarted?.turnId) {
    return null;
  }

  const completed = db
    .select({ sequence: events.sequence })
    .from(events)
    .where(
      and(
        eq(events.threadId, threadId),
        eq(events.turnId, latestStarted.turnId),
        eq(events.type, "turn/completed"),
      ),
    )
    .limit(1)
    .get();

  return completed ? null : latestStarted.turnId;
}

export function getLastStoredProviderThreadId(
  db: DbQueryConnection,
  threadId: string,
): string | null {
  const row = db
    .select({ providerThreadId: events.providerThreadId })
    .from(events)
    .where(
      sql`${events.threadId} = ${threadId}
        AND ${events.providerThreadId} IS NOT NULL`,
    )
    .orderBy(sql`${events.sequence} DESC`)
    .limit(1)
    .get();
  return row?.providerThreadId ?? null;
}

export function listThreadTurnInterruptionEventStates(
  db: DbQueryConnection,
  args: ListThreadTurnInterruptionEventStatesArgs,
): ThreadTurnInterruptionEventState[] {
  const threadIds = [...new Set(args.threadIds)];
  if (threadIds.length === 0) {
    return [];
  }

  const statesByThreadId = new Map<string, ThreadTurnInterruptionEventState>(
    threadIds.map((threadId) => [
      threadId,
      {
        activeTurnId: null,
        latestProviderThreadId: null,
        threadId,
      },
    ]),
  );

  const latestStartedTurnRows = db
    .select({
      threadId: events.threadId,
      turnId: events.turnId,
    })
    .from(events)
    .where(
      and(
        inArray(events.threadId, threadIds),
        eq(events.type, "turn/started"),
        isNotNull(events.turnId),
        sql`${events.sequence} = (
          SELECT MAX(latest.sequence)
          FROM events AS latest
          WHERE latest.thread_id = ${events.threadId}
            AND latest.type = 'turn/started'
            AND latest.turn_id IS NOT NULL
        )`,
        sql`NOT EXISTS (
          SELECT 1
          FROM events AS completed
          WHERE completed.thread_id = ${events.threadId}
            AND completed.turn_id = ${events.turnId}
            AND completed.type = 'turn/completed'
        )`,
      ),
    )
    .all();
  for (const row of latestStartedTurnRows) {
    if (row.turnId === null) {
      continue;
    }
    const state = statesByThreadId.get(row.threadId);
    if (state) {
      state.activeTurnId = row.turnId;
    }
  }

  const latestProviderRows = db
    .select({
      providerThreadId: events.providerThreadId,
      threadId: events.threadId,
    })
    .from(events)
    .where(
      and(
        inArray(events.threadId, threadIds),
        isNotNull(events.providerThreadId),
        sql`${events.sequence} = (
          SELECT MAX(latest.sequence)
          FROM events AS latest
          WHERE latest.thread_id = ${events.threadId}
            AND latest.provider_thread_id IS NOT NULL
        )`,
      ),
    )
    .all();
  for (const row of latestProviderRows) {
    if (row.providerThreadId === null) {
      continue;
    }
    const state = statesByThreadId.get(row.threadId);
    if (state) {
      state.latestProviderThreadId = row.providerThreadId;
    }
  }

  return threadIds.flatMap((threadId) => {
    const state = statesByThreadId.get(threadId);
    return state ? [state] : [];
  });
}

export function listThreadIdsWithLatestHostDaemonRestartInterruption(
  db: DbConnection,
  args: ListThreadIdsWithLatestHostDaemonRestartInterruptionArgs,
): string[] {
  if (args.threadIds.length === 0) {
    return [];
  }

  return db
    .select({ threadId: events.threadId })
    .from(events)
    .where(
      and(
        inArray(events.threadId, [...args.threadIds]),
        eq(events.type, "system/thread/interrupted"),
        sql`json_extract(${events.data}, '$.reason') = 'host-daemon-restarted'`,
        sql`${events.sequence} = (
          SELECT MAX(latest.sequence)
          FROM events AS latest
          WHERE latest.thread_id = ${events.threadId}
        )`,
      ),
    )
    .all()
    .map((row) => row.threadId);
}

export function getLastStoredTurnRequestEvent(
  db: DbQueryConnection,
  threadId: string,
): StoredTurnRequestEventRow | null {
  return (
    db
      .select({
        data: events.data,
        sequence: events.sequence,
        threadId: events.threadId,
        type: events.type,
      })
      .from(events)
      .where(
        sql`${events.threadId} = ${threadId}
        AND (
          ${events.type} = 'client/turn/requested'
          OR (
            ${events.type} IN ('client/thread/start', 'client/turn/start')
            AND json_type(${events.data}, '$.input') IS NOT NULL
          )
        )`,
      )
      .orderBy(sql`${events.sequence} DESC`)
      .limit(1)
      .get() ?? null
  );
}

export function listCompletedTurnsByThreadIds(
  db: DbQueryConnection,
  threadIds: readonly string[],
): CompletedStoredTurnRow[] {
  if (threadIds.length === 0) {
    return [];
  }

  return db
    .select({
      threadId: events.threadId,
      turnId: events.turnId,
    })
    .from(events)
    .where(
      and(
        inArray(events.threadId, [...threadIds]),
        eq(events.type, "turn/completed"),
        isNotNull(events.turnId),
      ),
    )
    .all()
    .flatMap((row) =>
      row.turnId === null
        ? []
        : [
            {
              threadId: row.threadId,
              turnId: row.turnId,
            },
          ],
    );
}

export function pruneThreadEventsBeforeSequence(
  db: DbConnection,
  args: PruneThreadEventsBeforeSequenceArgs,
): number {
  if (args.sequenceCutoff <= 0 || args.types.length === 0) {
    return 0;
  }

  const result = db
    .delete(events)
    .where(
      and(
        eq(events.threadId, args.threadId),
        lte(events.sequence, args.sequenceCutoff),
        inArray(events.type, [...args.types]),
      ),
    )
    .run();

  return result.changes;
}

function pruneLatestRowsForContextWindowUsageBeforeSequence(
  db: DbConnection,
  args: {
    contextWindowJsonPath: string;
    eventType:
      | "thread/contextWindowUsage/updated"
      | "thread/tokenUsage/updated";
    sequenceCutoff: number;
    threadId: string;
  },
): number {
  if (args.sequenceCutoff <= 0) {
    return 0;
  }

  // The timeline needs the latest totals row plus the latest older row that
  // still carries a non-null modelContextWindow.
  const result = db.run(
    sql`DELETE FROM events
        WHERE ${events.threadId} = ${args.threadId}
          AND ${events.type} = ${args.eventType}
          AND ${events.sequence} <= ${args.sequenceCutoff}
          AND ${events.id} NOT IN (
            SELECT latest.id
            FROM events latest
            WHERE latest.thread_id = ${args.threadId}
              AND latest.type = ${args.eventType}
            ORDER BY latest.sequence DESC
            LIMIT 1
          )
          AND ${events.id} NOT IN (
            SELECT latest_context.id
            FROM events latest_context
            WHERE latest_context.thread_id = ${args.threadId}
              AND latest_context.type = ${args.eventType}
              AND json_extract(latest_context.data, ${args.contextWindowJsonPath}) IS NOT NULL
            ORDER BY latest_context.sequence DESC
            LIMIT 1
          )`,
  );

  return result.changes;
}

export function pruneContextWindowUsageEventsBeforeSequence(
  db: DbConnection,
  args: PruneContextWindowUsageEventsBeforeSequenceArgs,
): number {
  return pruneLatestRowsForContextWindowUsageBeforeSequence(db, {
    threadId: args.threadId,
    sequenceCutoff: args.sequenceCutoff,
    eventType: "thread/contextWindowUsage/updated",
    contextWindowJsonPath: "$.contextWindowUsage.modelContextWindow",
  });
}

export function pruneTokenUsageEventsBeforeSequence(
  db: DbConnection,
  args: PruneTokenUsageEventsBeforeSequenceArgs,
): number {
  return pruneLatestRowsForContextWindowUsageBeforeSequence(db, {
    threadId: args.threadId,
    sequenceCutoff: args.sequenceCutoff,
    eventType: "thread/tokenUsage/updated",
    contextWindowJsonPath: "$.tokenUsage.modelContextWindow",
  });
}

export function pruneResolvedItemDeltas(
  db: DbConnection,
  args: PruneResolvedItemDeltasArgs,
): number {
  type PrunableResolvedDeltaEventType = Extract<
    ThreadEventType,
    | "item/agentMessage/delta"
    | "item/commandExecution/outputDelta"
    | "item/reasoning/summaryTextDelta"
    | "item/reasoning/textDelta"
  >;
  type PrunableResolvedDeltaCompletionItemKind = Extract<
    ThreadEventItemType,
    "agentMessage" | "commandExecution" | "reasoning"
  >;

  // File-change output deltas and plan deltas are intentionally excluded here:
  // their completed events do not carry a replayable aggregate for the streamed
  // text. Once a completed command row has aggregatedOutput, all matching
  // command output deltas are redundant regardless of reset markers.
  const prunableDeltaMatches = {
    "item/agentMessage/delta": "agentMessage",
    "item/commandExecution/outputDelta": "commandExecution",
    "item/reasoning/summaryTextDelta": "reasoning",
    "item/reasoning/textDelta": "reasoning",
  } satisfies Record<
    PrunableResolvedDeltaEventType,
    PrunableResolvedDeltaCompletionItemKind
  >;
  const itemCompletedType = "item/completed" satisfies ThreadEventType;

  const result = db.run(
    sql`DELETE FROM events
        WHERE ${events.threadId} = ${args.threadId}
          AND ${events.type} IN (
            ${"item/agentMessage/delta" satisfies PrunableResolvedDeltaEventType},
            ${"item/commandExecution/outputDelta" satisfies PrunableResolvedDeltaEventType},
            ${"item/reasoning/summaryTextDelta" satisfies PrunableResolvedDeltaEventType},
            ${"item/reasoning/textDelta" satisfies PrunableResolvedDeltaEventType}
          )
          AND ${events.itemId} IS NOT NULL
          AND ${events.turnId} IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM events completed
            WHERE completed.thread_id = ${events.threadId}
              AND completed.turn_id = ${events.turnId}
              AND completed.type = ${itemCompletedType}
              AND completed.item_kind = CASE
                WHEN ${events.type} = ${"item/agentMessage/delta" satisfies PrunableResolvedDeltaEventType}
                  THEN ${prunableDeltaMatches["item/agentMessage/delta"]}
                WHEN ${events.type} = ${"item/commandExecution/outputDelta" satisfies PrunableResolvedDeltaEventType}
                  THEN ${prunableDeltaMatches["item/commandExecution/outputDelta"]}
                WHEN ${events.type} = ${"item/reasoning/summaryTextDelta" satisfies PrunableResolvedDeltaEventType}
                  THEN ${prunableDeltaMatches["item/reasoning/summaryTextDelta"]}
                WHEN ${events.type} = ${"item/reasoning/textDelta" satisfies PrunableResolvedDeltaEventType}
                  THEN ${prunableDeltaMatches["item/reasoning/textDelta"]}
              END
              AND completed.item_id = ${events.itemId}
              AND (
                ${events.type} <> ${"item/commandExecution/outputDelta" satisfies PrunableResolvedDeltaEventType}
                OR json_type(completed.data, '$.item.aggregatedOutput') IS NOT NULL
              )
              AND COALESCE(json_extract(completed.data, '$.item.parentToolCallId'), '') =
                COALESCE(json_extract(${events.data}, '$.parentToolCallId'), '')
          )
          AND EXISTS (
            SELECT 1
            FROM events earlier_delta
            WHERE earlier_delta.thread_id = ${events.threadId}
              AND earlier_delta.turn_id = ${events.turnId}
              AND earlier_delta.type = ${events.type}
              AND earlier_delta.item_id = ${events.itemId}
              AND COALESCE(json_extract(earlier_delta.data, '$.parentToolCallId'), '') =
                COALESCE(json_extract(${events.data}, '$.parentToolCallId'), '')
              AND earlier_delta.sequence < ${events.sequence}
          )`,
  );

  return result.changes;
}

/**
 * Latest lifecycle row per open backgroundTask item across all threads on a
 * host. "Open" = no item/backgroundTask/completed row exists for the item.
 * Used by the server's daemon-restart backstop: when the daemon's in-memory
 * task state is lost, these are the items nobody will ever settle.
 */
export function listOpenBackgroundTaskItemRowsForHost(
  db: DbQueryConnection,
  args: ListOpenBackgroundTaskItemRowsForHostArgs,
): OpenBackgroundTaskItemRow[] {
  const startedType = "item/started" satisfies ThreadEventType;
  const progressType =
    "item/backgroundTask/progress" satisfies ThreadEventType;
  const completedType =
    "item/backgroundTask/completed" satisfies ThreadEventType;
  const settled = alias(events, "settled_background_task");

  // The NOT EXISTS clause restricts this to open items; the correlated
  // MAX(sequence) predicate selects each item's latest lifecycle row in SQL
  // so only one row per open item is materialized.
  const rows = db
    .select({
      data: events.data,
      environmentId: threads.environmentId,
      itemId: events.itemId,
      providerThreadId: events.providerThreadId,
      threadId: events.threadId,
    })
    .from(events)
    .innerJoin(threads, eq(events.threadId, threads.id))
    .innerJoin(environments, eq(threads.environmentId, environments.id))
    .where(
      and(
        eq(environments.hostId, args.hostId),
        eq(events.itemKind, "backgroundTask"),
        inArray(events.type, [startedType, progressType]),
        isNotNull(events.itemId),
        notExists(
          db
            .select({ one: sql`1` })
            .from(settled)
            .where(
              and(
                eq(settled.threadId, events.threadId),
                eq(settled.itemId, events.itemId),
                eq(settled.type, completedType),
              ),
            ),
        ),
        sql`${events.sequence} = (
          SELECT MAX(latest.sequence)
          FROM events latest
          WHERE latest.thread_id = ${events.threadId}
            AND latest.item_id = ${events.itemId}
            AND latest.type IN (${startedType}, ${progressType})
        )`,
      ),
    )
    .orderBy(events.threadId, events.itemId)
    .all();

  return rows.flatMap((row) =>
    row.itemId === null ? [] : [{ ...row, itemId: row.itemId }],
  );
}

/**
 * Each item/backgroundTask/progress row carries the full superseding task
 * snapshot, and the turn-scoped item/started anchors the row's sequence range
 * — so while a task runs only the latest progress row per item is
 * load-bearing, and once the dedicated item/backgroundTask/completed row
 * exists (full final payload) none are. No sequence cutoff: deleting a
 * superseded snapshot is always safe.
 */
export function pruneBackgroundTaskProgressEvents(
  db: DbConnection,
  args: PruneBackgroundTaskProgressEventsArgs,
): number {
  const progressType =
    "item/backgroundTask/progress" satisfies ThreadEventType;
  const completedType =
    "item/backgroundTask/completed" satisfies ThreadEventType;

  const result = db.run(
    sql`DELETE FROM events
        WHERE ${events.threadId} = ${args.threadId}
          AND ${events.type} = ${progressType}
          AND ${events.itemId} IS NOT NULL
          AND (
            EXISTS (
              SELECT 1
              FROM events completed
              WHERE completed.thread_id = ${events.threadId}
                AND completed.type = ${completedType}
                AND completed.item_id = ${events.itemId}
            )
            OR ${events.id} NOT IN (
              SELECT latest.id
              FROM events latest
              WHERE latest.thread_id = ${events.threadId}
                AND latest.type = ${progressType}
                AND latest.item_id = ${events.itemId}
              ORDER BY latest.sequence DESC
              LIMIT 1
            )
          )`,
  );

  return result.changes;
}
