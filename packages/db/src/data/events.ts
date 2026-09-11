import {
  and,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
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
  PromptInput,
  ThreadEvent,
  StoredThreadEventDataForType,
  SystemThreadInterruptedReason,
  ThreadEventItemType,
  ThreadEventScope,
  ThreadEventScopeKind,
  ThreadEventType,
} from "@bb/domain";
import {
  LOCAL_AGENT_TASK_TYPE,
  LOCAL_BASH_TASK_TYPE,
  LOCAL_SUBAGENT_TASK_TYPE,
  LOCAL_WORKFLOW_TASK_TYPE,
  THREAD_CONTEXT_CLEAR_OPERATION,
  clientTurnRequestIdSchema,
  getThreadEventScopeTurnId,
  parseStoredThreadEvent,
  systemThreadInterruptedReasonSchema,
  threadEventTypeValues,
} from "@bb/domain";
import type {
  DbConnection,
  DbQueryConnection,
  DbTransaction,
} from "../connection.js";
import { alias, unionAll } from "drizzle-orm/sqlite-core";
import type { DbNotifier } from "../notifier.js";
import {
  environments,
  events,
  promptHistoryEntries,
  threadDynamicContextFileStates,
  threadSearchSegments,
  threads,
} from "../schema.js";
import { createEventId } from "../ids.js";
import { COMPLETED_EVENT_OUTPUT_TRUNCATION_THRESHOLD_CHARS } from "../retained-event-output.js";
import { truncatedEventDataColumn } from "./event-output-truncation.js";
import { deriveStoredEventItemFieldsFromSource } from "../stored-event-item-fields.js";
import {
  upsertThreadSearchSegments,
  type UpsertThreadSearchSegmentInput,
} from "./threads.js";
import {
  copyRetainedEventOutput,
  insertPreparedRetainedEventOutput,
  prepareCompletedEventOutputData,
} from "./retained-event-outputs.js";

const STORED_EVENT_SEQUENCE_LOOKUP_CHUNK_SIZE = 250;
const SQLITE_MAX_VARIABLE_NUMBER = 32_766;
const CLIENT_TURN_REQUEST_KEY_BATCH_SIZE = 995;
const RESOLVED_ITEM_DELTA_PRUNE_BATCH_SIZE = 500;
const ITEM_EVENT_TYPES = threadEventTypeValues.filter((type) =>
  type.startsWith("item/"),
);

interface QueryInSqliteVariableBatchesArgs<TValue, TRow> {
  dedupeKey: (value: TValue) => string;
  fixedVariableCount: number;
  maximumValueCount?: number;
  queryBatch: (values: readonly TValue[]) => readonly TRow[];
  values: readonly TValue[];
  variableCountPerValue: number;
}

export function queryInSqliteVariableBatches<TValue, TRow>(
  args: QueryInSqliteVariableBatchesArgs<TValue, TRow>,
): TRow[] {
  const values = [
    ...new Map(args.values.map((value) => [args.dedupeKey(value), value])).values(),
  ];
  if (values.length === 0) {
    return [];
  }
  const variableBatchSize = Math.floor(
    (SQLITE_MAX_VARIABLE_NUMBER - args.fixedVariableCount) /
      args.variableCountPerValue,
  );
  const batchSize = Math.min(
    variableBatchSize,
    args.maximumValueCount ?? variableBatchSize,
  );
  if (batchSize < 1) {
    throw new Error("The fixed SQL variables exceed the SQLite limit");
  }

  const rows: TRow[] = [];
  for (let offset = 0; offset < values.length; offset += batchSize) {
    rows.push(...args.queryBatch(values.slice(offset, offset + batchSize)));
  }
  return rows;
}

const isRootTurnStartedEventData = isNull(events.parentToolCallId);
const isNotNestedTurnUsageEvent = sql`NOT EXISTS (
  SELECT 1
  FROM events AS nested_turn_started
  WHERE nested_turn_started.thread_id = ${events.threadId}
    AND nested_turn_started.turn_id = ${events.turnId}
    AND nested_turn_started.type = 'turn/started'
    AND nested_turn_started.parent_tool_call_id IS NOT NULL
)`;

const isNotSupersededBackgroundTaskProgress = sql`NOT (
  ${events.type} = 'item/backgroundTask/progress'
  AND EXISTS (
    SELECT 1
    FROM events AS newer_task_state
    WHERE newer_task_state.thread_id = ${events.threadId}
      AND newer_task_state.item_kind = 'backgroundTask'
      AND newer_task_state.item_id = ${events.itemId}
      AND newer_task_state.type IN ('item/backgroundTask/progress', 'item/backgroundTask/completed')
      AND newer_task_state.sequence > ${events.sequence}
  )
)`;

function isNotSupersededBackgroundTaskProgressBefore(beforeSequence: number | undefined): SQL {
  if (beforeSequence === undefined) return isNotSupersededBackgroundTaskProgress;
  return sql`NOT (
    ${events.type} = 'item/backgroundTask/progress'
    AND EXISTS (
      SELECT 1 FROM events AS newer_task_state
      WHERE newer_task_state.thread_id = ${events.threadId}
        AND newer_task_state.item_kind = 'backgroundTask'
        AND newer_task_state.item_id = ${events.itemId}
        AND newer_task_state.type IN ('item/backgroundTask/progress', 'item/backgroundTask/completed')
        AND newer_task_state.sequence > ${events.sequence}
        AND newer_task_state.sequence < ${beforeSequence}
    )
  )`;
}

export interface InsertEventInput {
  threadId: string;
  environmentId?: string | null;
  scope: ThreadEventScope;
  providerThreadId?: string | null;
  sequence: number;
  type: ThreadEventType;
  itemId: string | null;
  itemKind: ThreadEventItemType | null;
  parentToolCallId: string | null;
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
  parentToolCallId: string | null;
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
  skippedTurnUnstartedInputIndexes: number[];
}

interface ItemLifecycleLookupKey {
  itemId: string;
  threadId: string;
}

interface LatestItemLifecycleRow extends ItemLifecycleLookupKey {
  type:
    | "item/started"
    | "item/completed"
    | "item/backgroundTask/completed";
}

const TERMINAL_ITEM_EVENT_TYPES = [
  "item/completed",
  "item/backgroundTask/completed",
] as const satisfies readonly ThreadEventType[];

function isTerminalItemEventType(
  type: ThreadEventType,
): type is (typeof TERMINAL_ITEM_EVENT_TYPES)[number] {
  return type === "item/completed" || type === "item/backgroundTask/completed";
}

function buildItemLifecycleKey(args: ItemLifecycleLookupKey): string {
  return `${args.threadId}\0${args.itemId}`;
}

function collectTerminalItemLookupKeys(
  eventInputs: readonly AppendDaemonEventInput[],
): ItemLifecycleLookupKey[] {
  return eventInputs.flatMap((input) =>
    input.itemId !== null && isTerminalItemEventType(input.type)
      ? [{ itemId: input.itemId, threadId: input.threadId }]
      : [],
  );
}

function listLatestItemLifecycleRows(
  db: DbQueryConnection,
  lookupKeys: readonly ItemLifecycleLookupKey[],
): LatestItemLifecycleRow[] {
  return queryInSqliteVariableBatches({
    dedupeKey: buildItemLifecycleKey,
    fixedVariableCount: 0,
    queryBatch: (keys) => {
      const requestedValues = sql.join(
        keys.map((key) => sql`(${key.threadId}, ${key.itemId})`),
        sql`, `,
      );
      return db.all<LatestItemLifecycleRow>(sql`
        WITH requested_item(thread_id, item_id) AS (
          VALUES ${requestedValues}
        )
        SELECT
          lifecycle.thread_id AS threadId,
          lifecycle.item_id AS itemId,
          lifecycle.type AS type
        FROM requested_item requested
        JOIN ${events} AS lifecycle
          INDEXED BY events_item_lifecycle_thread_item_sequence_idx
          ON lifecycle.thread_id = requested.thread_id
          AND lifecycle.item_id = requested.item_id
        WHERE lifecycle.type IN (
          'item/started',
          'item/completed',
          'item/backgroundTask/completed'
        )
          AND lifecycle.sequence = (
            SELECT MAX(candidate.sequence)
            FROM ${events} AS candidate
              INDEXED BY events_item_lifecycle_thread_item_sequence_idx
            WHERE candidate.thread_id = requested.thread_id
              AND candidate.item_id = requested.item_id
              AND candidate.type IN (
                'item/started',
                'item/completed',
                'item/backgroundTask/completed'
              )
          )
      `);
    },
    values: lookupKeys,
    variableCountPerValue: 2,
  });
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

export interface DeleteThreadEventSuffixArgs {
  cutoffSequence: number;
  oldMaxSequence: number;
  threadId: string;
}

export interface DeleteThreadEventSuffixResult {
  deletedEventCount: number;
}

export function deleteThreadEventSuffixInTransaction(
  db: DbTransaction,
  args: DeleteThreadEventSuffixArgs,
): DeleteThreadEventSuffixResult {
  db.delete(promptHistoryEntries)
    .where(
      and(
        eq(promptHistoryEntries.threadId, args.threadId),
        gte(promptHistoryEntries.requestSequence, args.cutoffSequence),
        lte(promptHistoryEntries.requestSequence, args.oldMaxSequence),
      ),
    )
    .run();
  db.delete(threadSearchSegments)
    .where(
      and(
        eq(threadSearchSegments.threadId, args.threadId),
        gte(threadSearchSegments.sourceSeq, args.cutoffSequence),
        lte(threadSearchSegments.sourceSeq, args.oldMaxSequence),
      ),
    )
    .run();
  db.delete(threadDynamicContextFileStates)
    .where(eq(threadDynamicContextFileStates.threadId, args.threadId))
    .run();
  const result = db
    .delete(events)
    .where(
      and(
        eq(events.threadId, args.threadId),
        gte(events.sequence, args.cutoffSequence),
        lte(events.sequence, args.oldMaxSequence),
      ),
    )
    .run();
  return { deletedEventCount: result.changes };
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

interface InsertStoredEventRowArgs {
  conflict: "error" | "ignore";
  createdAt: number;
  data: string;
  environmentId: string | null;
  itemId: string | null;
  itemKind: ThreadEventItemType | null;
  parentToolCallId: string | null;
  providerThreadId: string | null;
  scopeKind: ThreadEventScopeKind;
  sequence: number;
  threadId: string;
  turnId: string | null;
  type: ThreadEventType;
}

interface InsertStoredEventRowResult {
  id: string;
  inserted: boolean;
}

function insertStoredEventRow(
  db: DbQueryConnection,
  args: InsertStoredEventRowArgs,
): InsertStoredEventRowResult {
  const id = createEventId();
  const prepared = prepareCompletedEventOutputData({
    createdAt: args.createdAt,
    data: args.data,
    itemKind: args.itemKind,
    type: args.type,
  });
  const insert =
    args.conflict === "ignore" ? sql`INSERT OR IGNORE` : sql`INSERT`;
  const result = db.run(sql`${insert} INTO events
    (id, thread_id, environment_id, scope_kind, turn_id, provider_thread_id, sequence, type, item_id, item_kind, parent_tool_call_id, data, created_at)
    VALUES (
      ${id},
      ${args.threadId},
      ${args.environmentId},
      ${args.scopeKind},
      ${args.turnId},
      ${args.providerThreadId},
      ${args.sequence},
      ${args.type},
      ${args.itemId},
      ${args.itemKind},
      ${args.parentToolCallId},
      ${prepared.data},
      ${args.createdAt}
    )`);
  if (result.changes === 0) {
    return { id, inserted: false };
  }
  if (prepared.retainedOutput !== null) {
    insertPreparedRetainedEventOutput(db, {
      eventId: id,
      output: prepared.retainedOutput,
    });
  }
  return { id, inserted: true };
}

export function insertEvents(
  db: DbConnection,
  notifier: DbNotifier,
  eventInputs: InsertEventInput[],
): InsertEventsResult {
  if (eventInputs.length === 0) {
    return {
      insertedCount: 0,
      insertedInputIndexes: [],
    };
  }

  const eventTypesByThreadId = new Map<string, Set<ThreadEventType>>();
  const result = db.transaction(
    (tx) => {
      let insertedCount = 0;
      const insertedInputIndexes: number[] = [];
      for (const [index, input] of eventInputs.entries()) {
        const createdAt = input.createdAt ?? Date.now();
        const turnId = getThreadEventScopeTurnId(input.scope) ?? null;
        const insertResult = insertStoredEventRow(tx, {
          conflict: "ignore",
          createdAt,
          data: input.data,
          environmentId: input.environmentId ?? null,
          itemId: input.itemId,
          itemKind: input.itemKind,
          parentToolCallId: input.parentToolCallId,
          providerThreadId: input.providerThreadId ?? null,
          scopeKind: input.scope.kind,
          sequence: input.sequence,
          threadId: input.threadId,
          turnId,
          type: input.type,
        });
        if (insertResult.inserted) {
          insertedCount += 1;
          insertedInputIndexes.push(index);
          const eventTypes = eventTypesByThreadId.get(input.threadId);
          if (eventTypes) {
            eventTypes.add(input.type);
          } else {
            eventTypesByThreadId.set(input.threadId, new Set([input.type]));
          }
        }
      }
      return { insertedCount, insertedInputIndexes };
    },
    { behavior: "immediate" },
  );

  for (const [threadId, eventTypes] of eventTypesByThreadId) {
    notifier.notifyThread(threadId, ["events-appended"], {
      eventTypes: Array.from(eventTypes),
    });
  }

  return result;
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

const ORPHAN_DROPPABLE_TURN_EVENT_TYPES: ReadonlySet<ThreadEventType> = new Set([
  "thread/tokenUsage/updated",
  "thread/contextWindowUsage/updated",
  "provider/unhandled",
]);

type DaemonTurnStartDisposition =
  | "append"
  | "skip-duplicate-turn-start"
  | "skip-orphan-snapshot";

function resolveDaemonTurnStartDisposition(
  input: AppendDaemonEventInput,
  startedTurnKeys: ReadonlySet<string>,
): DaemonTurnStartDisposition {
  const turnId = getThreadEventScopeTurnId(input.scope);
  if (turnId === undefined) {
    return "append";
  }

  const key = buildThreadTurnKey({ threadId: input.threadId, turnId });
  if (input.type === "turn/started") {
    return startedTurnKeys.has(key) ? "skip-duplicate-turn-start" : "append";
  }

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

function isStoredEventPayload(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extractVisiblePromptText(input: readonly PromptInput[]): string {
  return input
    .filter((part) => part.visibility !== "agent-only")
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("\n")
    .trim();
}

function buildThreadEventSearchSegment(args: {
  sequence: number;
  sourceKind: UpsertThreadSearchSegmentInput["sourceKind"];
  text: string;
  threadId: string;
}): UpsertThreadSearchSegmentInput[] {
  const text = args.text.trim();
  if (text.length === 0) {
    return [];
  }
  return [
    {
      threadId: args.threadId,
      sourceKind: args.sourceKind,
      sourceKey: `event:${args.sequence}`,
      sourceSeq: args.sequence,
      text,
    },
  ];
}

function listThreadSearchSegmentsForStoredEventArgs(args: {
  eventArgs: AppendStoredThreadEventArgs;
  sequence: number;
}): UpsertThreadSearchSegmentInput[] {
  switch (args.eventArgs.type) {
    case "client/turn/requested":
      return buildThreadEventSearchSegment({
        threadId: args.eventArgs.threadId,
        sequence: args.sequence,
        sourceKind: "user_message",
        text: extractVisiblePromptText(args.eventArgs.data.input),
      });
    case "item/completed":
      if (args.eventArgs.data.item.type !== "agentMessage") {
        return [];
      }
      return buildThreadEventSearchSegment({
        threadId: args.eventArgs.threadId,
        sequence: args.sequence,
        sourceKind: "assistant_message",
        text: args.eventArgs.data.item.text,
      });
    case "system/manager/user_message":
      return buildThreadEventSearchSegment({
        threadId: args.eventArgs.threadId,
        sequence: args.sequence,
        sourceKind: "system_message",
        text: args.eventArgs.data.text,
      });
    default:
      return [];
  }
}

function listThreadSearchSegmentsForThreadEvent(args: {
  event: ThreadEvent;
  sequence: number;
}): UpsertThreadSearchSegmentInput[] {
  switch (args.event.type) {
    case "client/turn/requested":
      return buildThreadEventSearchSegment({
        threadId: args.event.threadId,
        sequence: args.sequence,
        sourceKind: "user_message",
        text: extractVisiblePromptText(args.event.input),
      });
    case "item/completed":
      if (args.event.item.type !== "agentMessage") {
        return [];
      }
      return buildThreadEventSearchSegment({
        threadId: args.event.threadId,
        sequence: args.sequence,
        sourceKind: "assistant_message",
        text: args.event.item.text,
      });
    case "system/manager/user_message":
      return buildThreadEventSearchSegment({
        threadId: args.event.threadId,
        sequence: args.sequence,
        sourceKind: "system_message",
        text: args.event.text,
      });
    default:
      return [];
  }
}

function parseDaemonThreadEvent(input: AppendDaemonEventInput): ThreadEvent | null {
  let data: unknown;
  try {
    data = JSON.parse(input.data);
  } catch {
    return null;
  }
  if (!isStoredEventPayload(data)) {
    return null;
  }
  try {
    return parseStoredThreadEvent({
      data,
      providerThreadId: input.providerThreadId,
      scope: input.scope,
      threadId: input.threadId,
      type: input.type,
    });
  } catch {
    return null;
  }
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
  const settledItemKeys = new Set(
    listLatestItemLifecycleRows(
      db,
      collectTerminalItemLookupKeys(eventInputs),
    )
      .filter((row) => isTerminalItemEventType(row.type))
      .map(buildItemLifecycleKey),
  );
  const now = Date.now();
  for (const [index, input] of eventInputs.entries()) {
    const turnStartDisposition = resolveDaemonTurnStartDisposition(
      input,
      startedTurnKeys,
    );
    if (turnStartDisposition === "skip-orphan-snapshot") {
      skippedTurnUnstartedInputIndexes.push(index);
      continue;
    }
    if (turnStartDisposition === "skip-duplicate-turn-start") {
      continue;
    }

    const turnId = getThreadEventScopeTurnId(input.scope) ?? null;
    const itemLifecycleKey =
      input.itemId === null
        ? null
        : buildItemLifecycleKey({
            itemId: input.itemId,
            threadId: input.threadId,
          });
    if (input.type === "item/started" && itemLifecycleKey !== null) {
      settledItemKeys.delete(itemLifecycleKey);
    } else if (
      isTerminalItemEventType(input.type) &&
      itemLifecycleKey !== null
    ) {
      if (settledItemKeys.has(itemLifecycleKey)) {
        continue;
      }
      settledItemKeys.add(itemLifecycleKey);
    }

    const sequence = nextSequencesByThreadId.get(input.threadId);
    if (sequence === undefined) {
      throw new Error(`Missing event sequence for thread: ${input.threadId}`);
    }
    insertStoredEventRow(db, {
      conflict: "error",
      createdAt: now,
      data: input.data,
      environmentId: input.environmentId,
      itemId: input.itemId,
      itemKind: input.itemKind,
      parentToolCallId: input.parentToolCallId,
      providerThreadId: input.providerThreadId,
      scopeKind: input.scope.kind,
      sequence,
      threadId: input.threadId,
      turnId,
      type: input.type,
    });
    const event = parseDaemonThreadEvent(input);
    if (event !== null) {
      upsertThreadSearchSegments(db, {
        updatedAt: now,
        segments: listThreadSearchSegmentsForThreadEvent({
          event,
          sequence,
        }),
      });
    }

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
    nextSequencesByThreadId.set(input.threadId, sequence + 1);
  }

  return {
    acceptedEvents,
    insertedInputIndexes,
    skippedTurnUnstartedInputIndexes,
  };
}

export interface CopyStoredThreadEventsArgs {
  rows: readonly StoredEventRow[];
  targetEnvironmentId: string | null;
  targetThreadId: string;
}

export function copyStoredThreadEventsInTransaction(
  db: DbTransaction,
  args: CopyStoredThreadEventsArgs,
): number {
  if (args.rows.length === 0) {
    return 0;
  }
  const highWaterMarks = getHighWaterMarks(db, [args.targetThreadId]);
  let sequence = (highWaterMarks[args.targetThreadId] ?? 0) + 1;
  const now = Date.now();
  for (const row of args.rows) {
    const insertResult = insertStoredEventRow(db, {
      conflict: "error",
      createdAt: row.createdAt,
      data: row.data,
      environmentId: args.targetEnvironmentId,
      itemId: row.itemId,
      itemKind: row.itemKind,
      parentToolCallId: row.parentToolCallId,
      providerThreadId: row.providerThreadId,
      scopeKind: row.scopeKind,
      sequence,
      threadId: args.targetThreadId,
      turnId: row.turnId,
      type: row.type,
    });
    if (!insertResult.inserted) {
      throw new Error("Expected copied event row to be inserted");
    }
    copyRetainedEventOutput(db, {
      copiedAt: now,
      sourceEventId: row.id,
      targetEventId: insertResult.id,
    });
    const event = parseDaemonThreadEvent({
      data: row.data,
      environmentId: args.targetEnvironmentId,
      itemId: row.itemId,
      itemKind: row.itemKind,
      parentToolCallId: row.parentToolCallId,
      providerThreadId: row.providerThreadId,
      scope:
        row.turnId === null
          ? { kind: "thread" }
          : { kind: "turn", turnId: row.turnId },
      threadId: args.targetThreadId,
      type: row.type,
    });
    if (event !== null) {
      upsertThreadSearchSegments(db, {
        updatedAt: now,
        segments: listThreadSearchSegmentsForThreadEvent({
          event,
          sequence,
        }),
      });
    }
    sequence += 1;
  }
  return args.rows.length;
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
      parentToolCallId:
        "parentToolCallId" in args.data
          ? args.data.parentToolCallId
          : undefined,
    });
    const turnId = getThreadEventScopeTurnId(args.scope) ?? null;

    insertStoredEventRow(db, {
      conflict: "error",
      createdAt: now,
      data: JSON.stringify(args.data),
      environmentId: args.environmentId ?? null,
      itemId: itemFields.itemId,
      itemKind: itemFields.itemKind,
      parentToolCallId: itemFields.parentToolCallId,
      providerThreadId: args.providerThreadId ?? null,
      scopeKind: args.scope.kind,
      sequence,
      threadId: args.threadId,
      turnId,
      type: args.type,
    });
    upsertThreadSearchSegments(db, {
      updatedAt: now,
      segments: listThreadSearchSegmentsForStoredEventArgs({
        eventArgs: args,
        sequence,
      }),
    });

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

export function getHighWaterMarks(
  db: DbQueryConnection,
  threadIds?: string[],
): Record<string, number> {
  const result: Record<string, number> = {};

  if (threadIds && threadIds.length > 0) {
    const rows = queryInSqliteVariableBatches({
      dedupeKey: (threadId) => threadId,
      fixedVariableCount: 0,
      queryBatch: (ids) =>
        db.all<{ threadId: string; maxSeq: number | null }>(sql`
          WITH requested(thread_id) AS (
            VALUES ${sql.join(
              ids.map((id) => sql`(${id})`),
              sql`, `,
            )}
          )
          SELECT thread_id AS threadId, (
            SELECT sequence FROM events
            WHERE events.thread_id = requested.thread_id
            ORDER BY sequence DESC LIMIT 1
          ) AS maxSeq
          FROM requested
        `),
      values: threadIds,
      variableCountPerValue: 1,
    });
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
  parentToolCallId: events.parentToolCallId,
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

export type InlineOutputCharLimit = number | null;

function storedEventRowFieldsWithInlineOutputLimit(
  maxInlineOutputChars: InlineOutputCharLimit,
) {
  return maxInlineOutputChars === null
    ? storedEventRowFields
    : {
        ...storedEventRowFields,
        data: truncatedEventDataColumn(maxInlineOutputChars),
      };
}

function storedEventRowSqlFields(maxInlineOutputChars: InlineOutputCharLimit) {
  return {
        createdAt: sql<number>`${events.createdAt}`,
        data: sql<string>`${storedEventRowFieldsWithInlineOutputLimit(maxInlineOutputChars).data}`,
        id: sql<string>`${events.id}`,
        itemId: sql<string | null>`${events.itemId}`,
        itemKind: sql<StoredEventRow["itemKind"]>`${events.itemKind}`,
        parentToolCallId: sql<string | null>`${events.parentToolCallId}`,
        providerThreadId: sql<string | null>`${events.providerThreadId}`,
        scopeKind: sql<StoredEventRow["scopeKind"]>`${events.scopeKind}`,
        sequence: sql<number>`${events.sequence}`,
        threadId: sql<string>`${events.threadId}`,
        turnId: sql<string | null>`${events.turnId}`,
        type: sql<StoredEventRow["type"]>`${events.type}`,
      };
}

export interface ListStoredEventRowsArgs {
  afterSequence?: number;
  beforeSequence?: number;
  limit?: number;
  order?: "asc" | "desc";
  threadId: string;
  types?: readonly ThreadEventType[];
}

export interface FindStoredEventRowArgs {
  afterSequence?: number;
  threadId: string;
  type: ThreadEventType;
}

export interface ListStoredEventRowsByParentToolCallIdsArgs {
  excludeDiagnosticEvents?: boolean;
  beforeSequence?: number;
  excludedTypes?: readonly ThreadEventType[];
  maxInlineOutputChars: InlineOutputCharLimit;
  parentToolCallIds: readonly string[];
  sequenceStart?: number;
  threadId: string;
}

export type GetStoredEventRowsByParentToolCallIdsDataBytesArgs =
  ListStoredEventRowsByParentToolCallIdsArgs;

export interface ListLatestThreadStateEventRowsByThreadIdsArgs {
  threadIds: readonly string[];
  kind: string;
}

export interface ListOpenTurnInputAcceptedRowsByThreadIdsArgs {
  threadIds: readonly string[];
}

export interface ThreadClientTurnRequestKey {
  requestId: ClientTurnRequestId;
  threadId: string;
}

export interface ListStoredClientTurnRequestRowsByKeysArgs {
  keys: readonly ThreadClientTurnRequestKey[];
}

export interface ListStoredToolCallRowsByItemIdsArgs {
  itemIds: readonly string[];
  maxInlineOutputChars: InlineOutputCharLimit;
  threadId: string;
}

export interface ListStoredTurnInputAcceptedRowsByClientRequestIdsArgs {
  afterSequence: number;
  clientRequestIds: readonly ClientTurnRequestId[];
  threadId: string;
}

export interface ListStoredTurnRejectedRowsByClientRequestIdsArgs {
  afterSequence: number;
  clientRequestIds: readonly ClientTurnRequestId[];
  threadId: string;
}

export interface ListStoredClientTurnRequestIdsInRangeArgs {
  seqEnd: number;
  seqStart: number;
  threadId: string;
}

export interface GetStoredTurnRequestEventForTurnArgs {
  threadId: string;
  turnId: string;
}

export interface FindLastRootStoredTurnStartedArgs {
  atOrBeforeSequence?: number;
  threadId: string;
}

export interface StoredTurnStartedKey {
  sequence: number;
  turnId: string;
}

export interface CompletedRootStoredTurn {
  completedSequence: number;
  startedSequence: number;
  turnId: string;
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

export interface ListStoredTurnCompletedRowsByTurnIdsArgs {
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
  excludeDiagnosticEvents?: boolean;
  excludedTypes?: readonly ThreadEventType[];
  maxInlineOutputChars: InlineOutputCharLimit;
  sequenceStart: number;
  threadId: string;
}

export interface ListStoredConversationOutlineEventRowsArgs {
  sequenceStart: number;
  threadId: string;
}

export interface GetLatestStoredConversationOutlineSequenceArgs {
  threadId: string;
}

export interface ListStoredTimelineWindowEventRowsArgs {
  excludeDiagnosticEvents?: boolean;
  beforeSequence?: number;
  excludedTypes?: readonly ThreadEventType[];
  maxInlineOutputChars: InlineOutputCharLimit;
  sequenceStart: number;
  threadId: string;
}

export type GetStoredTimelineWindowEventDataBytesArgs =
  ListStoredTimelineWindowEventRowsArgs;

export interface FindStoredTimelineWindowByteBudgetFloorArgs
  extends ListStoredTimelineWindowEventRowsArgs {
  maxDataBytes: number;
}

export type StoredTimelineWindowByteBudgetFloor =
  | { eventDataBytes: number; kind: "fits" }
  | { eventDataBytes: number; kind: "floor"; sequenceStart: number }
  | {
      createdAt: number;
      eventDataBytes: number;
      hasOlderRows: boolean;
      kind: "single-event-too-large";
      sequenceStart: number;
      turnId: string | null;
    };

export interface ListContextWindowUsageRowsArgs {
  sequenceStart: number;
  threadId: string;
}

export interface GetLatestCompletedThreadContextClearSequenceArgs {
  atOrBeforeSequence?: number;
  threadId: string;
}

export interface GetLatestThreadOutputEventRowArgs {
  threadId: string;
}

export interface GetLatestThreadSystemErrorEventRowArgs {
  threadId: string;
}

export interface GetLatestThreadSequenceArgs {
  excludeDiagnosticEvents?: boolean;
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

export interface ListOpenBackgroundTaskItemRowsForThreadArgs {
  threadId: string;
}

export interface OpenBackgroundTaskItemRow {
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
  if (args.types?.length === 0) {
    return [];
  }

  const limit = args.limit ?? Number.MAX_SAFE_INTEGER;
  const order = args.order ?? "asc";
  const listTypePage = (
    type: ThreadEventType | undefined,
  ): StoredEventRow[] => {
    return db
      .select(storedEventRowFields)
      .from(events)
      .where(
        and(
          eq(events.threadId, args.threadId),
          args.afterSequence === undefined
            ? undefined
            : gt(events.sequence, args.afterSequence),
          args.beforeSequence === undefined
            ? undefined
            : lt(events.sequence, args.beforeSequence),
          type === undefined ? undefined : eq(events.type, type),
        ),
      )
      .orderBy(order === "desc" ? desc(events.sequence) : events.sequence)
      .limit(limit)
      .all();
  };

  if (args.types === undefined) {
    return listTypePage(undefined);
  }

  const rowsByType = [...new Set(args.types)].map((type) => listTypePage(type));
  const offsets = rowsByType.map(() => 0);
  const merged: StoredEventRow[] = [];
  while (merged.length < limit) {
    let selectedTypeIndex = -1;
    let selectedRow: StoredEventRow | undefined;
    for (let typeIndex = 0; typeIndex < rowsByType.length; typeIndex += 1) {
      const row = rowsByType[typeIndex]?.[offsets[typeIndex] ?? 0];
      if (
        row !== undefined &&
        (selectedRow === undefined ||
          (order === "desc"
            ? row.sequence > selectedRow.sequence
            : row.sequence < selectedRow.sequence))
      ) {
        selectedTypeIndex = typeIndex;
        selectedRow = row;
      }
    }
    if (selectedRow === undefined || selectedTypeIndex === -1) break;
    merged.push(selectedRow);
    offsets[selectedTypeIndex] = (offsets[selectedTypeIndex] ?? 0) + 1;
  }
  return merged;
}

export function listLatestThreadStateEventRowsByThreadIds(
  db: DbQueryConnection,
  args: ListLatestThreadStateEventRowsByThreadIdsArgs,
): StoredEventRow[] {
  return queryInSqliteVariableBatches({
    dedupeKey: (threadId) => threadId,
    fixedVariableCount: 1,
    queryBatch: (threadIds) => {
      const stateTypes = [
        "thread/goal/updated",
        "thread/goal/cleared",
        "thread/extensionState/updated",
      ] as const satisfies readonly ThreadEventType[];
      const stateTypesPredicate = sql.raw(
        `IN (${stateTypes.map((type) => `'${type}'`).join(", ")})`,
      );
      const kindPredicate = sql`(
        candidate.type <> 'thread/extensionState/updated'
        OR json_extract(candidate.data, '$.kind') = ${args.kind}
      )`;
      const threadIdList = sql.join(
        threadIds.map((threadId) => sql`${threadId}`),
        sql`, `,
      );
      return db
        .select(storedEventRowFields)
        .from(events)
        .where(sql`${events}.rowid IN (
        SELECT latest_state.rowid
        FROM ${events} AS latest_state INDEXED BY events_thread_state_thread_sequence_idx
        WHERE latest_state.thread_id IN (${threadIdList})
          AND latest_state.type ${stateTypesPredicate}
          AND latest_state.sequence = (
            SELECT MAX(candidate.sequence)
            FROM ${events} AS candidate INDEXED BY events_thread_state_thread_sequence_idx
            WHERE candidate.thread_id = latest_state.thread_id
              AND candidate.type ${stateTypesPredicate}
              AND ${kindPredicate}
          )
      )`)
        .all();
    },

    values: args.threadIds,
    variableCountPerValue: 1,
  });
}

export function listOpenTurnInputAcceptedRowsByThreadIds(
  db: DbQueryConnection,
  args: ListOpenTurnInputAcceptedRowsByThreadIdsArgs,
): StoredEventRow[] {
  const rows = queryInSqliteVariableBatches({
    dedupeKey: (threadId) => threadId,
    fixedVariableCount: 3,
    queryBatch: (threadIds) => {
      const acceptedType = "turn/input/accepted" satisfies ThreadEventType;
      const completedType = "turn/completed" satisfies ThreadEventType;
      const interruptedType =
        "system/thread/interrupted" satisfies ThreadEventType;
      const completed = alias(events, "completed_turn_for_accepted_input");
      return db
        .select(storedEventRowFields)
        .from(
          sql`(VALUES ${sql.join(
            threadIds.map((id) => sql`(${id})`),
            sql`, `,
          )}) AS requested`,
        )
        .innerJoin(events, eq(events.threadId, sql`requested.column1`))
        .where(
          and(
            eq(events.type, acceptedType),
            isNotNull(events.turnId),
            sql`${events.sequence} > COALESCE((
          SELECT MAX(interrupted.sequence)
          FROM events interrupted
          WHERE interrupted.thread_id = requested.column1
            AND interrupted.type = ${interruptedType}
        ), -1)`,
            notExists(
              db
                .select({ one: sql`1` })
                .from(completed)
                .where(
                  and(
                    eq(completed.threadId, events.threadId),
                    eq(completed.turnId, events.turnId),
                    eq(completed.type, completedType),
                  ),
                ),
            ),
          ),
        )
        .orderBy(events.threadId, events.sequence)
        .all();
    },
    values: args.threadIds,
    variableCountPerValue: 1,
  });
  return rows.sort(
    (left, right) =>
      left.threadId.localeCompare(right.threadId) ||
      left.sequence - right.sequence,
  );
}

export function listStoredClientTurnRequestRowsByKeys(
  db: DbQueryConnection,
  args: ListStoredClientTurnRequestRowsByKeysArgs,
): StoredEventRow[] {
  const rows = queryInSqliteVariableBatches({
    dedupeKey: (key) => `${key.threadId}\0${key.requestId}`,
    fixedVariableCount: 1,
    maximumValueCount: CLIENT_TURN_REQUEST_KEY_BATCH_SIZE,
    queryBatch: (keys) => {
      const requestType = "client/turn/requested" satisfies ThreadEventType;
      const requestIdsByThread = new Map<string, string[]>();
      for (const key of keys) {
        const requestIds = requestIdsByThread.get(key.threadId) ?? [];
        requestIds.push(key.requestId);
        requestIdsByThread.set(key.threadId, requestIds);
      }
      const keyConditions = [...requestIdsByThread].map(
        ([threadId, requestIds]) =>
          and(
            eq(events.threadId, threadId),
            inArray(
              sql<string>`json_extract(${events.data}, '$.requestId')`,
              requestIds,
            ),
          ),
      );
      return db
        .select(storedEventRowFields)
        .from(events)
        .where(and(eq(events.type, requestType), or(...keyConditions)))
        .orderBy(events.threadId, events.sequence)
        .all();
    },
    values: args.keys,
    variableCountPerValue: 2,
  });
  return rows.sort(
    (left, right) =>
      left.threadId.localeCompare(right.threadId) ||
      left.sequence - right.sequence,
  );
}

export function findStoredEventRow(
  db: DbQueryConnection,
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

export function listStoredEventRowsByParentToolCallIds(
  db: DbConnection,
  args: ListStoredEventRowsByParentToolCallIdsArgs,
): StoredEventRow[] {
  const conditions = storedEventRowsByParentToolCallIdsConditions(args);
  if (conditions === null) {
    return [];
  }

  return db
    .select(storedEventRowSqlFields(args.maxInlineOutputChars))
    .from(sql`${events} INDEXED BY events_parent_tool_call_thread_parent_sequence_idx`)
    .where(and(...conditions, isNotNull(events.parentToolCallId)))
    .orderBy(events.sequence)
    .all();
}

function storedEventRowsByParentToolCallIdsConditions(
  args: ListStoredEventRowsByParentToolCallIdsArgs,
): SQL[] | null {
  const parentToolCallIds = [...new Set(args.parentToolCallIds)].filter(
    (parentToolCallId) => parentToolCallId.length > 0,
  );
  if (parentToolCallIds.length === 0) {
    return null;
  }

  const conditions: SQL[] = [
    eq(events.threadId, args.threadId),
    isNotSupersededBackgroundTaskProgressBefore(args.beforeSequence),
    inArray(events.parentToolCallId, parentToolCallIds),
  ];
  if (args.excludeDiagnosticEvents) conditions.push(isNotDiagnosticEvent);
  if (args.excludedTypes && args.excludedTypes.length > 0) {
    conditions.push(notInArray(events.type, [...args.excludedTypes]));
  }
  if (args.sequenceStart !== undefined) {
    conditions.push(gte(events.sequence, args.sequenceStart));
  }
  if (args.beforeSequence !== undefined) {
    conditions.push(lt(events.sequence, args.beforeSequence));
  }

  return conditions;
}

export function getStoredEventRowsByParentToolCallIdsDataBytes(
  db: DbConnection,
  args: GetStoredEventRowsByParentToolCallIdsDataBytesArgs,
): number {
  const conditions = storedEventRowsByParentToolCallIdsConditions(args);
  if (conditions === null) {
    return 0;
  }
  const data = storedTimelineWindowDataColumn(args.maxInlineOutputChars);
  const row = db
    .select({
      dataBytes: sql<number>`COALESCE(SUM(length(CAST(${data} AS BLOB))), 0)`,
    })
    .from(events)
    .where(and(...conditions))
    .get();
  return row?.dataBytes ?? 0;
}

export function listStoredDelegatingItemRowsByItemIds(
  db: DbConnection,
  args: ListStoredToolCallRowsByItemIdsArgs,
): StoredEventRow[] {
  const itemIds = [...new Set(args.itemIds)].filter(
    (itemId) => itemId.length > 0,
  );
  if (itemIds.length === 0) {
    return [];
  }

  return db
    .select(storedEventRowFieldsWithInlineOutputLimit(args.maxInlineOutputChars))
    .from(events)
    .where(
      and(
        eq(events.threadId, args.threadId),
        inArray(events.itemId, itemIds),
        sql`${events.itemKind} IN ('toolCall', 'delegation')`,
        inArray(events.type, ["item/started", "item/completed"]),
      ),
    )
    .orderBy(events.sequence)
    .all();
}

export function isTimelineCursorSequencePresent(
  db: DbConnection,
  args: TimelineSegmentAnchorLookupArgs,
): boolean {
  const row = db
    .select({ sequence: events.sequence })
    .from(events)
    .where(
      and(
        eq(events.threadId, args.threadId),
        eq(events.sequence, args.sequence),
      ),
    )
    .limit(1)
    .get();
  return row !== undefined;
}

export interface ScopedItemRef {
  itemId: string;
  scopeKind: ThreadEventScopeKind;
  turnId: string | null;
}

export function scopedItemRefKey(ref: ScopedItemRef): string {
  return `${ref.scopeKind} ${ref.turnId ?? ""} ${ref.itemId}`;
}

function dedupeScopedItemRefs(
  items: readonly ScopedItemRef[],
): ScopedItemRef[] {
  const byKey = new Map<string, ScopedItemRef>();
  for (const item of items) {
    if (item.itemId.length === 0) {
      continue;
    }
    byKey.set(scopedItemRefKey(item), item);
  }
  return [...byKey.values()];
}

function scopedItemRefsPredicate(
  items: readonly ScopedItemRef[],
  sharedPredicates: readonly SQL[] = [],
): SQL | undefined {
  const itemIds = [...new Set(items.map((item) => item.itemId))];
  const scopeGroups = new Map<
    string,
    {
      itemIds: Set<string>;
      scopeKind: ThreadEventScopeKind;
      turnId: string | null;
    }
  >();
  for (const item of items) {
    const scopeKey = `${item.scopeKind}\u0000${item.turnId ?? ""}`;
    const existing = scopeGroups.get(scopeKey);
    if (existing) {
      existing.itemIds.add(item.itemId);
      continue;
    }
    scopeGroups.set(scopeKey, {
      itemIds: new Set([item.itemId]),
      scopeKind: item.scopeKind,
      turnId: item.turnId,
    });
  }
  const scopePredicates = [...scopeGroups.values()].map((group) =>
    and(
      ...sharedPredicates,
      inArray(events.itemId, [...group.itemIds]),
      eq(events.scopeKind, group.scopeKind),
      group.turnId === null
        ? isNull(events.turnId)
        : eq(events.turnId, group.turnId),
    ),
  );
  return and(inArray(events.itemId, itemIds), or(...scopePredicates));
}

export interface ItemEventSpanRow {
  completedSeq: number | null;
  itemId: string;
  maxSequence: number;
  minSequence: number;
  scopeKind: ThreadEventScopeKind;
  turnId: string | null;
}

export interface ListItemEventSpansByItemsArgs {
  items: readonly ScopedItemRef[];
  threadId: string;
}

export function listItemEventSpansByItems(
  db: DbConnection,
  args: ListItemEventSpansByItemsArgs,
): ItemEventSpanRow[] {
  const items = dedupeScopedItemRefs(args.items);
  if (items.length === 0) {
    return [];
  }

  return db
    .select({
      completedSeq: sql<number | null>`MAX(CASE WHEN ${events.type} = 'item/completed' THEN ${events.sequence} END)`,
      itemId: sql<string>`${events.itemId}`,
      maxSequence: sql<number>`MAX(${events.sequence})`,
      minSequence: sql<number>`MIN(${events.sequence})`,
      scopeKind: events.scopeKind,
      turnId: events.turnId,
    })
    .from(events)
    .where(
      scopedItemRefsPredicate(items, [
        eq(events.threadId, args.threadId),
        inArray(events.type, ITEM_EVENT_TYPES),
      ]),
    )
    .groupBy(events.scopeKind, events.turnId, events.itemId)
    .all();
}

export interface ListStoredItemLifecycleRowsByItemsArgs {
  items: readonly ScopedItemRef[];
  maxInlineOutputChars: InlineOutputCharLimit;
  threadId: string;
}

export function listStoredItemLifecycleRowsByItems(
  db: DbConnection,
  args: ListStoredItemLifecycleRowsByItemsArgs,
): StoredEventRow[] {
  const items = dedupeScopedItemRefs(args.items);
  if (items.length === 0) {
    return [];
  }

  return db
    .select(storedEventRowFieldsWithInlineOutputLimit(args.maxInlineOutputChars))
    .from(events)
    .where(
      and(
        eq(events.threadId, args.threadId),
        scopedItemRefsPredicate(items),
        inArray(events.type, ["item/started", "item/completed"]),
      ),
    )
    .orderBy(events.sequence)
    .all();
}

export interface ListStoredBufferedTextDeltaRowsByItemsArgs {
  beforeSequence: number;
  items: readonly ScopedItemRef[];
  threadId: string;
}

export function listStoredBufferedTextDeltaRowsByItems(
  db: DbConnection,
  args: ListStoredBufferedTextDeltaRowsByItemsArgs,
): StoredEventRow[] {
  const items = dedupeScopedItemRefs(args.items);
  if (items.length === 0) {
    return [];
  }

  return db
    .select(storedEventRowFields)
    .from(events)
    .where(
      and(
        eq(events.threadId, args.threadId),
        scopedItemRefsPredicate(items),
        lt(events.sequence, args.beforeSequence),
        inArray(events.type, [
          "item/agentMessage/delta",
          "item/plan/delta",
          "item/reasoning/summaryTextDelta",
          "item/reasoning/textDelta",
        ]),
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

export function getStoredTurnRequestEventForTurn(
  db: DbQueryConnection,
  args: GetStoredTurnRequestEventForTurnArgs,
): StoredTurnRequestEventRow | null {
  const acceptedInput =
    db
      .select({
        clientRequestId: sql<string | null>`json_extract(${events.data}, '$.clientRequestId')`,
      })
      .from(events)
      .where(
        and(
          eq(events.threadId, args.threadId),
          eq(events.turnId, args.turnId),
          eq(events.type, "turn/input/accepted"),
        ),
      )
      .orderBy(desc(events.sequence))
      .limit(1)
      .get() ?? null;
  const requestIdResult = clientTurnRequestIdSchema.safeParse(
    acceptedInput?.clientRequestId,
  );
  if (!requestIdResult.success) {
    return null;
  }

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
        and(
          eq(events.threadId, args.threadId),
          eq(events.type, "client/turn/requested"),
          sql`json_extract(${events.data}, '$.requestId') = ${requestIdResult.data}`,
        ),
      )
      .limit(1)
      .get() ?? null
  );
}

/**
 * The `client/turn/requested` row for one request id.
 *
 * A retry hold stores only the request id it re-submits, so releasing it needs
 * exactly this lookup — the turn-keyed variant above cannot serve it, because a
 * request whose turn never started has no `turn/input/accepted` to join through.
 */
export function getStoredTurnRequestEventByRequestId(
  db: DbQueryConnection,
  args: { threadId: string; requestId: string },
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
        and(
          eq(events.threadId, args.threadId),
          eq(events.type, "client/turn/requested"),
          sql`json_extract(${events.data}, '$.requestId') = ${args.requestId}`,
        ),
      )
      .limit(1)
      .get() ?? null
  );
}

export interface StoredThreadEventDataRow {
  data: string;
  sequence: number;
  turnId: string | null;
  type: ThreadEventType;
}

/**
 * The newest row of any of `types`, optionally restricted to what came after a
 * sequence.
 *
 * Assembling a turn's failure context means asking two questions of the log —
 * "how did the provider describe this failure" and "what rate-limit windows did
 * it last report" — and both are one indexed row, not a scan the caller filters.
 */
export function getLatestStoredThreadEventOfTypes(
  db: DbQueryConnection,
  args: {
    threadId: string;
    types: readonly ThreadEventType[];
    afterSequence?: number;
  },
): StoredThreadEventDataRow | null {
  if (args.types.length === 0) {
    return null;
  }
  return (
    db
      .select({
        data: events.data,
        sequence: events.sequence,
        turnId: events.turnId,
        type: events.type,
      })
      .from(events)
      .where(
        and(
          eq(events.threadId, args.threadId),
          inArray(events.type, [...args.types]),
          ...(args.afterSequence === undefined
            ? []
            : [gt(events.sequence, args.afterSequence)]),
        ),
      )
      .orderBy(desc(events.sequence))
      .limit(1)
      .get() ?? null
  );
}

/**
 * The newest rate-limit snapshot this thread saw for one provider.
 *
 * Filtered on the provider inside the query: a thread's log can carry snapshots
 * from more than one provider id, and the caller wants its own thread's
 * provider rather than whatever reported last.
 */
export function getLatestStoredRateLimitsEventForProvider(
  db: DbQueryConnection,
  args: { threadId: string; providerId: string },
): StoredThreadEventDataRow | null {
  return (
    db
      .select({
        data: events.data,
        sequence: events.sequence,
        turnId: events.turnId,
        type: events.type,
      })
      .from(events)
      .where(
        and(
          eq(events.threadId, args.threadId),
          eq(events.type, "provider/rateLimits/updated"),
          sql`json_extract(${events.data}, '$.rateLimits.providerId') = ${args.providerId}`,
        ),
      )
      .orderBy(desc(events.sequence))
      .limit(1)
      .get() ?? null
  );
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

export function listStoredTurnRejectedRowsByClientRequestIds(
  db: DbConnection,
  args: ListStoredTurnRejectedRowsByClientRequestIdsArgs,
): StoredEventRow[] {
  if (args.clientRequestIds.length === 0) {
    return [];
  }

  const clientRequestIdConditions = args.clientRequestIds.map(
    (clientRequestId) =>
      sql`json_extract(${events.data}, '$.requestId') = ${clientRequestId}`,
  );

  return db
    .select(storedEventRowFields)
    .from(events)
    .where(
      and(
        eq(events.threadId, args.threadId),
        eq(events.type, "client/turn/rejected"),
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

export function listStoredTurnCompletedRowsByTurnIds(
  db: DbConnection,
  args: ListStoredTurnCompletedRowsByTurnIdsArgs,
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
        eq(events.type, "turn/completed"),
        inArray(events.turnId, [...args.turnIds]),
      ),
    )
    .orderBy(events.sequence)
    .all();
}

export interface ListLatestBackgroundTaskStateRowsByItemIdsArgs {
  beforeSequence?: number;
  itemIds: readonly string[];
  threadId: string;
}

export interface ListLatestOpenBackgroundTaskStateRowsForThreadArgs {
  threadId: string;
}

export interface ListTodoSnapshotEventRowsForThreadArgs {
  threadId: string;
}

export function listTodoSnapshotEventRowsForThread(
  db: DbConnection,
  args: ListTodoSnapshotEventRowsForThreadArgs,
): StoredEventRow[] {
  const row = db
    .select(storedEventRowFields)
    .from(events)
    .where(
      and(
        eq(events.threadId, args.threadId),
        sql`((${events.itemKind} = 'planSteps' AND ${events.type} = 'item/completed') OR ${events.type} = 'turn/plan/updated')`,
      ),
    )
    .orderBy(desc(events.sequence))
    .limit(1)
    .get();
  return row ? [row] : [];
}

export interface ListActiveBackgroundTaskCountsByThreadIdsArgs {
  threadIds: readonly string[];
}

export interface ActiveBackgroundTaskCountRow {
  activeBackgroundAgentCount: number;
  activeBackgroundCommandCount: number;
  activeWorkflowCount: number;
  threadId: string;
}

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
                args.beforeSequence === undefined ? undefined : lt(latest.sequence, args.beforeSequence),
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

export function listLatestOpenBackgroundTaskStateRowsForThread(
  db: DbConnection,
  args: ListLatestOpenBackgroundTaskStateRowsForThreadArgs,
): StoredEventRow[] {
  const startedType = "item/started" satisfies ThreadEventType;
  const progressType =
    "item/backgroundTask/progress" satisfies ThreadEventType;
  const completedType =
    "item/backgroundTask/completed" satisfies ThreadEventType;
  const completed = alias(events, "completed_background_task_state");
  const latest = alias(events, "latest_open_background_task_state");

  const latestSequences = db
    .select({ sequence: max(latest.sequence) })
    .from(latest)
    .where(
      and(
        eq(latest.threadId, args.threadId),
        eq(latest.itemKind, "backgroundTask"),
        inArray(latest.type, [startedType, progressType]),
        isNotNull(latest.itemId),
      ),
    )
    .groupBy(latest.itemId);
  const completedItemIds = db
    .select({ itemId: completed.itemId })
    .from(completed)
    .where(
      and(
        eq(completed.threadId, args.threadId),
        eq(completed.type, completedType),
        isNotNull(completed.itemId),
      ),
    );

  const rows = db
    .select(storedEventRowFields)
    .from(events)
    .where(
      and(
        eq(events.threadId, args.threadId),
        inArray(events.sequence, latestSequences),
        sql`json_extract(${events.data}, '$.item.status') = 'pending'`,
        notInArray(events.itemId, completedItemIds),
      ),
    )
    .all();

  return rows.sort((left, right) => left.sequence - right.sequence);
}

export function listActiveBackgroundTaskCountsByThreadIds(
  db: DbQueryConnection,
  args: ListActiveBackgroundTaskCountsByThreadIdsArgs,
): ActiveBackgroundTaskCountRow[] {
  const rows = queryInSqliteVariableBatches({
    dedupeKey: (threadId) => threadId,
    fixedVariableCount: 14,
    queryBatch: (threadIds) => {
      const startedType = "item/started" satisfies ThreadEventType;
      const progressType =
        "item/backgroundTask/progress" satisfies ThreadEventType;
      const completedType =
        "item/backgroundTask/completed" satisfies ThreadEventType;
      const backgroundTaskItemKind =
        "backgroundTask" satisfies ThreadEventItemType;
      const backgroundTaskItemKindPredicate = sql.raw(
        `= '${backgroundTaskItemKind}'`,
      );
      return db.all<ActiveBackgroundTaskCountRow>(sql`
    WITH latest_background_task_state AS (
      SELECT
        ${events.threadId} AS thread_id,
        ${events.itemId} AS item_id,
        MAX(
          CASE
            WHEN ${inArray(events.type, [startedType, progressType])}
              THEN ${events.sequence}
            ELSE NULL
          END
        ) AS sequence,
        MAX(
          CASE
            WHEN ${eq(events.type, completedType)} THEN 1
            ELSE 0
          END
        ) AS is_completed
      FROM ${events} INDEXED BY events_background_task_thread_type_item_sequence_idx
      WHERE ${inArray(events.threadId, [...threadIds])}
        AND ${events.itemKind} ${backgroundTaskItemKindPredicate}
        AND ${inArray(events.type, [startedType, progressType, completedType])}
        AND ${isNotNull(events.itemId)}
      GROUP BY ${events.threadId}, ${events.itemId}
    )
    SELECT
      active_event.thread_id AS threadId,
      SUM(
        CASE
          WHEN json_extract(active_event.data, '$.item.taskType') =
            ${LOCAL_WORKFLOW_TASK_TYPE}
          THEN 1
          ELSE 0
        END
      ) AS activeWorkflowCount,
      SUM(
        CASE
          WHEN json_extract(active_event.data, '$.item.taskType') IN (
            ${LOCAL_AGENT_TASK_TYPE},
            ${LOCAL_SUBAGENT_TASK_TYPE}
          )
          THEN 1
          ELSE 0
        END
      ) AS activeBackgroundAgentCount,
      SUM(
        CASE
          WHEN json_extract(active_event.data, '$.item.taskType') =
            ${LOCAL_BASH_TASK_TYPE}
          THEN 1
          ELSE 0
        END
      ) AS activeBackgroundCommandCount
    FROM latest_background_task_state latest
    JOIN events active_event
      ON active_event.thread_id = latest.thread_id
      AND active_event.sequence = latest.sequence
    WHERE latest.is_completed = 0
      AND latest.sequence IS NOT NULL
      AND json_extract(active_event.data, '$.item.status') = 'pending'
      AND json_extract(active_event.data, '$.item.taskType') IN (
        ${LOCAL_WORKFLOW_TASK_TYPE},
        ${LOCAL_AGENT_TASK_TYPE},
        ${LOCAL_SUBAGENT_TASK_TYPE},
        ${LOCAL_BASH_TASK_TYPE}
      )
      AND COALESCE(
        json_extract(active_event.data, '$.item.skipTranscript'),
        0
      ) = 0
    GROUP BY active_event.thread_id
    ORDER BY active_event.thread_id
  `);
    },
    values: args.threadIds,
    variableCountPerValue: 1,
  });

  return rows.sort((left, right) =>
    left.threadId < right.threadId
      ? -1
      : left.threadId > right.threadId
        ? 1
        : 0,
  );
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

export function hasRootStoredTurnStarted(
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
        isRootTurnStartedEventData,
      ),
    )
    .limit(1)
    .get();

  return row !== undefined;
}

export function findLastCompletedRootStoredTurn(
  db: DbQueryConnection,
  args: FindLastRootStoredTurnStartedArgs,
): CompletedRootStoredTurn | null {
  const completed = alias(events, "completed");
  const row = db
    .select({
      completedSequence: completed.sequence,
      startedSequence: events.sequence,
      turnId: events.turnId,
    })
    .from(events)
    .innerJoin(
      completed,
      and(
        eq(completed.threadId, events.threadId),
        eq(completed.turnId, events.turnId),
        eq(completed.type, "turn/completed"),
      ),
    )
    .where(
      and(
        eq(events.threadId, args.threadId),
        eq(events.type, "turn/started"),
        isRootTurnStartedEventData,
        args.atOrBeforeSequence === undefined
          ? undefined
          : lte(events.sequence, args.atOrBeforeSequence),
      ),
    )
    .orderBy(desc(events.sequence), desc(completed.sequence))
    .limit(1)
    .get();
  return row?.turnId
    ? {
        completedSequence: row.completedSequence,
        startedSequence: row.startedSequence,
        turnId: row.turnId,
      }
    : null;
}

export function findLastRootStoredTurnStarted(
  db: DbQueryConnection,
  args: FindLastRootStoredTurnStartedArgs,
): StoredTurnStartedKey | null {
  const row = db
    .select({ sequence: events.sequence, turnId: events.turnId })
    .from(events)
    .where(
      and(
        eq(events.threadId, args.threadId),
        eq(events.type, "turn/started"),
        isRootTurnStartedEventData,
        args.atOrBeforeSequence === undefined
          ? undefined
          : lte(events.sequence, args.atOrBeforeSequence),
      ),
    )
    .orderBy(desc(events.sequence))
    .limit(1)
    .get();
  return row?.turnId ? { sequence: row.sequence, turnId: row.turnId } : null;
}

export function listRecentStoredEventRows(
  db: DbConnection,
  args: ListRecentStoredEventRowsArgs,
): StoredEventRow[] {
  const conditions: SQL[] = [
    eq(events.threadId, args.threadId),
    gte(events.sequence, args.sequenceStart),
    isNotSupersededBackgroundTaskProgress,
  ];
  if (args.excludeDiagnosticEvents) conditions.push(isNotDiagnosticEvent);
  if (args.excludedTypes && args.excludedTypes.length > 0) {
    conditions.push(notInArray(events.type, [...args.excludedTypes]));
  }

  return db
    .select(storedEventRowFieldsWithInlineOutputLimit(args.maxInlineOutputChars))
    .from(events)
    .where(and(...conditions))
    .orderBy(events.sequence)
    .all();
}

const conversationOutlineLifecycleTypes = [
  "client/turn/requested",
  "turn/input/accepted",
  "turn/started",
  "turn/completed",
  "system/manager/user_message",
  "system/thread/interrupted",
  "system/error",
  "provider/error",
  "item/agentMessage/delta",
  "item/plan/delta",
] satisfies ThreadEventType[];
const conversationOutlineItemKinds = [
  "agentMessage",
  "plan",
] satisfies ThreadEventItemType[];
const conversationOutlineStructuralItemKinds = [
  "backgroundTask",
  "toolCall",
] satisfies ThreadEventItemType[];
const conversationOutlineStructuralLifecycleTypes = [
  "item/started",
  "item/completed",
  "item/backgroundTask/progress",
  "item/backgroundTask/completed",
] satisfies ThreadEventType[];

function storedConversationOutlineLifecycleWhere(
  threadId: string,
  sequenceStart: number,
): SQL {
  return and(
    eq(events.threadId, threadId),
    gte(events.sequence, sequenceStart),
    inArray(events.type, conversationOutlineLifecycleTypes),
  )!;
}

function storedConversationOutlineCompletedWhere(
  threadId: string,
  sequenceStart: number,
): SQL {
  return and(
    eq(events.threadId, threadId),
    gte(events.sequence, sequenceStart),
    eq(events.type, "item/completed"),
    inArray(events.itemKind, conversationOutlineItemKinds),
  )!;
}

function storedConversationOutlineStructuralWhere(
  threadId: string,
  sequenceStart: number,
): SQL {
  return and(
    eq(events.threadId, threadId),
    gte(events.sequence, sequenceStart),
    inArray(events.type, conversationOutlineStructuralLifecycleTypes),
    inArray(events.itemKind, conversationOutlineStructuralItemKinds),
  )!;
}

function storedConversationOutlineStructuralEventRowFields() {
  return {
    ...storedEventRowFields,
    data: sql<string>`CASE ${events.itemKind}
      WHEN 'toolCall' THEN json_remove(
        ${events.data},
        '$.item.arguments',
        '$.item.result',
        '$.item.error',
        '$.item.durationMs',
        '$.item.truncation'
      )
      WHEN 'backgroundTask' THEN json_remove(
        ${events.data},
        '$.item.workflow',
        '$.item.usage',
        '$.item.summary',
        '$.item.error',
        '$.item.outputFile'
      )
      ELSE ${events.data}
    END`,
  };
}

export function getLatestStoredConversationOutlineSequence(
  db: DbConnection,
  args: GetLatestStoredConversationOutlineSequenceArgs,
): number {
  const lifecycle = db
    .select({ sequence: max(events.sequence) })
    .from(events)
    .where(storedConversationOutlineLifecycleWhere(args.threadId, 0));
  const completedConversation = db
    .select({ sequence: max(events.sequence) })
    .from(events)
    .where(storedConversationOutlineCompletedWhere(args.threadId, 0));
  const structural = db
    .select({ sequence: max(events.sequence) })
    .from(events)
    .where(storedConversationOutlineStructuralWhere(args.threadId, 0));
  const contextClear = db
    .select({ sequence: max(events.sequence) })
    .from(events)
    .where(
      and(
        eq(events.threadId, args.threadId),
        eq(events.type, "system/operation"),
        sql`json_extract(${events.data}, '$.operation') = ${THREAD_CONTEXT_CLEAR_OPERATION}`,
        sql`json_extract(${events.data}, '$.status') = 'completed'`,
      ),
    );

  return unionAll(lifecycle, completedConversation, structural, contextClear)
    .all()
    .reduce((latest, row) => Math.max(latest, row.sequence ?? 0), 0);
}

export function listStoredConversationOutlineEventRows(
  db: DbConnection,
  args: ListStoredConversationOutlineEventRowsArgs,
): StoredEventRow[] {
  const lifecycleRows = db
    .select(storedEventRowFields)
    .from(events)
    .where(
      storedConversationOutlineLifecycleWhere(
        args.threadId,
        args.sequenceStart,
      ),
    );
  const completedConversationRows = db
    .select(storedEventRowFields)
    .from(events)
    .where(
      storedConversationOutlineCompletedWhere(
        args.threadId,
        args.sequenceStart,
      ),
    );
  const structuralRows = db
    .select(storedConversationOutlineStructuralEventRowFields())
    .from(events)
    .where(
      and(
        storedConversationOutlineStructuralWhere(
          args.threadId,
          args.sequenceStart,
        ),
        or(
          eq(events.type, "item/started"),
          sql`json_extract(${events.data}, '$.item.status') <> 'completed'`,
          sql`NOT EXISTS (
            SELECT 1
            FROM events AS earlier_structural_start
              INDEXED BY events_item_lifecycle_thread_item_sequence_idx
            WHERE earlier_structural_start.thread_id = ${events.threadId}
              AND earlier_structural_start.item_id = ${events.itemId}
              AND earlier_structural_start.type IN (
                'item/started',
                'item/completed',
                'item/backgroundTask/completed'
              )
              AND earlier_structural_start.type = 'item/started'
              AND earlier_structural_start.item_kind = ${events.itemKind}
              AND earlier_structural_start.sequence < ${events.sequence}
          )`,
        ),
        isNotSupersededBackgroundTaskProgress,
      ),
    );

  const rows = unionAll(
    lifecycleRows,
    completedConversationRows,
    structuralRows,
  ).all();
  return rows.sort((left, right) => left.sequence - right.sequence);
}

export interface StandardTimelineSegmentAnchorRow {
  rowId: string;
  sequence: number;
}

function timelineSegmentAnchorSelection() {
  return {
    rowId: sql<string>`CASE
      WHEN ${events.type} = 'system/operation' THEN ${events.id}
      ELSE ${events.threadId} || ':user-seed:' || ${events.sequence}
    END`,
    sequence: events.sequence,
  };
}

function timelineSegmentAnchorConditions(threadId: string): SQL | undefined {
  return and(
    eq(events.threadId, threadId),
    or(
      and(
        eq(events.type, "client/turn/requested"),
        sql`(
          COALESCE(json_extract(${events.data}, '$.target.kind'), 'new-turn')
            IN ('thread-start', 'new-turn')
          OR (
            json_extract(${events.data}, '$.target.kind') IN ('auto', 'steer')
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
      ),
      and(
        eq(events.type, "system/operation"),
        sql`json_extract(${events.data}, '$.operation') = ${THREAD_CONTEXT_CLEAR_OPERATION}`,
        sql`json_extract(${events.data}, '$.status') = 'completed'`,
      ),
    ),
  );
}

export interface ListTimelineSegmentAnchorsDescendingArgs {
  threadId: string;
  beforeSequence?: number;
  limit: number;
  sequenceStart: number;
}

export interface FindTimelineWindowBudgetFloorSequenceArgs {
  excludeDiagnosticEvents?: boolean;
  excludedTypes: readonly ThreadEventType[];
  eventBudget: number;
  sequenceStart: number;
  threadId: string;
  beforeSequence?: number;
}

export function findTimelineWindowBudgetFloorSequence(
  db: DbConnection,
  args: FindTimelineWindowBudgetFloorSequenceArgs,
): number | undefined {
  const conditions: SQL[] = [
    eq(events.threadId, args.threadId),
    gte(events.sequence, args.sequenceStart),
    isNotSupersededBackgroundTaskProgress,
  ];
  if (args.excludeDiagnosticEvents) conditions.push(isNotDiagnosticEvent);
  if (args.excludedTypes.length > 0) {
    conditions.push(notInArray(events.type, [...args.excludedTypes]));
  }
  if (args.beforeSequence !== undefined) {
    conditions.push(lt(events.sequence, args.beforeSequence));
  }

  const row = db
    .select({ sequence: events.sequence })
    .from(events)
    .where(and(...conditions))
    .orderBy(desc(events.sequence))
    .limit(1)
    .offset(args.eventBudget)
    .get();
  return row?.sequence;
}

export interface TimelineTurnBoundaryLookupArgs {
  excludeDiagnosticEvents?: boolean;
  sequence: number;
  threadId: string;
}

export function hasParentedEventCrossingSequence(
  db: DbConnection,
  args: TimelineTurnBoundaryLookupArgs,
): boolean {
  const row = db
    .select({ sequence: events.sequence })
    .from(events)
    .where(
      and(
        eq(events.threadId, args.threadId),
        gte(events.sequence, args.sequence),
        isNotNull(events.parentToolCallId),
        args.excludeDiagnosticEvents ? isNotDiagnosticEvent : undefined,
        sql`EXISTS (
          SELECT 1
          FROM events AS parent_event
          WHERE parent_event.thread_id = ${events.threadId}
            AND parent_event.item_id = ${events.parentToolCallId}
            AND parent_event.item_kind IN ('toolCall', 'delegation')
            AND parent_event.sequence < ${args.sequence}
        )`,
      ),
    )
    .limit(1)
    .get();
  return row !== undefined;
}

export function findUnfinishedTurnCoveringSequence(
  db: DbConnection,
  args: TimelineTurnBoundaryLookupArgs,
): string | null {
  const turnRows = db
    .selectDistinct({ turnId: events.turnId })
    .from(events)
    .where(
      and(
        eq(events.threadId, args.threadId),
        gte(events.sequence, args.sequence),
        isNotNull(events.turnId),
      ),
    )
    .limit(2)
    .all();
  const turnId = turnRows[0]?.turnId;
  if (turnRows.length !== 1 || !turnId) {
    return null;
  }

  const completed = db
    .select({ sequence: events.sequence })
    .from(events)
    .where(
      and(
        eq(events.threadId, args.threadId),
        eq(events.type, "turn/completed"),
        eq(events.turnId, turnId),
      ),
    )
    .limit(1)
    .get();
  return completed === undefined ? turnId : null;
}

export function listTimelineInterruptionRows(
  db: DbConnection,
  args: { threadId: string; sequenceStart: number; maxSeq: number },
): StoredEventRow[] {
  return db.select(storedEventRowSqlFields(null))
    .from(sql`${events} INDEXED BY events_thread_type_sequence_idx`)
    .where(and(eq(events.threadId, args.threadId), eq(events.type, "system/thread/interrupted"), gte(events.sequence, args.sequenceStart), lte(events.sequence, args.maxSeq)))
    .orderBy(events.sequence).all();
}

export function listTimelineOrderingContext(
  db: DbConnection,
  args: { threadId: string; sequenceStart: number; maxSeq: number },
) {
  return db.select({
    sequence: sql<number>`${events.sequence}`,
    turnId: sql<string | null>`${events.turnId}`,
    type: sql<StoredEventRow["type"]>`${events.type}`,
    parentToolCallId: sql<string | null>`${events.parentToolCallId}`,
    requestId: sql<string | null>`json_extract(${events.data}, '$.requestId')`,
    clientRequestId: sql<string | null>`json_extract(${events.data}, '$.clientRequestId')`,
    initiator: sql<string | null>`json_extract(${events.data}, '$.initiator')`,
  }).from(sql`${events} INDEXED BY events_thread_type_sequence_idx`).where(and(
    eq(events.threadId, args.threadId), gte(events.sequence, args.sequenceStart), lte(events.sequence, args.maxSeq),
    inArray(events.type, ["client/turn/requested", "turn/input/accepted", "turn/started", "turn/completed"]),
  )).orderBy(events.sequence).all();
}

export function getFirstParentedTimelineBoundarySequence(
  db: DbConnection,
  args: { threadId: string; sequenceStart: number; maxSeq: number },
): number | null {
  const result = db.get<{ sequence: number | null }>(sql`
    WITH parents AS MATERIALIZED (
      SELECT item_id, turn_id, min(sequence) AS start
      FROM events INDEXED BY events_delegating_item_lookup_idx
      WHERE thread_id = ${args.threadId}
        AND item_kind IN ('toolCall', 'delegation')
        AND parent_tool_call_id IS NULL
        AND sequence >= ${args.sequenceStart} AND sequence <= ${args.maxSeq}
        AND EXISTS (
          SELECT 1 FROM events AS root_start
          WHERE root_start.thread_id = events.thread_id
            AND root_start.turn_id = events.turn_id
            AND root_start.type = 'turn/started'
            AND root_start.parent_tool_call_id IS NULL
            AND root_start.sequence <= ${args.maxSeq}
        )
      GROUP BY item_id, turn_id
    ), spans AS MATERIALIZED (
      SELECT start, (
        SELECT max(child.sequence)
        FROM events AS child INDEXED BY events_parent_tool_call_thread_parent_sequence_idx
        WHERE child.thread_id = ${args.threadId}
          AND child.parent_tool_call_id IS NOT NULL
          AND child.parent_tool_call_id = parents.item_id
          AND child.sequence <= ${args.maxSeq}
      ) AS end FROM parents
    )
    SELECT min(${events.sequence}) AS sequence
    FROM events INNER JOIN spans
      ON ${events.sequence} > spans.start AND ${events.sequence} < spans.end
    WHERE ${events.type} = 'client/turn/requested'
      AND ${timelineSegmentAnchorConditions(args.threadId)}
      AND json_extract(${events.data}, '$.initiator') = 'user'
  `);
  return result?.sequence ?? null;
}

export function listTimelineSegmentAnchorsDescending(
  db: DbConnection,
  args: ListTimelineSegmentAnchorsDescendingArgs,
): StandardTimelineSegmentAnchorRow[] {
  const conditions = and(
    timelineSegmentAnchorConditions(args.threadId),
    gte(events.sequence, args.sequenceStart),
  );
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

function storedTimelineWindowConditions(
  args: ListStoredTimelineWindowEventRowsArgs,
): SQL[] {
  const conditions: SQL[] = [
    eq(events.threadId, args.threadId),
    gte(events.sequence, args.sequenceStart),
    isNotSupersededBackgroundTaskProgressBefore(args.beforeSequence),
  ];
  if (args.beforeSequence !== undefined) {
    conditions.push(lt(events.sequence, args.beforeSequence));
  }
  if (args.excludeDiagnosticEvents) conditions.push(isNotDiagnosticEvent);
  if (args.excludedTypes && args.excludedTypes.length > 0) {
    conditions.push(notInArray(events.type, [...args.excludedTypes]));
  }
  return conditions;
}

function storedTimelineWindowDataColumn(
  maxInlineOutputChars: InlineOutputCharLimit,
) {
  return maxInlineOutputChars === null
    ? events.data
    : truncatedEventDataColumn(maxInlineOutputChars);
}

export function getStoredTimelineWindowEventDataBytes(
  db: DbConnection,
  args: GetStoredTimelineWindowEventDataBytesArgs,
): number {
  const data = storedTimelineWindowDataColumn(args.maxInlineOutputChars);
  const row = db
    .select({
      dataBytes: sql<number>`COALESCE(SUM(length(CAST(${data} AS BLOB))), 0)`,
    })
    .from(events)
    .where(and(...storedTimelineWindowConditions(args)))
    .get();
  return row?.dataBytes ?? 0;
}

export function findStoredTimelineWindowByteBudgetFloor(
  db: DbConnection,
  args: FindStoredTimelineWindowByteBudgetFloorArgs,
): StoredTimelineWindowByteBudgetFloor {
  const data = storedTimelineWindowDataColumn(args.maxInlineOutputChars);
  const query = db
    .select({
      createdAt: events.createdAt,
      dataBytes:
        sql<number>`length(CAST(${data} AS BLOB))`.as("data_bytes"),
      sequence: events.sequence,
      turnId: events.turnId,
    })
    .from(events)
    .where(and(...storedTimelineWindowConditions(args)))
    .orderBy(desc(events.sequence))
    .toSQL();
  const statement = db.$client.prepare<
    unknown[],
    {
      created_at: number;
      data_bytes: number;
      sequence: number;
      turn_id: string | null;
    }
  >(query.sql);
  let includedDataBytes = 0;
  let sequenceStart: number | null = null;
  let result: StoredTimelineWindowByteBudgetFloor | null = null;
  let oversizedEvent: Extract<
    StoredTimelineWindowByteBudgetFloor,
    { kind: "single-event-too-large" }
  > | null = null;

  for (const row of statement.iterate(...query.params)) {
    if (oversizedEvent !== null) {
      oversizedEvent.hasOlderRows = true;
      result = oversizedEvent;
      break;
    }
    if (includedDataBytes + row.data_bytes > args.maxDataBytes) {
      if (sequenceStart === null) {
        oversizedEvent = {
          createdAt: row.created_at,
          eventDataBytes: row.data_bytes,
          hasOlderRows: false,
          kind: "single-event-too-large",
          sequenceStart: row.sequence,
          turnId: row.turn_id,
        };
        continue;
      }
      result = {
        eventDataBytes: includedDataBytes,
        kind: "floor",
        sequenceStart,
      };
      break;
    }
    includedDataBytes += row.data_bytes;
    sequenceStart = row.sequence;
  }

  if (result !== null) {
    return result;
  }
  if (oversizedEvent !== null) {
    return oversizedEvent;
  }
  return { eventDataBytes: includedDataBytes, kind: "fits" };
}

export function listStoredTimelineTurnEventRows(
  db: DbConnection,
  args: ListStoredTimelineWindowEventRowsArgs & { turnIds: readonly string[] },
): StoredEventRow[] {
  if (args.turnIds.length === 0) return [];
  return queryInSqliteVariableBatches({
    values: args.turnIds,
    variableCountPerValue: 1,
    dedupeKey: (turnId) => turnId,
    fixedVariableCount: 32,
    queryBatch: (turnIds) => db
      .select(storedEventRowSqlFields(args.maxInlineOutputChars))
      .from(sql`${events} INDEXED BY events_thread_turn_type_item_sequence_idx`)
      .where(and(...storedTimelineWindowConditions(args), inArray(events.turnId, [...turnIds])))
      .all(),
  }).sort((left, right) => left.sequence - right.sequence);
}

export function listTimelineRootWindowTurnIds(
  db: DbConnection,
  args: ListStoredTimelineWindowEventRowsArgs,
): string[] {
  return db.selectDistinct({ turnId: sql<string>`${events.turnId}` }).from(events).where(and(
    ...storedTimelineWindowConditions(args),
    isNotNull(events.turnId),
    isNull(events.parentToolCallId),
    sql`EXISTS (SELECT 1 FROM events AS root_start
      WHERE root_start.thread_id = ${events.threadId}
        AND root_start.turn_id = ${events.turnId}
        AND root_start.type = 'turn/started'
        AND root_start.parent_tool_call_id IS NULL)`,
  )).all().map((row) => row.turnId);
}

export function listStoredTimelineThreadWindowEventRows(
  db: DbConnection,
  args: ListStoredTimelineWindowEventRowsArgs,
): StoredEventRow[] {
  return db.select(storedEventRowFieldsWithInlineOutputLimit(args.maxInlineOutputChars))
    .from(events).where(and(...storedTimelineWindowConditions(args), isNull(events.turnId)))
    .orderBy(events.sequence).all();
}

export function listStoredTimelineWindowEventRows(
  db: DbConnection,
  args: ListStoredTimelineWindowEventRowsArgs,
): StoredEventRow[] {
  return db
    .select(storedEventRowFieldsWithInlineOutputLimit(args.maxInlineOutputChars))
    .from(events)
    .where(and(...storedTimelineWindowConditions(args)))
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
    sequenceStart: number;
    threadId: string;
  },
): StoredEventRow[] {
  const latestRow = db
    .select(storedEventRowFields)
    .from(events)
    .where(
      and(
        eq(events.threadId, args.threadId),
        gte(events.sequence, args.sequenceStart),
        eq(events.type, args.eventType),
        isNotNestedTurnUsageEvent,
      ),
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
        gte(events.sequence, args.sequenceStart),
        eq(events.type, args.eventType),
        isNotNestedTurnUsageEvent,
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
    sequenceStart: args.sequenceStart,
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

const isNotDiagnosticEvent = sql`(
  ${events.type} <> 'provider.env-resolved'
  AND (
    ${events.type} <> 'provider/unhandled'
    OR COALESCE((
      json_extract(${events.data}, '$.rawEvent.method') = 'sdk/message'
      AND json_extract(${events.data}, '$.rawEvent.params.message.subtype')
        IN ('model_fallback', 'model_refusal_fallback')
      AND json_type(${events.data}, '$.rawEvent.params.message.original_model') = 'text'
      AND length(json_extract(${events.data}, '$.rawEvent.params.message.original_model')) > 0
      AND json_type(${events.data}, '$.rawEvent.params.message.fallback_model') = 'text'
      AND length(json_extract(${events.data}, '$.rawEvent.params.message.fallback_model')) > 0
    ), 0)
    OR CASE
      WHEN instr(${events.data}, '"imageGeneration"') = 0 THEN 0
      WHEN json_valid(${events.data}) THEN
        json_extract(${events.data}, '$.rawType') = 'item/completed'
        AND json_extract(${events.data}, '$.rawEvent.method') = 'item/completed'
        AND json_extract(${events.data}, '$.rawEvent.params.item.type') = 'imageGeneration'
        AND (
          json_type(${events.data}, '$.rawEvent.params.item.truncation.result') = 'object'
          OR json_type(${events.data}, '$.rawEvent.params.item.result') IS NULL
          OR json_type(${events.data}, '$.rawEvent.params.item.result') = 'null'
          OR (
            json_type(${events.data}, '$.rawEvent.params.item.result') = 'text'
            AND length(json_extract(${events.data}, '$.rawEvent.params.item.result'))
              <= ${COMPLETED_EVENT_OUTPUT_TRUNCATION_THRESHOLD_CHARS}
          )
        )
      ELSE 0
    END
  )
)`;

export function getLatestThreadSequence(
  db: DbConnection,
  args: GetLatestThreadSequenceArgs,
): number {
  const row = db
    .select({
      maxSequence: max(events.sequence),
    })
    .from(events)
    .where(
      and(
        eq(events.threadId, args.threadId),
        args.excludeDiagnosticEvents ? isNotDiagnosticEvent : undefined,
      ),
    )
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
        isRootTurnStartedEventData,
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

export function getLatestCompletedThreadContextClearSequence(
  db: DbQueryConnection,
  args: GetLatestCompletedThreadContextClearSequenceArgs,
): number | null {
  const conditions: SQL[] = [
    eq(events.threadId, args.threadId),
    eq(events.type, "system/operation"),
    sql`json_extract(${events.data}, '$.operation') = ${THREAD_CONTEXT_CLEAR_OPERATION}`,
    sql`json_extract(${events.data}, '$.status') = 'completed'`,
  ];
  if (args.atOrBeforeSequence !== undefined) {
    conditions.push(lte(events.sequence, args.atOrBeforeSequence));
  }
  const row = db
    .select({ sequence: events.sequence })
    .from(events)
    .where(and(...conditions))
    .orderBy(desc(events.sequence))
    .limit(1)
    .get();
  return row?.sequence ?? null;
}

interface StoredProviderThreadIdentityScope {
  hostId: string | null;
  providerId: string;
  threadId: string;
}

interface StoredProviderThreadIdentityCandidate {
  providerThreadId: string;
  threadId: string;
}

interface ListStoredProviderThreadClaimsArgs {
  hostId: string | null;
  providerId: string;
  providerThreadIds: readonly string[];
}

interface ResolveStoredProviderSessionsArgs {
  threadIds: readonly string[];
}

interface ClassifyStoredProviderThreadClaimArgs {
  providerThreadId: string;
  threadId: string;
}

type StoredProviderThreadClaim =
  | { kind: "owned"; threadId: string }
  | { kind: "tied"; threadIds: string[] };

export type StoredProviderSession =
  | { kind: "none" }
  | { kind: "owned"; providerThreadId: string }
  | {
      kind: "foreign";
      providerThreadId: string;
      claimantThreadIds: string[];
    }
  | {
      kind: "ambiguous";
      providerThreadId: string;
      claimantThreadIds: string[];
    };

export type StoredProviderThreadClaimClass =
  | "owned"
  | "unannounced"
  | "foreign"
  | "ambiguous";

const storedProviderThreadIdentityEpochFilter = sql`${events.sequence} > COALESCE((
  SELECT MAX(context_clear.sequence)
  FROM events AS context_clear
  WHERE context_clear.thread_id = ${events.threadId}
    AND context_clear.type = 'system/operation'
    AND json_extract(context_clear.data, '$.operation') = ${THREAD_CONTEXT_CLEAR_OPERATION}
    AND json_extract(context_clear.data, '$.status') = 'completed'
), 0)`;

function listStoredProviderThreadIdentityScopes(
  db: DbQueryConnection,
  threadIds: readonly string[],
): StoredProviderThreadIdentityScope[] {
  return db
    .select({
      hostId: environments.hostId,
      providerId: threads.providerId,
      threadId: threads.id,
    })
    .from(threads)
    .leftJoin(environments, eq(environments.id, threads.environmentId))
    .where(inArray(threads.id, [...threadIds]))
    .all();
}

function listStoredProviderThreadIdentityCandidates(
  db: DbQueryConnection,
  threadIds: readonly string[],
): StoredProviderThreadIdentityCandidate[] {
  return db
    .select({
      providerThreadId: sql<string>`${events.providerThreadId}`,
      threadId: events.threadId,
    })
    .from(events)
    .where(
      and(
        inArray(events.threadId, [...threadIds]),
        eq(events.type, "thread/identity"),
        isNotNull(events.providerThreadId),
        storedProviderThreadIdentityEpochFilter,
      ),
    )
    .orderBy(events.threadId, desc(events.sequence))
    .all();
}

function listStoredProviderThreadClaims(
  db: DbQueryConnection,
  args: ListStoredProviderThreadClaimsArgs,
): Map<string, StoredProviderThreadClaim> {
  const claims = new Map<string, StoredProviderThreadClaim>();
  if (args.providerThreadIds.length === 0) {
    return claims;
  }
  const rows = db
    .select({
      firstClaimedAt: sql<number>`MIN(${events.createdAt})`,
      providerThreadId: sql<string>`${events.providerThreadId}`,
      threadId: events.threadId,
    })
    .from(events)
    .innerJoin(threads, eq(threads.id, events.threadId))
    .leftJoin(environments, eq(environments.id, threads.environmentId))
    .where(
      and(
        eq(events.type, "thread/identity"),
        inArray(events.providerThreadId, [...args.providerThreadIds]),
        eq(threads.providerId, args.providerId),
        args.hostId === null
          ? undefined
          : or(
              isNull(environments.hostId),
              eq(environments.hostId, args.hostId),
            ),
      ),
    )
    .groupBy(events.providerThreadId, events.threadId)
    .all();
  const earliestByProviderThreadId = new Map<
    string,
    { firstClaimedAt: number; threadIds: string[] }
  >();
  for (const row of rows) {
    const earliest = earliestByProviderThreadId.get(row.providerThreadId);
    if (earliest === undefined || row.firstClaimedAt < earliest.firstClaimedAt) {
      earliestByProviderThreadId.set(row.providerThreadId, {
        firstClaimedAt: row.firstClaimedAt,
        threadIds: [row.threadId],
      });
    } else if (row.firstClaimedAt === earliest.firstClaimedAt) {
      earliest.threadIds.push(row.threadId);
    }
  }
  for (const [providerThreadId, earliest] of earliestByProviderThreadId) {
    const [owner, ...others] = earliest.threadIds;
    if (owner === undefined) {
      continue;
    }
    claims.set(
      providerThreadId,
      others.length === 0
        ? { kind: "owned", threadId: owner }
        : { kind: "tied", threadIds: [...earliest.threadIds].sort() },
    );
  }
  return claims;
}

function classifyClaim(
  claim: StoredProviderThreadClaim | undefined,
  threadId: string,
): StoredProviderThreadClaimClass {
  if (claim === undefined) {
    return "unannounced";
  }
  if (claim.kind === "owned") {
    return claim.threadId === threadId ? "owned" : "foreign";
  }
  return claim.threadIds.includes(threadId) ? "ambiguous" : "foreign";
}

function otherClaimants(
  claim: StoredProviderThreadClaim | undefined,
  threadId: string,
): string[] {
  if (claim === undefined) {
    return [];
  }
  const claimants = claim.kind === "owned" ? [claim.threadId] : claim.threadIds;
  return claimants.filter((claimant) => claimant !== threadId);
}

function resolveThreadProviderSession(args: {
  candidates: readonly string[];
  claims: ReadonlyMap<string, StoredProviderThreadClaim>;
  threadId: string;
}): StoredProviderSession {
  let firstForeign: StoredProviderSession | null = null;
  for (const providerThreadId of args.candidates) {
    const claim = args.claims.get(providerThreadId);
    switch (classifyClaim(claim, args.threadId)) {
      case "owned":
      case "unannounced":
        return { kind: "owned", providerThreadId };
      case "ambiguous":
        return {
          kind: "ambiguous",
          providerThreadId,
          claimantThreadIds: otherClaimants(claim, args.threadId),
        };
      case "foreign":
        firstForeign ??= {
          kind: "foreign",
          providerThreadId,
          claimantThreadIds: otherClaimants(claim, args.threadId),
        };
    }
  }
  return firstForeign ?? { kind: "none" };
}

function identityScopeKey(scope: StoredProviderThreadIdentityScope): string {
  return `${scope.providerId}\n${scope.hostId ?? ""}`;
}

export function resolveStoredProviderSessions(
  db: DbQueryConnection,
  args: ResolveStoredProviderSessionsArgs,
): Map<string, StoredProviderSession> {
  const threadIds = [...new Set(args.threadIds)];
  const resolved = new Map<string, StoredProviderSession>(
    threadIds.map((threadId) => [threadId, { kind: "none" }]),
  );
  if (threadIds.length === 0) {
    return resolved;
  }
  const candidatesByThreadId = new Map<string, string[]>();
  for (const row of listStoredProviderThreadIdentityCandidates(db, threadIds)) {
    const candidates = candidatesByThreadId.get(row.threadId) ?? [];
    if (candidates.at(-1) !== row.providerThreadId) {
      candidates.push(row.providerThreadId);
    }
    candidatesByThreadId.set(row.threadId, candidates);
  }
  if (candidatesByThreadId.size === 0) {
    return resolved;
  }
  const scopeGroups = new Map<string, StoredProviderThreadIdentityScope[]>();
  for (const scope of listStoredProviderThreadIdentityScopes(db, [
    ...candidatesByThreadId.keys(),
  ])) {
    const key = identityScopeKey(scope);
    scopeGroups.set(key, [...(scopeGroups.get(key) ?? []), scope]);
  }
  for (const group of scopeGroups.values()) {
    const [first] = group;
    if (first === undefined) {
      continue;
    }
    const claims = listStoredProviderThreadClaims(db, {
      hostId: first.hostId,
      providerId: first.providerId,
      providerThreadIds: [
        ...new Set(
          group.flatMap(
            (scope) => candidatesByThreadId.get(scope.threadId) ?? [],
          ),
        ),
      ],
    });
    for (const scope of group) {
      resolved.set(
        scope.threadId,
        resolveThreadProviderSession({
          candidates: candidatesByThreadId.get(scope.threadId) ?? [],
          claims,
          threadId: scope.threadId,
        }),
      );
    }
  }
  return resolved;
}

export function getStoredProviderSession(
  db: DbQueryConnection,
  threadId: string,
): StoredProviderSession {
  return (
    resolveStoredProviderSessions(db, { threadIds: [threadId] }).get(
      threadId,
    ) ?? { kind: "none" }
  );
}

export function getLastStoredProviderThreadId(
  db: DbQueryConnection,
  threadId: string,
): string | null {
  const session = getStoredProviderSession(db, threadId);
  return session.kind === "owned" ? session.providerThreadId : null;
}

export function classifyStoredProviderThreadClaim(
  db: DbQueryConnection,
  args: ClassifyStoredProviderThreadClaimArgs,
): StoredProviderThreadClaimClass {
  const [scope] = listStoredProviderThreadIdentityScopes(db, [args.threadId]);
  if (scope === undefined) {
    return "foreign";
  }
  const claims = listStoredProviderThreadClaims(db, {
    hostId: scope.hostId,
    providerId: scope.providerId,
    providerThreadIds: [args.providerThreadId],
  });
  return classifyClaim(claims.get(args.providerThreadId), args.threadId);
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
        isRootTurnStartedEventData,
        sql`${events.sequence} = (
          SELECT MAX(latest.sequence)
          FROM events AS latest
          WHERE latest.thread_id = ${events.threadId}
            AND latest.type = 'turn/started'
            AND latest.turn_id IS NOT NULL
            AND latest.parent_tool_call_id IS NULL
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

  for (const [threadId, session] of resolveStoredProviderSessions(db, {
    threadIds,
  })) {
    const state = statesByThreadId.get(threadId);
    if (state) {
      state.latestProviderThreadId =
        session.kind === "owned" ? session.providerThreadId : null;
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

  const result = db.run(
    sql`WITH root_usage AS (
          SELECT usage.id, usage.sequence, usage.data
          FROM events AS usage
          WHERE usage.thread_id = ${args.threadId}
            AND usage.type = ${args.eventType}
            AND NOT EXISTS (
              SELECT 1
              FROM events AS nested_turn_started
              WHERE nested_turn_started.thread_id = usage.thread_id
                AND nested_turn_started.turn_id = usage.turn_id
                AND nested_turn_started.type = 'turn/started'
                AND nested_turn_started.parent_tool_call_id IS NOT NULL
            )
        )
        DELETE FROM events
        WHERE ${events.threadId} = ${args.threadId}
          AND ${events.type} = ${args.eventType}
          AND ${events.sequence} <= ${args.sequenceCutoff}
          AND ${events.id} NOT IN (
            SELECT root_usage.id
            FROM root_usage
            ORDER BY root_usage.sequence DESC
            LIMIT 1
          )
          AND ${events.id} NOT IN (
            SELECT root_usage.id
            FROM root_usage
            WHERE json_extract(root_usage.data, ${args.contextWindowJsonPath}) IS NOT NULL
            ORDER BY root_usage.sequence DESC
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
        WHERE rowid IN (
          SELECT candidate.rowid
          FROM events candidate
          WHERE candidate.thread_id = ${args.threadId}
          AND candidate.type IN (
            ${"item/agentMessage/delta" satisfies PrunableResolvedDeltaEventType},
            ${"item/commandExecution/outputDelta" satisfies PrunableResolvedDeltaEventType},
            ${"item/reasoning/summaryTextDelta" satisfies PrunableResolvedDeltaEventType},
            ${"item/reasoning/textDelta" satisfies PrunableResolvedDeltaEventType}
          )
          AND candidate.item_id IS NOT NULL
          AND candidate.turn_id IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM events completed
            WHERE completed.thread_id = candidate.thread_id
              AND completed.turn_id = candidate.turn_id
              AND completed.type = ${itemCompletedType}
              AND completed.item_kind = CASE
                WHEN candidate.type = ${"item/agentMessage/delta" satisfies PrunableResolvedDeltaEventType}
                  THEN ${prunableDeltaMatches["item/agentMessage/delta"]}
                WHEN candidate.type = ${"item/commandExecution/outputDelta" satisfies PrunableResolvedDeltaEventType}
                  THEN ${prunableDeltaMatches["item/commandExecution/outputDelta"]}
                WHEN candidate.type = ${"item/reasoning/summaryTextDelta" satisfies PrunableResolvedDeltaEventType}
                  THEN ${prunableDeltaMatches["item/reasoning/summaryTextDelta"]}
                WHEN candidate.type = ${"item/reasoning/textDelta" satisfies PrunableResolvedDeltaEventType}
                  THEN ${prunableDeltaMatches["item/reasoning/textDelta"]}
              END
              AND completed.item_id = candidate.item_id
              AND (
                candidate.type <> ${"item/commandExecution/outputDelta" satisfies PrunableResolvedDeltaEventType}
                OR json_type(completed.data, '$.item.aggregatedOutput') IS NOT NULL
              )
              AND completed.parent_tool_call_id IS candidate.parent_tool_call_id
          )
          AND EXISTS (
            SELECT 1
            FROM events earlier_delta
            WHERE earlier_delta.thread_id = candidate.thread_id
              AND earlier_delta.turn_id = candidate.turn_id
              AND earlier_delta.type = candidate.type
              AND earlier_delta.item_id = candidate.item_id
              AND earlier_delta.parent_tool_call_id IS candidate.parent_tool_call_id
              AND earlier_delta.sequence < candidate.sequence
          )
          LIMIT ${RESOLVED_ITEM_DELTA_PRUNE_BATCH_SIZE}
        )`,
  );

  return result.changes;
}

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

export function listOpenBackgroundTaskItemRowsForThread(
  db: DbQueryConnection,
  args: ListOpenBackgroundTaskItemRowsForThreadArgs,
): OpenBackgroundTaskItemRow[] {
  const startedType = "item/started" satisfies ThreadEventType;
  const progressType =
    "item/backgroundTask/progress" satisfies ThreadEventType;
  const completedType =
    "item/backgroundTask/completed" satisfies ThreadEventType;
  const settled = alias(events, "settled_thread_background_task");

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
    .where(
      and(
        eq(events.threadId, args.threadId),
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
    .orderBy(events.itemId)
    .all();

  return rows.flatMap((row) =>
    row.itemId === null ? [] : [{ ...row, itemId: row.itemId }],
  );
}

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
