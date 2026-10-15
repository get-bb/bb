import { storedText } from "../stored-text.js";
import {
  deleteColdEventSuffix,
  includeColdEventRows,
  readColdEventJsonString,
  selectColdEventRecords,
  threadHasColdChunks,
  type ColdEventRecord,
} from "./cold-event-chunks.js";
import { markThreadPruningWork } from "./thread-pruning-work.js";
import { isBeforeLatestThreadEvent } from "./event-pruning-guards.js";
import { acquireProjectAttachmentOwnership } from "./project-attachments.js";
import {
  storedAttachmentPaths,
  type ProjectAttachmentOwnershipMode,
} from "@bb/domain";
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
import { bumpThreadEventRewriteGeneration } from "./event-rewrite-generation.js";
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
import { queryInSqliteVariableBatches } from "./sqlite-variable-batches.js";

const STORED_EVENT_SEQUENCE_LOOKUP_CHUNK_SIZE = 250;
const CLIENT_TURN_REQUEST_KEY_BATCH_SIZE = 900;
const ITEM_EVENT_TYPES = threadEventTypeValues.filter((type) =>
  type.startsWith("item/"),
);

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

function isNotSupersededBackgroundTaskProgressBefore(
  beforeSequence: number | undefined,
): SQL {
  if (beforeSequence === undefined)
    return isNotSupersededBackgroundTaskProgress;
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
  type: "item/started" | "item/completed" | "item/backgroundTask/completed";
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
  const rows = queryInSqliteVariableBatches({
    dedupeKey: buildItemLifecycleKey,
    fixedVariableCount: 0,
    queryBatch: (keys) => {
      const requestedValues = sql.join(
        keys.map((key) => sql`(${key.threadId}, ${key.itemId})`),
        sql`, `,
      );
      return db.all<LatestItemLifecycleRow & { sequence: number }>(sql`
        WITH requested_item(thread_id, item_id) AS (
          VALUES ${requestedValues}
        )
        SELECT
          lifecycle.thread_id AS threadId,
          lifecycle.item_id AS itemId,
          lifecycle.type AS type,
          lifecycle.sequence AS sequence
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
  const latest = new Map(rows.map((row) => [buildItemLifecycleKey(row), row]));
  const byThread = new Map<string, Set<string>>();
  for (const key of lookupKeys) {
    const ids = byThread.get(key.threadId) ?? new Set<string>();
    ids.add(key.itemId);
    byThread.set(key.threadId, ids);
  }
  for (const [threadId, ids] of byThread) {
    for (const row of selectColdEventRecords(db, {
      threadId,
      itemIds: [...ids],
      types: ["item/completed"],
    })) {
      if (row.itemId === null) continue;
      const key = buildItemLifecycleKey({ threadId, itemId: row.itemId });
      const previous = latest.get(key);
      if (!previous || previous.sequence < row.sequence)
        latest.set(key, {
          threadId,
          itemId: row.itemId,
          type: "item/completed",
          sequence: row.sequence,
        });
    }
  }
  return [...latest.values()];
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
  const deletedEventCount = result.changes + deleteColdEventSuffix(db, args);
  if (deletedEventCount > 0) {
    bumpThreadEventRewriteGeneration(args.threadId);
    markThreadPruningWork(db, [args.threadId]);
  }
  return { deletedEventCount };
}

export interface ListThreadIdsWithLatestHostDaemonRestartInterruptionArgs {
  threadIds: readonly string[];
}

export interface ListThreadIdsStoppedSinceLastTurnStartArgs {
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
  attachmentOwnership: ProjectAttachmentOwnershipMode;
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
  if (args.type === "client/turn/requested") {
    acquireProjectAttachmentOwnership(
      db,
      args.threadId,
      storedAttachmentPaths(args.data),
      args.attachmentOwnership,
    );
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
      const highWaterMarks = getHighWaterMarks(tx, [
        ...new Set(eventInputs.map((input) => input.threadId)),
      ]);
      for (const [index, input] of eventInputs.entries()) {
        const createdAt = input.createdAt ?? Date.now();
        const turnId = getThreadEventScopeTurnId(input.scope) ?? null;
        const insertResult = insertStoredEventRow(tx, {
          attachmentOwnership: "required",
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
          const highWaterMark = highWaterMarks[input.threadId];
          if (highWaterMark !== undefined && input.sequence <= highWaterMark) {
            bumpThreadEventRewriteGeneration(input.threadId);
          }
          const eventTypes = eventTypesByThreadId.get(input.threadId);
          if (eventTypes) {
            eventTypes.add(input.type);
          } else {
            eventTypesByThreadId.set(input.threadId, new Set([input.type]));
          }
        }
      }
      markThreadPruningWork(tx, eventTypesByThreadId.keys());
      return { insertedCount, insertedInputIndexes };
    },
    { behavior: "immediate" },
  );

  for (const [threadId, eventTypes] of eventTypesByThreadId) {
    notifier.notifyThread(threadId, ["events-appended"], {
      eventTypes: Array.from(eventTypes),
      timelineSequence: getLatestThreadSequence(db, { threadId }),
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

const ORPHAN_DROPPABLE_TURN_EVENT_TYPES: ReadonlySet<ThreadEventType> = new Set(
  [
    "thread/tokenUsage/updated",
    "thread/contextWindowUsage/updated",
    "provider/unhandled",
  ],
);

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

function isStoredEventPayload(
  value: unknown,
): value is Record<string, unknown> {
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

function canProduceThreadSearchSegments(args: {
  itemKind: ThreadEventItemType | null;
  type: ThreadEventType;
}): boolean {
  switch (args.type) {
    case "client/turn/requested":
    case "system/manager/user_message":
      return true;
    case "item/completed":
      return args.itemKind === "agentMessage" || args.itemKind === null;
    default:
      return false;
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

function parseDaemonThreadEvent(
  input: AppendDaemonEventInput,
): ThreadEvent | null {
  if (!canProduceThreadSearchSegments(input)) {
    return null;
  }
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
    listLatestItemLifecycleRows(db, collectTerminalItemLookupKeys(eventInputs))
      .filter((row) => isTerminalItemEventType(row.type))
      .map(buildItemLifecycleKey),
  );
  const now = Date.now();
  for (const [index, input] of eventInputs.entries()) {
    if (input.type === "turn/diff/updated") continue;
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
      attachmentOwnership: "required",
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

  markThreadPruningWork(
    db,
    acceptedEvents.map((event) => event.threadId),
  );
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
      attachmentOwnership: "best-effort",
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
  markThreadPruningWork(db, [args.targetThreadId]);
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
      attachmentOwnership: "required",
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

  markThreadPruningWork(db, threadIds);
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
    timelineSequence: sequence,
  });
  return sequence;
}

export function getHighWaterMarks(
  db: DbQueryConnection,
  threadIds: string[],
): Record<string, number> {
  const result: Record<string, number> = {};
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
          SELECT MAX(sequence) FROM (
            SELECT sequence FROM events
            WHERE events.thread_id = requested.thread_id
            UNION ALL
            SELECT seq_end AS sequence FROM event_cold_chunks
            WHERE event_cold_chunks.thread_id = requested.thread_id
          )
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

  return result;
}

export interface ListEventsOptions {
  threadId: string;
  afterSequence?: number;
  limit?: number;
}

const storedEventRowFields = {
  createdAt: events.createdAt,
  data: storedText(events.data),
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

function coldRecordToStoredEventRow(event: ColdEventRecord): StoredEventRow {
  return {
    createdAt: event.createdAt,
    data: event.data,
    id: event.id,
    itemId: event.itemId,
    itemKind: event.itemKind,
    parentToolCallId: event.parentToolCallId,
    providerThreadId: event.providerThreadId,
    scopeKind: event.scopeKind,
    sequence: event.sequence,
    threadId: event.threadId,
    turnId: event.turnId,
    type: event.type,
  };
}

function coldRecordToListedEvent(event: ColdEventRecord) {
  return {
    ...coldRecordToStoredEventRow(event),
    environmentId: event.environmentId,
  };
}

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

export interface ListStoredTurnKeysArgs {
  keys: readonly ThreadTurnKey[];
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

export interface FindStoredTimelineWindowByteBudgetFloorArgs extends ListStoredTimelineWindowEventRowsArgs {
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
  threadId: string;
}

interface PruningWindow {
  candidateIds: readonly string[];
  usageKeepers: { latestRootSequence: number; latestContextSequence: number };
  afterSequence: number;
  throughSequence: number;
}

function pruningCandidates(args: PruningWindow & { threadId: string }): SQL {
  if (args.candidateIds.length > 500)
    throw new Error("Pruning candidate limit exceeded");
  return args.candidateIds.length === 0
    ? sql`SELECT id FROM events WHERE 0`
    : sql`SELECT id FROM events INDEXED BY sqlite_autoindex_events_1 WHERE ${inArray(events.id, [...args.candidateIds])} AND thread_id = ${args.threadId}
        AND sequence > ${args.afterSequence} AND sequence <= ${args.throughSequence}`;
}

export interface PruneContextWindowUsageEventsArgs extends PruningWindow {
  threadId: string;
}

export interface PruneTokenUsageEventsArgs extends PruningWindow {
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
  const hasCold = threadHasColdChunks(db, threadId);
  const where =
    afterSequence != null
      ? sql`${events.threadId} = ${threadId} AND ${events.sequence} > ${afterSequence}`
      : eq(events.threadId, threadId);
  const q = db.select().from(events).where(where).orderBy(events.sequence);
  const inline = !limit ? q.all() : q.limit(limit).all();
  if (!hasCold) return inline;
  return includeColdEventRows(
    db,
    {
      afterSequence,
      limit,
      order: "asc",
      threadId,
    },
    inline,
    coldRecordToListedEvent,
  );
}

export function listStoredEventRows(
  db: DbQueryConnection,
  args: ListStoredEventRowsArgs,
): StoredEventRow[] {
  if (args.types?.length === 0) {
    return [];
  }

  const limit = args.limit ?? Number.MAX_SAFE_INTEGER;
  const order = args.order ?? "asc";
  const readCold = threadHasColdChunks(db, args.threadId);
  const pageLimit = limit;
  const types = args.types === undefined ? undefined : [...new Set(args.types)];
  const listPage = (
    pageTypes: readonly ThreadEventType[] | undefined,
  ): StoredEventRow[] => {
    return db
      .select(storedEventRowSqlFields(null))
      .from(
        pageTypes === undefined
          ? events
          : sql`${events} INDEXED BY events_thread_type_sequence_idx`,
      )
      .where(
        and(
          eq(events.threadId, args.threadId),
          args.afterSequence === undefined
            ? undefined
            : gt(events.sequence, args.afterSequence),
          args.beforeSequence === undefined
            ? undefined
            : lt(events.sequence, args.beforeSequence),
          pageTypes === undefined
            ? undefined
            : inArray(events.type, [...pageTypes]),
        ),
      )
      .orderBy(order === "desc" ? desc(events.sequence) : events.sequence)
      .limit(pageLimit)
      .all();
  };
  const finish = (rows: StoredEventRow[]): StoredEventRow[] =>
    readCold
      ? includeColdEventRows(
          db,
          {
            afterSequence: args.afterSequence,
            beforeSequence: args.beforeSequence,
            limit: args.limit,
            order,
            threadId: args.threadId,
            types,
          },
          rows,
          coldRecordToStoredEventRow,
        )
      : rows;

  if (types === undefined || args.limit === undefined) {
    return finish(listPage(types));
  }

  const rowsByType = types.map((type) => listPage([type]));
  const offsets = rowsByType.map(() => 0);
  const merged: StoredEventRow[] = [];
  while (merged.length < pageLimit) {
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
  return finish(merged);
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
        OR json_extract(bb_text(candidate.data), '$.kind') = ${args.kind}
      )`;
      const requestedThreads = sql.join(
        threadIds.map((threadId) => sql`(${threadId})`),
        sql`, `,
      );
      return db
        .select(storedEventRowFields)
        .from(events)
        .where(
          sql`${events}.rowid IN (
        SELECT (
          SELECT candidate.rowid
          FROM ${events} AS candidate INDEXED BY events_thread_state_thread_sequence_idx
          WHERE candidate.thread_id = requested.column1
            AND candidate.type ${stateTypesPredicate}
            AND ${kindPredicate}
          ORDER BY candidate.sequence DESC
          LIMIT 1
        )
        FROM (VALUES ${requestedThreads}) AS requested
      )`,
        )
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
              sql<string>`json_extract(${storedText(events.data)}, '$.requestId')`,
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
  const requestIdsByThread = new Map<string, Set<string>>();
  for (const key of args.keys) {
    const requestIds =
      requestIdsByThread.get(key.threadId) ?? new Set<string>();
    requestIds.add(key.requestId);
    requestIdsByThread.set(key.threadId, requestIds);
  }
  const seen = new Set(rows.map((row) => row.id));
  for (const [threadId, requestIds] of requestIdsByThread) {
    for (const event of selectColdEventRecords(db, {
      threadId,
      types: ["client/turn/requested"],
      predicate: (event) => {
        const requestId = readColdEventJsonString(event.data, "requestId");
        return requestId !== null && requestIds.has(requestId);
      },
    })) {
      if (!seen.has(event.id)) {
        rows.push(coldRecordToStoredEventRow(event));
        seen.add(event.id);
      }
    }
  }
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
  const inline =
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
      .get() ?? null;
  const cold = selectColdEventRecords(db, {
    afterSequence: args.afterSequence,
    beforeSequence: inline?.sequence,
    limit: 1,
    order: "asc",
    threadId: args.threadId,
    types: [args.type],
  })[0];
  if (!cold) return inline;
  const coldRow = coldRecordToStoredEventRow(cold);
  if (!inline || coldRow.sequence < inline.sequence) return coldRow;
  return inline;
}

export function listStoredEventRowsByParentToolCallIds(
  db: DbConnection,
  args: ListStoredEventRowsByParentToolCallIdsArgs,
): StoredEventRow[] {
  const conditions = storedEventRowsByParentToolCallIdsConditions(args);
  if (conditions === null) {
    return [];
  }

  const rows = db
    .select(storedEventRowSqlFields(args.maxInlineOutputChars))
    .from(
      sql`${events} INDEXED BY events_parent_tool_call_thread_parent_sequence_idx`,
    )
    .where(and(...conditions, isNotNull(events.parentToolCallId)))
    .orderBy(events.sequence)
    .all();
  return includeColdEventRows(
    db,
    {
      beforeSequence: args.beforeSequence,
      excludedTypes: args.excludedTypes,
      maxInlineOutputChars: args.maxInlineOutputChars,
      parentToolCallIds: args.parentToolCallIds,
      sequenceStart: args.sequenceStart,
      threadId: args.threadId,
    },
    rows,
    coldRecordToStoredEventRow,
  );
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

  const rows = db
    .select(
      storedEventRowFieldsWithInlineOutputLimit(args.maxInlineOutputChars),
    )
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
  return includeColdEventRows(
    db,
    {
      itemIds,
      itemKinds: ["toolCall", "delegation"],
      maxInlineOutputChars: args.maxInlineOutputChars,
      threadId: args.threadId,
      types: ["item/started", "item/completed"],
    },
    rows,
    coldRecordToStoredEventRow,
  );
}

export function isTimelineCursorSequencePresent(
  db: DbConnection,
  args: TimelineCursorSequenceLookupArgs,
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
  if (row !== undefined) return true;
  return (
    selectColdEventRecords(db, {
      sequenceStart: args.sequence,
      threadId: args.threadId,
      throughSequence: args.sequence,
    }).length > 0
  );
}

export interface ScopedItemRef {
  itemId: string;
  scopeKind: ThreadEventScopeKind;
  turnId: string | null;
}

export function scopedItemRefKey(ref: ScopedItemRef): string {
  return `${ref.scopeKind}\u0000${ref.turnId ?? ""}\u0000${ref.itemId}`;
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

function coldScopedItemPredicate(items: readonly ScopedItemRef[]) {
  const keys = new Set(items.map(scopedItemRefKey));
  return (event: ColdEventRecord): boolean =>
    event.itemId !== null &&
    keys.has(
      scopedItemRefKey({
        itemId: event.itemId,
        scopeKind: event.scopeKind,
        turnId: event.turnId,
      }),
    );
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

  const rows = db
    .select({
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
  const spans = new Map(rows.map((row) => [scopedItemRefKey(row), row]));
  for (const event of selectColdEventRecords(db, {
    threadId: args.threadId,
    itemIds: items.map((item) => item.itemId),
    types: ITEM_EVENT_TYPES,
    predicate: coldScopedItemPredicate(items),
  })) {
    if (event.itemId === null) continue;
    const item = {
      itemId: event.itemId,
      scopeKind: event.scopeKind,
      turnId: event.turnId,
    };
    const key = scopedItemRefKey(item);
    const span = spans.get(key);
    if (span) {
      span.minSequence = Math.min(span.minSequence, event.sequence);
      span.maxSequence = Math.max(span.maxSequence, event.sequence);
    } else {
      spans.set(key, {
        ...item,
        minSequence: event.sequence,
        maxSequence: event.sequence,
      });
    }
  }
  return [...spans.values()];
}

export interface GetStoredItemLifecycleSequenceRangeArgs {
  itemId: string;
  threadId: string;
  turnId: string;
}

export function getStoredItemLifecycleSequenceRange(
  db: DbQueryConnection,
  args: GetStoredItemLifecycleSequenceRangeArgs,
): { first: number; last: number } | null {
  const [range] = db.all<{ first: number | null; last: number | null }>(sql`
    SELECT MIN(lifecycle.sequence) AS first, MAX(lifecycle.sequence) AS last
    FROM ${events} AS lifecycle
      INDEXED BY events_item_lifecycle_thread_item_sequence_idx
    WHERE lifecycle.thread_id = ${args.threadId}
      AND lifecycle.item_id = ${args.itemId}
      AND lifecycle.type IN (
        'item/started',
        'item/completed',
        'item/backgroundTask/completed'
      )
      AND lifecycle.turn_id = ${args.turnId}
  `);
  let first = range?.first ?? null;
  let last = range?.last ?? null;
  for (const event of selectColdEventRecords(db, {
    itemIds: [args.itemId],
    threadId: args.threadId,
    turnId: args.turnId,
    types: ["item/started", "item/completed", "item/backgroundTask/completed"],
  })) {
    first = first === null ? event.sequence : Math.min(first, event.sequence);
    last = last === null ? event.sequence : Math.max(last, event.sequence);
  }
  return first === null || last === null ? null : { first, last };
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

  const rows = db
    .select(
      storedEventRowFieldsWithInlineOutputLimit(args.maxInlineOutputChars),
    )
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
  return includeColdEventRows(
    db,
    {
      threadId: args.threadId,
      itemIds: items.map((item) => item.itemId),
      types: ["item/started", "item/completed"],
      predicate: coldScopedItemPredicate(items),
      maxInlineOutputChars: args.maxInlineOutputChars,
    },
    rows,
    coldRecordToStoredEventRow,
  );
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
      requestId: sql<
        string | null
      >`json_extract(${storedText(events.data)}, '$.requestId')`,
      sequence: events.sequence,
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
  const cold = selectColdEventRecords(db, {
    sequenceStart: args.seqStart,
    threadId: args.threadId,
    throughSequence: args.seqEnd,
    types: ["client/turn/requested"],
  }).flatMap((event) => {
    const requestId = readColdEventJsonString(event.data, "requestId");
    return requestId === null ? [] : [{ requestId, sequence: event.sequence }];
  });
  const seen = new Set(rows.map((row) => row.sequence));
  return [...rows, ...cold.filter((row) => !seen.has(row.sequence))]
    .sort((left, right) => left.sequence - right.sequence)
    .map((row) => clientTurnRequestIdSchema.parse(row.requestId));
}

export function getStoredTurnRequestEventForTurn(
  db: DbQueryConnection,
  args: GetStoredTurnRequestEventForTurnArgs,
): StoredTurnRequestEventRow | null {
  const inlineAccepted =
    db
      .select({
        clientRequestId: sql<
          string | null
        >`json_extract(${storedText(events.data)}, '$.clientRequestId')`,
        sequence: events.sequence,
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
  const coldAccepted = selectColdEventRecords(db, {
    threadId: args.threadId,
    turnId: args.turnId,
    types: ["turn/input/accepted"],
  }).at(-1);
  const clientRequestId =
    coldAccepted !== undefined &&
    (inlineAccepted === null || coldAccepted.sequence > inlineAccepted.sequence)
      ? readColdEventJsonString(coldAccepted.data, "clientRequestId")
      : (inlineAccepted?.clientRequestId ?? null);
  const requestIdResult = clientTurnRequestIdSchema.safeParse(clientRequestId);
  if (!requestIdResult.success) {
    return null;
  }

  const inlineRequest =
    db
      .select({
        data: storedText(events.data),
        sequence: events.sequence,
        threadId: events.threadId,
        type: events.type,
      })
      .from(events)
      .where(
        and(
          eq(events.threadId, args.threadId),
          eq(events.type, "client/turn/requested"),
          sql`json_extract(${storedText(events.data)}, '$.requestId') = ${requestIdResult.data}`,
        ),
      )
      .limit(1)
      .get() ?? null;
  if (inlineRequest) return inlineRequest;
  const coldRequest = selectColdEventRecords(db, {
    predicate: (event) =>
      readColdEventJsonString(event.data, "requestId") === requestIdResult.data,
    threadId: args.threadId,
    types: ["client/turn/requested"],
  })[0];
  if (!coldRequest) return null;
  return {
    data: coldRequest.data,
    sequence: coldRequest.sequence,
    threadId: coldRequest.threadId,
    type: coldRequest.type,
  };
}

export interface StoredThreadEventDataRow {
  data: string;
  sequence: number;
  turnId: string | null;
  type: ThreadEventType;
}

export function getLatestStoredThreadEventOfTypes(
  db: DbQueryConnection,
  args: {
    threadId: string;
    types: readonly ThreadEventType[];
    afterSequence: number;
  },
): StoredThreadEventDataRow | null {
  const row = listStoredEventRows(db, { ...args, order: "desc", limit: 1 })[0];
  return row
    ? {
        data: row.data,
        sequence: row.sequence,
        turnId: row.turnId,
        type: row.type,
      }
    : null;
}

export function getLatestStoredRateLimitsEvent(
  db: DbQueryConnection,
  args: { threadId: string },
): StoredThreadEventDataRow | null {
  return (
    db
      .select({
        data: storedText(events.data),
        sequence: events.sequence,
        turnId: events.turnId,
        type: events.type,
      })
      .from(events)
      .where(
        and(
          eq(events.threadId, args.threadId),
          eq(events.type, "provider/rateLimits/updated"),
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
      sql`json_extract(${storedText(events.data)}, '$.clientRequestId') = ${clientRequestId}`,
  );

  const rows = db
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
  const wanted = new Set(args.clientRequestIds);
  return includeColdEventRows(
    db,
    {
      afterSequence: args.afterSequence,
      predicate: (event) => {
        const requestId = readColdEventJsonString(
          event.data,
          "clientRequestId",
        );
        return requestId !== null && wanted.has(requestId);
      },
      threadId: args.threadId,
      types: ["turn/input/accepted"],
    },
    rows,
    coldRecordToStoredEventRow,
  );
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
      sql`json_extract(${storedText(events.data)}, '$.requestId') = ${clientRequestId}`,
  );

  const rows = db
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
  const wanted = new Set(args.clientRequestIds);
  return includeColdEventRows(
    db,
    {
      afterSequence: args.afterSequence,
      predicate: (event) => {
        const requestId = readColdEventJsonString(event.data, "requestId");
        return requestId !== null && wanted.has(requestId);
      },
      threadId: args.threadId,
      types: ["client/turn/rejected"],
    },
    rows,
    coldRecordToStoredEventRow,
  );
}

export function getLatestThreadInterruptedReason(
  db: DbQueryConnection,
  args: GetLatestThreadInterruptedReasonArgs,
): SystemThreadInterruptedReason | null {
  const row = db
    .select({
      reason: sql<string>`json_extract(${storedText(events.data)}, '$.reason')`,
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

  const rows = db
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
  return includeColdEventRows(
    db,
    {
      threadId: args.threadId,
      throughSequence: args.sequenceCutoff,
      turnIds: args.turnIds,
      types: ["turn/started"],
    },
    rows,
    coldRecordToStoredEventRow,
  );
}

export function listStoredTurnCompletedRowsByTurnIds(
  db: DbConnection,
  args: ListStoredTurnCompletedRowsByTurnIdsArgs,
): StoredEventRow[] {
  if (args.turnIds.length === 0) {
    return [];
  }

  const rows = db
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
  return includeColdEventRows(
    db,
    {
      threadId: args.threadId,
      turnIds: args.turnIds,
      types: ["turn/completed"],
    },
    rows,
    coldRecordToStoredEventRow,
  );
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
    "item/delegation/progress",
    "item/delegation/completed",
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
                args.beforeSequence === undefined
                  ? undefined
                  : lt(latest.sequence, args.beforeSequence),
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
  const progressType = "item/backgroundTask/progress" satisfies ThreadEventType;
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
        sql`json_extract(${storedText(events.data)}, '$.item.status') = 'pending'`,
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
          WHEN json_extract(bb_text(active_event.data), '$.item.taskType') =
            ${LOCAL_WORKFLOW_TASK_TYPE}
          THEN 1
          ELSE 0
        END
      ) AS activeWorkflowCount,
      SUM(
        CASE
          WHEN json_extract(bb_text(active_event.data), '$.item.taskType') IN (
            ${LOCAL_AGENT_TASK_TYPE},
            ${LOCAL_SUBAGENT_TASK_TYPE}
          )
          THEN 1
          ELSE 0
        END
      ) AS activeBackgroundAgentCount,
      SUM(
        CASE
          WHEN json_extract(bb_text(active_event.data), '$.item.taskType') =
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
      AND json_extract(bb_text(active_event.data), '$.item.status') = 'pending'
      AND json_extract(bb_text(active_event.data), '$.item.taskType') IN (
        ${LOCAL_WORKFLOW_TASK_TYPE},
        ${LOCAL_AGENT_TASK_TYPE},
        ${LOCAL_SUBAGENT_TASK_TYPE},
        ${LOCAL_BASH_TASK_TYPE}
      )
      AND COALESCE(
        json_extract(bb_text(active_event.data), '$.item.skipTranscript'),
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

type StoredTurnKeyEventType = Extract<
  ThreadEventType,
  "turn/completed" | "turn/started"
>;

function listStoredTurnKeysOfTypeChunk(
  db: DbQueryConnection,
  keys: readonly ThreadTurnKey[],
  type: StoredTurnKeyEventType,
): ThreadTurnKey[] {
  const turnConditions = keys.map((key) =>
    and(eq(events.threadId, key.threadId), eq(events.turnId, key.turnId)),
  );

  const rows = db
    .select({ threadId: events.threadId, turnId: events.turnId })
    .from(events)
    .where(and(eq(events.type, type), or(...turnConditions)))
    .all();

  return rows.flatMap((row) =>
    row.turnId === null ? [] : [{ threadId: row.threadId, turnId: row.turnId }],
  );
}

function listStoredTurnKeysOfType(
  db: DbQueryConnection,
  keys: readonly ThreadTurnKey[],
  type: StoredTurnKeyEventType,
): ThreadTurnKey[] {
  if (keys.length === 0) {
    return [];
  }

  const uniqueKeys = listUniqueThreadTurnKeys(keys);
  const rows: ThreadTurnKey[] = [];
  for (
    let offset = 0;
    offset < uniqueKeys.length;
    offset += STORED_EVENT_SEQUENCE_LOOKUP_CHUNK_SIZE
  ) {
    rows.push(
      ...listStoredTurnKeysOfTypeChunk(
        db,
        uniqueKeys.slice(
          offset,
          offset + STORED_EVENT_SEQUENCE_LOOKUP_CHUNK_SIZE,
        ),
        type,
      ),
    );
  }
  return rows;
}

export function listStoredTurnStartedKeys(
  db: DbQueryConnection,
  args: ListStoredTurnKeysArgs,
): ThreadTurnKey[] {
  return listStoredTurnKeysOfType(db, args.keys, "turn/started");
}

export function listStoredTurnCompletedKeys(
  db: DbQueryConnection,
  args: ListStoredTurnKeysArgs,
): ThreadTurnKey[] {
  return listStoredTurnKeysOfType(db, args.keys, "turn/completed");
}

export function hasStoredSpawnAgentToolCall(
  db: DbQueryConnection,
  threadId: string,
): boolean {
  const inline =
    db
      .select({ found: sql<number>`1` })
      .from(sql`${events} INDEXED BY events_delegating_item_lookup_idx`)
      .where(
        and(
          eq(events.threadId, threadId),
          sql`${events.itemKind} IN ('toolCall', 'delegation')`,
          eq(events.itemKind, "toolCall"),
          sql`json_extract(${storedText(events.data)}, '$.item.tool') = 'spawnAgent'`,
        ),
      )
      .limit(1)
      .get() !== undefined;
  return (
    inline ||
    selectColdEventRecords(db, {
      threadId,
      itemKinds: ["toolCall"],
      predicate: (row) =>
        readColdEventJsonString(row.data, "item.tool") === "spawnAgent",
      limit: 1,
    }).length > 0
  );
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
  args: { threadId: string },
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

function storedConversationOutlineStructuralData(
  data: SQL<string> = sql<string>`${storedText(events.data)}`,
  itemKind: SQL = sql`${events.itemKind}`,
): SQL<string> {
  return sql<string>`CASE ${itemKind}
      WHEN 'toolCall' THEN json_remove(
        ${data},
        '$.item.arguments',
        '$.item.result',
        '$.item.error',
        '$.item.durationMs',
        '$.item.truncation'
      )
      WHEN 'backgroundTask' THEN json_remove(
        ${data},
        '$.item.workflow',
        '$.item.usage',
        '$.item.summary',
        '$.item.error',
        '$.item.outputFile'
      )
      ELSE ${data}
    END`;
}

function storedConversationOutlineStructuralEventRowFields() {
  return {
    ...storedEventRowFields,
    data: storedConversationOutlineStructuralData(),
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
        sql`json_extract(${storedText(events.data)}, '$.operation') = ${THREAD_CONTEXT_CLEAR_OPERATION}`,
        sql`json_extract(${storedText(events.data)}, '$.status') = 'completed'`,
      ),
    );

  const inline = unionAll(
    lifecycle,
    completedConversation,
    structural,
    contextClear,
  )
    .all()
    .reduce((latest, row) => Math.max(latest, row.sequence ?? 0), 0);
  const cold = selectColdEventRecords(db, {
    threadId: args.threadId,
    types: ["item/completed"],
    itemKinds: [
      ...conversationOutlineItemKinds,
      ...conversationOutlineStructuralItemKinds,
    ],
    afterSequence: inline,
    order: "desc",
    limit: 1,
  })[0];
  return cold?.sequence ?? inline;
}

export function listStoredConversationOutlineEventRows(
  db: DbConnection,
  args: ListStoredConversationOutlineEventRowsArgs,
): StoredEventRow[] {
  return selectStoredConversationOutlineEventRows(db, args, false);
}

export function listStoredRootConversationOutlineEventRows(
  db: DbConnection,
  args: ListStoredConversationOutlineEventRowsArgs,
): StoredEventRow[] {
  return selectStoredConversationOutlineEventRows(db, args, true);
}

export function getStoredConversationOutlineProjectionState(
  db: DbConnection,
  args: ListStoredConversationOutlineEventRowsArgs & {
    classificationSequenceStart: number;
    summaryCompactionDeltaThreshold: number;
  },
) {
  const crossTurnState = db
    .select({ sequence: events.sequence })
    .from(events)
    .where(
      and(
        eq(events.threadId, args.threadId),
        gte(events.sequence, args.classificationSequenceStart),
        inArray(events.type, [
          "item/started",
          "item/completed",
          "item/backgroundTask/progress",
          "item/backgroundTask/completed",
          "item/delegation/progress",
          "item/delegation/completed",
        ]),
        inArray(events.itemKind, ["backgroundTask", "delegation"]),
      ),
    )
    .limit(1)
    .get();
  const acceptedNestedRoot = db
    .select({ found: sql<number>`1` })
    .from(sql`${events} INDEXED BY events_thread_type_sequence_idx`)
    .where(
      and(
        eq(events.threadId, args.threadId),
        gte(events.sequence, args.classificationSequenceStart),
        inArray(events.type, ["turn/input/accepted", "turn/started"]),
        sql`EXISTS (
          SELECT 1 FROM events AS nested_start
            INDEXED BY events_thread_turn_type_item_sequence_idx
          WHERE nested_start.thread_id = ${events.threadId}
            AND nested_start.turn_id = ${events.turnId}
            AND nested_start.type = 'turn/started'
            AND nested_start.parent_tool_call_id IS NOT NULL
        ) AND EXISTS (
          SELECT 1 FROM events AS accepted_root
          WHERE accepted_root.thread_id = ${events.threadId}
            AND accepted_root.turn_id = ${events.turnId}
            AND accepted_root.type = 'turn/input/accepted'
            AND EXISTS (
              SELECT 1 FROM events AS root_request
              WHERE root_request.thread_id = accepted_root.thread_id
                AND root_request.type = 'client/turn/requested'
                AND json_extract(bb_text(root_request.data), '$.requestId') = json_extract(bb_text(accepted_root.data), '$.clientRequestId')
                AND json_extract(bb_text(root_request.data), '$.target.kind') IN ('new-turn', 'thread-start')
            )
        )`,
      ),
    )
    .limit(1)
    .get();
  const compactionDelta = db
    .select({ sequence: events.sequence })
    .from(events)
    .where(
      and(
        eq(events.threadId, args.threadId),
        gte(events.sequence, args.sequenceStart),
        eq(events.type, "item/agentMessage/delta"),
      ),
    )
    .offset(args.summaryCompactionDeltaThreshold - 1)
    .limit(1)
    .get();
  return {
    includeNestedEvents:
      crossTurnState !== undefined || acceptedNestedRoot !== undefined,
    summaryCompactionEnabled: compactionDelta !== undefined,
  };
}

function selectStoredConversationOutlineEventRows(
  db: DbConnection,
  args: ListStoredConversationOutlineEventRowsArgs,
  rootOnly: boolean,
): StoredEventRow[] {
  const rootWhere = rootOnly
    ? and(
        isNull(events.parentToolCallId),
        sql`NOT EXISTS (
          SELECT 1 FROM events AS nested_turn_started
            INDEXED BY events_thread_turn_type_item_sequence_idx
          WHERE nested_turn_started.thread_id = ${events.threadId}
            AND nested_turn_started.turn_id = ${events.turnId}
            AND nested_turn_started.type = 'turn/started'
            AND nested_turn_started.parent_tool_call_id IS NOT NULL
        )`,
      )
    : undefined;
  const lifecycleRows = db
    .select(storedEventRowFields)
    .from(events)
    .where(
      and(
        rootWhere,
        storedConversationOutlineLifecycleWhere(
          args.threadId,
          args.sequenceStart,
        ),
      ),
    );
  const completedConversationRows = db
    .select(storedEventRowFields)
    .from(events)
    .where(
      and(
        rootWhere,
        storedConversationOutlineCompletedWhere(
          args.threadId,
          args.sequenceStart,
        ),
      ),
    );
  const structuralRows = db
    .select(storedConversationOutlineStructuralEventRowFields())
    .from(events)
    .where(
      and(
        rootWhere,
        storedConversationOutlineStructuralWhere(
          args.threadId,
          args.sequenceStart,
        ),
        or(
          eq(events.type, "item/started"),
          sql`json_extract(${storedText(events.data)}, '$.item.status') <> 'completed'`,
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
  const nestedTurns = rootOnly
    ? new Set(
        db
          .select({ turnId: events.turnId })
          .from(events)
          .where(
            and(
              eq(events.threadId, args.threadId),
              eq(events.type, "turn/started"),
              isNotNull(events.parentToolCallId),
            ),
          )
          .all()
          .map((row) => row.turnId),
      )
    : new Set<string | null>();
  const structuralData = new Map<string, string>();
  return includeColdEventRows(
    db,
    {
      threadId: args.threadId,
      sequenceStart: args.sequenceStart,
      types: ["item/completed"],
      itemKinds: [
        ...conversationOutlineItemKinds,
        ...conversationOutlineStructuralItemKinds,
      ],
      predicate: (event) => {
        if (
          rootOnly &&
          (event.parentToolCallId !== null || nestedTurns.has(event.turnId))
        )
          return false;
        if (event.itemKind !== "toolCall") return true;
        const row = db.get<{ data: string }>(sql`
          WITH source(data) AS (VALUES (${event.data}))
          SELECT ${storedConversationOutlineStructuralData(sql<string>`source.data`, sql`${event.itemKind}`)} AS data
          FROM source
          WHERE json_extract(bb_text(source.data), '$.item.status') <> 'completed'
            OR NOT EXISTS (
              SELECT 1 FROM events AS earlier_structural_start
                INDEXED BY events_item_lifecycle_thread_item_sequence_idx
              WHERE earlier_structural_start.thread_id = ${event.threadId}
                AND earlier_structural_start.item_id = ${event.itemId}
                AND earlier_structural_start.type IN ('item/started', 'item/completed', 'item/backgroundTask/completed')
                AND earlier_structural_start.type = 'item/started'
                AND earlier_structural_start.item_kind = ${event.itemKind}
                AND earlier_structural_start.sequence < ${event.sequence}
            )
        `);
        if (!row) return false;
        structuralData.set(event.id, row.data);
        return true;
      },
    },
    rows,
    (event) => ({
      ...coldRecordToStoredEventRow(event),
      data: structuralData.get(event.id) ?? event.data,
    }),
  );
}

export interface TimelineWindowHint {
  sequence: number;
}

export interface ListTimelineWindowHintsDescendingArgs {
  threadId: string;
  beforeSequence: number;
  limit: number;
  sequenceStart: number;
}

const visibleTimelineRequestInputSql = sql`EXISTS (
  SELECT 1
  FROM json_each(bb_text(events.data), '$.input') AS input_part
  WHERE COALESCE(json_extract(input_part.value, '$.visibility'), '') <> 'agent-only'
    AND (
      (
        json_extract(input_part.value, '$.type') = 'text'
        AND COALESCE(json_extract(input_part.value, '$.text'), '') <> ''
      )
      OR json_extract(input_part.value, '$.type')
        IN ('image', 'localImage', 'localFile')
    )
)`;

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

  if (!threadHasColdChunks(db, args.threadId)) {
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
  const inline = db
    .select({ sequence: events.sequence })
    .from(events)
    .where(and(...conditions))
    .orderBy(desc(events.sequence))
    .limit(args.eventBudget + 1)
    .all();
  const cold = selectColdEventRecords(db, {
    beforeSequence: args.beforeSequence,
    excludedTypes: args.excludedTypes,
    sequenceStart: args.sequenceStart,
    threadId: args.threadId,
    limit: args.eventBudget + 1,
    order: "desc",
  });
  const seen = new Set(inline.map((row) => row.sequence));
  const sequences = [
    ...inline,
    ...cold.filter((row) => !seen.has(row.sequence)),
  ].sort((left, right) => right.sequence - left.sequence);
  return sequences[args.eventBudget]?.sequence;
}

export function listTimelineInterruptionRows(
  db: DbConnection,
  args: { threadId: string; sequenceStart: number; maxSeq: number },
): StoredEventRow[] {
  const rows = db
    .select(storedEventRowSqlFields(null))
    .from(sql`${events} INDEXED BY events_thread_type_sequence_idx`)
    .where(
      and(
        eq(events.threadId, args.threadId),
        eq(events.type, "system/thread/interrupted"),
        gte(events.sequence, args.sequenceStart),
        lte(events.sequence, args.maxSeq),
      ),
    )
    .orderBy(events.sequence)
    .all();
  return includeColdEventRows(
    db,
    {
      sequenceStart: args.sequenceStart,
      threadId: args.threadId,
      throughSequence: args.maxSeq,
      types: ["system/thread/interrupted"],
    },
    rows,
    coldRecordToStoredEventRow,
  );
}

const TIMELINE_ORDERING_CONTEXT_EVENT_TYPES = [
  "client/turn/requested",
  "turn/input/accepted",
  "turn/started",
  "turn/completed",
] as const satisfies readonly ThreadEventType[];

function coldEventHasVisibleUserInput(data: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return false;
  }
  if (typeof parsed !== "object" || parsed === null || !("input" in parsed))
    return false;
  const input = parsed.input;
  if (!Array.isArray(input)) return false;
  return input.some((part) => {
    if (typeof part !== "object" || part === null) return false;
    const record = part as {
      text?: unknown;
      type?: unknown;
      visibility?: unknown;
    };
    if (record.visibility === "agent-only") return false;
    if (record.type === "text") {
      return typeof record.text === "string" && record.text !== "";
    }
    return (
      record.type === "image" ||
      record.type === "localImage" ||
      record.type === "localFile"
    );
  });
}

export function listTimelineOrderingContext(
  db: DbConnection,
  args: { threadId: string; sequenceStart: number; maxSeq: number },
) {
  const rows = db
    .select({
      sequence: sql<number>`${events.sequence}`,
      turnId: sql<string | null>`${events.turnId}`,
      type: sql<StoredEventRow["type"]>`${events.type}`,
      parentToolCallId: sql<string | null>`${events.parentToolCallId}`,
      requestId: sql<
        string | null
      >`json_extract(${storedText(events.data)}, '$.requestId')`,
      clientRequestId: sql<
        string | null
      >`json_extract(${storedText(events.data)}, '$.clientRequestId')`,
      expectedTurnId: sql<
        string | null
      >`json_extract(${storedText(events.data)}, '$.target.expectedTurnId')`,
      hasVisibleUserInput: sql<number>`CASE
        WHEN ${events.type} = 'client/turn/requested'
          AND json_extract(${storedText(events.data)}, '$.initiator') = 'user'
        THEN CASE WHEN ${visibleTimelineRequestInputSql} THEN 1 ELSE 0 END
        ELSE 0
      END`,
    })
    .from(sql`${events} INDEXED BY events_thread_type_sequence_idx`)
    .where(
      and(
        eq(events.threadId, args.threadId),
        gte(events.sequence, args.sequenceStart),
        lte(events.sequence, args.maxSeq),
        inArray(events.type, [...TIMELINE_ORDERING_CONTEXT_EVENT_TYPES]),
      ),
    )
    .orderBy(events.sequence)
    .all();
  if (!threadHasColdChunks(db, args.threadId)) return rows;
  const seen = new Set(rows.map((row) => row.sequence));
  const cold = selectColdEventRecords(db, {
    sequenceStart: args.sequenceStart,
    threadId: args.threadId,
    throughSequence: args.maxSeq,
    types: [...TIMELINE_ORDERING_CONTEXT_EVENT_TYPES],
  })
    .filter((event) => !seen.has(event.sequence))
    .map((event) => ({
      clientRequestId: readColdEventJsonString(event.data, "clientRequestId"),
      expectedTurnId: readColdEventJsonString(
        event.data,
        "target.expectedTurnId",
      ),
      hasVisibleUserInput:
        event.type === "client/turn/requested" &&
        readColdEventJsonString(event.data, "initiator") === "user" &&
        coldEventHasVisibleUserInput(event.data)
          ? 1
          : 0,
      parentToolCallId: event.parentToolCallId,
      requestId: readColdEventJsonString(event.data, "requestId"),
      sequence: event.sequence,
      turnId: event.turnId,
      type: event.type,
    }));
  return [...rows, ...cold].sort(
    (left, right) => left.sequence - right.sequence,
  );
}

export function getTimelineGroupingContextChangesInRange(
  db: DbConnection,
  args: { afterSequence: number; threadId: string; throughSequence: number },
): { ordering: boolean; parented: boolean } {
  const row = db
    .select({
      ordering: sql<number>`COALESCE(MAX(CASE WHEN ${inArray(events.type, [...TIMELINE_ORDERING_CONTEXT_EVENT_TYPES])} THEN 1 ELSE 0 END), 0)`,
      parented: sql<number>`COALESCE(MAX(CASE WHEN ${events.parentToolCallId} is not null THEN 1 ELSE 0 END), 0)`,
    })
    .from(sql`${events} INDEXED BY events_thread_sequence_idx`)
    .where(
      and(
        eq(events.threadId, args.threadId),
        gt(events.sequence, args.afterSequence),
        lte(events.sequence, args.throughSequence),
      ),
    )
    .get();
  let ordering = row?.ordering === 1;
  let parented = row?.parented === 1;
  if ((!ordering || !parented) && threadHasColdChunks(db, args.threadId)) {
    const cold = selectColdEventRecords(db, {
      afterSequence: args.afterSequence,
      threadId: args.threadId,
      throughSequence: args.throughSequence,
    });
    ordering =
      ordering ||
      cold.some((event) =>
        TIMELINE_ORDERING_CONTEXT_EVENT_TYPES.includes(
          event.type as (typeof TIMELINE_ORDERING_CONTEXT_EVENT_TYPES)[number],
        ),
      );
    parented =
      parented || cold.some((event) => event.parentToolCallId !== null);
  }
  return { ordering, parented };
}

export function listStoredEventRowsInSequenceRange(
  db: DbConnection,
  args: {
    afterSequence: number;
    limit: number;
    maxInlineOutputChars: InlineOutputCharLimit;
    threadId: string;
    throughSequence: number;
  },
): StoredEventRow[] {
  const hasCold = threadHasColdChunks(db, args.threadId);
  const rows = db
    .select(storedEventRowSqlFields(args.maxInlineOutputChars))
    .from(sql`${events} INDEXED BY events_thread_sequence_idx`)
    .where(
      and(
        eq(events.threadId, args.threadId),
        gt(events.sequence, args.afterSequence),
        lte(events.sequence, args.throughSequence),
      ),
    )
    .orderBy(events.sequence)
    .limit(args.limit)
    .all();
  if (!hasCold) return rows;
  return includeColdEventRows(
    db,
    {
      afterSequence: args.afterSequence,
      limit: args.limit,
      maxInlineOutputChars: args.maxInlineOutputChars,
      threadId: args.threadId,
      throughSequence: args.throughSequence,
    },
    rows,
    coldRecordToStoredEventRow,
  );
}

export function getFirstParentedTimelineBoundarySequence(
  db: DbConnection,
  args: { threadId: string; sequenceStart: number; maxSeq: number },
): number | null {
  if (threadHasColdChunks(db, args.threadId)) {
    const inline = db
      .select(storedEventRowFields)
      .from(events)
      .where(
        and(
          eq(events.threadId, args.threadId),
          lte(events.sequence, args.maxSeq),
          or(
            inArray(events.type, ["turn/started", "client/turn/requested"]),
            inArray(events.itemKind, ["toolCall", "delegation"]),
            isNotNull(events.parentToolCallId),
          ),
        ),
      )
      .all();
    const rows = includeColdEventRows(
      db,
      {
        threadId: args.threadId,
        throughSequence: args.maxSeq,
        predicate: (event) =>
          event.type === "turn/started" ||
          event.type === "client/turn/requested" ||
          event.itemKind === "toolCall" ||
          event.itemKind === "delegation" ||
          event.parentToolCallId !== null,
      },
      inline,
      coldRecordToStoredEventRow,
    );
    const rootTurns = new Set(
      rows
        .filter(
          (row) =>
            row.type === "turn/started" &&
            row.parentToolCallId === null &&
            row.turnId !== null,
        )
        .map((row) => row.turnId),
    );
    const childEnds = new Map<string, number>();
    for (const row of rows) {
      if (row.parentToolCallId !== null) {
        childEnds.set(
          row.parentToolCallId,
          Math.max(childEnds.get(row.parentToolCallId) ?? 0, row.sequence),
        );
      }
    }
    const spans = new Map<string, { start: number; end: number }>();
    for (const row of rows) {
      if (
        row.sequence < args.sequenceStart ||
        row.parentToolCallId !== null ||
        row.itemId === null ||
        row.turnId === null ||
        !rootTurns.has(row.turnId) ||
        (row.itemKind !== "toolCall" && row.itemKind !== "delegation")
      )
        continue;
      const end = childEnds.get(row.itemId);
      if (end === undefined) continue;
      const key = scopedItemRefKey({
        itemId: row.itemId,
        turnId: row.turnId,
        scopeKind: row.scopeKind,
      });
      const span = spans.get(key);
      spans.set(key, {
        start: Math.min(span?.start ?? row.sequence, row.sequence),
        end,
      });
    }
    for (const row of rows) {
      if (
        row.type !== "client/turn/requested" ||
        readColdEventJsonString(row.data, "initiator") !== "user" ||
        !coldEventHasVisibleUserInput(row.data)
      )
        continue;
      const kind =
        readColdEventJsonString(row.data, "target.kind") ?? "new-turn";
      if (
        kind !== "thread-start" &&
        kind !== "new-turn" &&
        !(
          (kind === "auto" || kind === "steer") &&
          readColdEventJsonString(row.data, "target.expectedTurnId") === null
        )
      )
        continue;
      if (
        [...spans.values()].some(
          (span) => row.sequence > span.start && row.sequence < span.end,
        )
      )
        return row.sequence;
    }
    return null;
  }
  const result = db.get<{ sequence: number | null }>(sql`
    WITH nested_history AS MATERIALIZED (
      SELECT 1
      FROM events INDEXED BY events_parent_tool_call_thread_parent_sequence_idx
      WHERE thread_id = ${args.threadId} AND parent_tool_call_id IS NOT NULL
      LIMIT 1
    ), parents AS MATERIALIZED (
      SELECT item_id, turn_id, min(sequence) AS start
      FROM nested_history CROSS JOIN events INDEXED BY events_delegating_item_lookup_idx
      WHERE thread_id = ${args.threadId}
        AND item_kind IN ('toolCall', 'delegation')
        AND parent_tool_call_id IS NULL
        AND sequence >= ${args.sequenceStart} AND sequence <= ${args.maxSeq}
        AND EXISTS (
          SELECT 1 FROM events AS root_start INDEXED BY events_thread_turn_type_item_sequence_idx
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
      AND ${events.threadId} = ${args.threadId}
      AND ${visibleTimelineRequestInputSql}
      AND (
        COALESCE(json_extract(${storedText(events.data)}, '$.target.kind'), 'new-turn')
          IN ('thread-start', 'new-turn')
        OR (
          json_extract(${storedText(events.data)}, '$.target.kind') IN ('auto', 'steer')
          AND json_extract(${storedText(events.data)}, '$.target.expectedTurnId') IS NULL
        )
      )
      AND json_extract(${storedText(events.data)}, '$.initiator') = 'user'
  `);
  return result?.sequence ?? null;
}

export function listTimelineWindowHintsDescending(
  db: DbConnection,
  args: ListTimelineWindowHintsDescendingArgs,
): TimelineWindowHint[] {
  if (!threadHasColdChunks(db, args.threadId)) {
    return db.all<TimelineWindowHint>(sql`
      SELECT sequence
      FROM events INDEXED BY events_thread_type_sequence_idx
      WHERE thread_id = ${args.threadId}
        AND type = 'client/turn/requested'
        AND sequence >= ${args.sequenceStart}
        AND sequence < ${args.beforeSequence}
      ORDER BY sequence DESC
      LIMIT ${args.limit}
    `);
  }
  const inline = db.all<TimelineWindowHint>(sql`
    SELECT sequence
    FROM events INDEXED BY events_thread_type_sequence_idx
    WHERE thread_id = ${args.threadId}
      AND type = 'client/turn/requested'
      AND sequence >= ${args.sequenceStart}
      AND sequence < ${args.beforeSequence}
    ORDER BY sequence DESC
    LIMIT ${args.limit}
  `);
  const cold = selectColdEventRecords(db, {
    beforeSequence: args.beforeSequence,
    sequenceStart: args.sequenceStart,
    threadId: args.threadId,
    types: ["client/turn/requested"],
    limit: args.limit,
    order: "desc",
  });
  const seen = new Set(inline.map((row) => row.sequence));
  return [...inline, ...cold.filter((row) => !seen.has(row.sequence))]
    .sort((left, right) => right.sequence - left.sequence)
    .slice(0, args.limit)
    .map((row) => ({ sequence: row.sequence }));
}

export interface TimelineCursorSequenceLookupArgs {
  threadId: string;
  sequence: number;
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
    ? storedText(events.data)
    : truncatedEventDataColumn(maxInlineOutputChars);
}

interface TimelineByteBudgetRow {
  created_at: number;
  data_bytes: number;
  sequence: number;
  turn_id: string | null;
}

function foldTimelineWindowByteBudget(
  rows: Iterable<TimelineByteBudgetRow>,
  maxDataBytes: number,
): StoredTimelineWindowByteBudgetFloor {
  let includedDataBytes = 0;
  let sequenceStart: number | null = null;
  let result: StoredTimelineWindowByteBudgetFloor | null = null;
  let oversizedEvent: Extract<
    StoredTimelineWindowByteBudgetFloor,
    { kind: "single-event-too-large" }
  > | null = null;

  for (const row of rows) {
    if (oversizedEvent !== null) {
      oversizedEvent.hasOlderRows = true;
      result = oversizedEvent;
      break;
    }
    if (includedDataBytes + row.data_bytes > maxDataBytes) {
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

  if (result !== null) return result;
  if (oversizedEvent !== null) return oversizedEvent;
  return { eventDataBytes: includedDataBytes, kind: "fits" };
}

function coldTimelineWindowQuery(args: ListStoredTimelineWindowEventRowsArgs) {
  return {
    beforeSequence: args.beforeSequence,
    excludedTypes: args.excludedTypes,
    maxInlineOutputChars: args.maxInlineOutputChars,
    sequenceStart: args.sequenceStart,
    threadId: args.threadId,
  };
}

export function findStoredTimelineWindowByteBudgetFloor(
  db: DbConnection,
  args: FindStoredTimelineWindowByteBudgetFloorArgs,
): StoredTimelineWindowByteBudgetFloor {
  const data = storedTimelineWindowDataColumn(args.maxInlineOutputChars);
  const query = db
    .select({
      createdAt: events.createdAt,
      dataBytes: sql<number>`length(CAST(${data} AS BLOB))`.as("data_bytes"),
      sequence: events.sequence,
      turnId: events.turnId,
    })
    .from(events)
    .where(and(...storedTimelineWindowConditions(args)))
    .orderBy(desc(events.sequence))
    .toSQL();
  const statement = db.$client.prepare<unknown[], TimelineByteBudgetRow>(
    query.sql,
  );
  if (!threadHasColdChunks(db, args.threadId)) {
    return foldTimelineWindowByteBudget(
      statement.iterate(...query.params),
      args.maxDataBytes,
    );
  }
  function* coldRows(): Generator<TimelineByteBudgetRow> {
    let beforeSequence = args.beforeSequence;
    while (true) {
      const row = selectColdEventRecords(db, {
        ...coldTimelineWindowQuery(args),
        beforeSequence,
        order: "desc",
        limit: 1,
      })[0];
      if (!row) return;
      yield {
        created_at: row.createdAt,
        data_bytes: Buffer.byteLength(row.data),
        sequence: row.sequence,
        turn_id: row.turnId,
      };
      beforeSequence = row.sequence;
    }
  }
  function* mergedRows(): Generator<TimelineByteBudgetRow> {
    const inline = statement.iterate(...query.params);
    const cold = coldRows();
    try {
      let left = inline.next();
      let right = cold.next();
      while (!left.done || !right.done) {
        if (
          !left.done &&
          (right.done || left.value.sequence >= right.value.sequence)
        ) {
          const row = left.value;
          yield row;
          left = inline.next();
          if (!right.done && right.value.sequence === row.sequence)
            right = cold.next();
        } else if (!right.done) {
          yield right.value;
          right = cold.next();
        }
      }
    } finally {
      inline.return?.();
      cold.return(undefined);
    }
  }
  return foldTimelineWindowByteBudget(mergedRows(), args.maxDataBytes);
}

export function listStoredTimelineTurnEventRows(
  db: DbConnection,
  args: ListStoredTimelineWindowEventRowsArgs & { turnIds: readonly string[] },
): StoredEventRow[] {
  if (args.turnIds.length === 0) return [];
  const rows = queryInSqliteVariableBatches({
    values: args.turnIds,
    variableCountPerValue: 1,
    dedupeKey: (turnId) => turnId,
    fixedVariableCount: 32,
    queryBatch: (turnIds) =>
      db
        .select(storedEventRowSqlFields(args.maxInlineOutputChars))
        .from(
          sql`${events} INDEXED BY events_thread_turn_type_item_sequence_idx`,
        )
        .where(
          and(
            ...storedTimelineWindowConditions(args),
            inArray(events.turnId, [...turnIds]),
          ),
        )
        .all(),
  }).sort((left, right) => left.sequence - right.sequence);
  if (!threadHasColdChunks(db, args.threadId)) return rows;
  return includeColdEventRows(
    db,
    { ...coldTimelineWindowQuery(args), turnIds: args.turnIds },
    rows,
    coldRecordToStoredEventRow,
  );
}

export function listTimelineRootWindowTurnIds(
  db: DbConnection,
  args: ListStoredTimelineWindowEventRowsArgs,
): string[] {
  if (!threadHasColdChunks(db, args.threadId)) {
    return db
      .selectDistinct({ turnId: sql<string>`${events.turnId}` })
      .from(events)
      .where(
        and(
          ...storedTimelineWindowConditions(args),
          isNotNull(events.turnId),
          isNull(events.parentToolCallId),
          sql`EXISTS (SELECT 1 FROM events AS root_start
      WHERE root_start.thread_id = ${events.threadId}
        AND root_start.turn_id = ${events.turnId}
        AND root_start.type = 'turn/started'
        AND root_start.parent_tool_call_id IS NULL)`,
        ),
      )
      .all()
      .map((row) => row.turnId);
  }
  const started = new Set<string>();
  for (const row of db
    .selectDistinct({ turnId: events.turnId })
    .from(events)
    .where(
      and(
        eq(events.threadId, args.threadId),
        eq(events.type, "turn/started"),
        isNull(events.parentToolCallId),
        isNotNull(events.turnId),
      ),
    )
    .all()) {
    if (row.turnId !== null) started.add(row.turnId);
  }
  for (const event of selectColdEventRecords(db, {
    predicate: (row) => row.parentToolCallId === null && row.turnId !== null,
    threadId: args.threadId,
    types: ["turn/started"],
  })) {
    if (event.turnId !== null) started.add(event.turnId);
  }
  const ids: string[] = [];
  const seen = new Set<string>();
  const add = (turnId: string | null) => {
    if (turnId === null || seen.has(turnId) || !started.has(turnId)) return;
    seen.add(turnId);
    ids.push(turnId);
  };
  for (const row of db
    .selectDistinct({ turnId: sql<string>`${events.turnId}` })
    .from(events)
    .where(
      and(
        ...storedTimelineWindowConditions(args),
        isNotNull(events.turnId),
        isNull(events.parentToolCallId),
      ),
    )
    .all()) {
    add(row.turnId);
  }
  for (const event of selectColdEventRecords(db, {
    ...coldTimelineWindowQuery(args),
    predicate: (row) => row.parentToolCallId === null && row.turnId !== null,
  })) {
    add(event.turnId);
  }
  return ids;
}

export function listStoredTimelineThreadWindowEventRows(
  db: DbConnection,
  args: ListStoredTimelineWindowEventRowsArgs,
): StoredEventRow[] {
  const rows = db
    .select(
      storedEventRowFieldsWithInlineOutputLimit(args.maxInlineOutputChars),
    )
    .from(events)
    .where(and(...storedTimelineWindowConditions(args), isNull(events.turnId)))
    .orderBy(events.sequence)
    .all();
  if (!threadHasColdChunks(db, args.threadId)) return rows;
  return includeColdEventRows(
    db,
    { ...coldTimelineWindowQuery(args), turnIdNull: true },
    rows,
    coldRecordToStoredEventRow,
  );
}

export function listStoredTimelineWindowEventRows(
  db: DbConnection,
  args: ListStoredTimelineWindowEventRowsArgs,
): StoredEventRow[] {
  const rows = db
    .select(
      storedEventRowFieldsWithInlineOutputLimit(args.maxInlineOutputChars),
    )
    .from(events)
    .where(and(...storedTimelineWindowConditions(args)))
    .orderBy(events.sequence)
    .all();
  if (!threadHasColdChunks(db, args.threadId)) return rows;
  return includeColdEventRows(
    db,
    coldTimelineWindowQuery(args),
    rows,
    coldRecordToStoredEventRow,
  );
}

function getLatestContextWindowBoundary(
  db: DbQueryConnection,
  args: { threadId: string; sequenceStart: number },
): StoredEventRow | undefined {
  return db
    .select(storedEventRowFields)
    .from(events)
    .where(
      and(
        eq(events.threadId, args.threadId),
        gte(events.sequence, args.sequenceStart),
        eq(events.type, "thread/contextWindowUsage/updated"),
        isNotNestedTurnUsageEvent,
        sql`(
          json_extract(${storedText(events.data)}, '$.contextWindowUsage.snapshot') IS NOT NULL
          OR json_extract(${storedText(events.data)}, '$.contextWindowUsage.usedTokens') IS NULL
          OR json_extract(${storedText(events.data)}, '$.contextWindowUsage.estimated') = 0
        )`,
      ),
    )
    .orderBy(desc(events.sequence))
    .limit(1)
    .get();
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
        sql`json_extract(${storedText(events.data)}, ${args.contextWindowJsonPath}) IS NOT NULL`,
      ),
    )
    .orderBy(desc(events.sequence))
    .limit(1)
    .get();

  const latestWindowBoundary = getLatestContextWindowBoundary(db, args);

  return [
    ...new Map(
      [latestWindowBoundary, latestContextRow, latestRow]
        .filter((row): row is StoredEventRow => row !== undefined)
        .map((row) => [row.id, row]),
    ).values(),
  ].sort((left, right) => left.sequence - right.sequence);
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

function coldEventHasThreadOutput(event: ColdEventRecord): boolean {
  if (event.type === "system/manager/user_message") {
    const text = readColdEventJsonString(event.data, "text");
    return text !== null && text !== "";
  }
  if (event.type === "item/completed" && event.itemKind === "agentMessage") {
    const text = readColdEventJsonString(event.data, "item.text");
    return text !== null && text !== "";
  }
  return false;
}

export function getLatestThreadOutputEventRow(
  db: DbConnection,
  args: GetLatestThreadOutputEventRowArgs,
): StoredEventRow | null {
  const inline =
    db
      .select(storedEventRowFields)
      .from(events)
      .where(
        sql`${events.threadId} = ${args.threadId} AND (
        (
          ${events.type} = 'system/manager/user_message'
          AND COALESCE(json_extract(${storedText(events.data)}, '$.text'), '') <> ''
        )
        OR (
          ${events.type} = 'item/completed'
          AND ${events.itemKind} = 'agentMessage'
          AND COALESCE(json_extract(${storedText(events.data)}, '$.item.text'), '') <> ''
        )
      )`,
      )
      .orderBy(desc(events.sequence))
      .limit(1)
      .get() ?? null;
  const cold = selectColdEventRecords(db, {
    predicate: coldEventHasThreadOutput,
    afterSequence: inline?.sequence,
    order: "desc",
    limit: 1,
    threadId: args.threadId,
    types: ["system/manager/user_message", "item/completed"],
  })[0];
  if (!cold) return inline;
  const coldRow = coldRecordToStoredEventRow(cold);
  if (!inline || coldRow.sequence > inline.sequence) return coldRow;
  return inline;
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
        and(
          eq(events.threadId, args.threadId),
          eq(events.type, "system/error"),
        ),
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
      json_extract(${storedText(events.data)}, '$.rawEvent.method') = 'sdk/message'
      AND json_extract(${storedText(events.data)}, '$.rawEvent.params.message.subtype')
        IN ('model_fallback', 'model_refusal_fallback')
      AND json_type(${storedText(events.data)}, '$.rawEvent.params.message.original_model') = 'text'
      AND length(json_extract(${storedText(events.data)}, '$.rawEvent.params.message.original_model')) > 0
      AND json_type(${storedText(events.data)}, '$.rawEvent.params.message.fallback_model') = 'text'
      AND length(json_extract(${storedText(events.data)}, '$.rawEvent.params.message.fallback_model')) > 0
    ), 0)
    OR CASE
      WHEN instr(${storedText(events.data)}, '"imageGeneration"') = 0 THEN 0
      WHEN json_valid(${storedText(events.data)}) THEN
        json_extract(${storedText(events.data)}, '$.rawType') = 'item/completed'
        AND json_extract(${storedText(events.data)}, '$.rawEvent.method') = 'item/completed'
        AND json_extract(${storedText(events.data)}, '$.rawEvent.params.item.type') = 'imageGeneration'
        AND (
          json_type(${storedText(events.data)}, '$.rawEvent.params.item.truncation.result') = 'object'
          OR json_type(${storedText(events.data)}, '$.rawEvent.params.item.result') IS NULL
          OR json_type(${storedText(events.data)}, '$.rawEvent.params.item.result') = 'null'
          OR (
            json_type(${storedText(events.data)}, '$.rawEvent.params.item.result') = 'text'
            AND length(json_extract(${storedText(events.data)}, '$.rawEvent.params.item.result'))
              <= ${COMPLETED_EVENT_OUTPUT_TRUNCATION_THRESHOLD_CHARS}
          )
        )
      ELSE 0
    END
  )
)`;

export function getLatestThreadSequence(
  db: DbQueryConnection,
  args: GetLatestThreadSequenceArgs,
): number {
  return getHighWaterMarks(db, [args.threadId])[args.threadId] ?? 0;
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
    sql`json_extract(${storedText(events.data)}, '$.operation') = ${THREAD_CONTEXT_CLEAR_OPERATION}`,
    sql`json_extract(${storedText(events.data)}, '$.status') = 'completed'`,
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
  | {
      kind: "invalid";
      providerThreadId: string | null;
      claimantThreadIds: string[];
    }
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

function readStoredProviderThreadClaim(
  db: DbQueryConnection,
  scope: StoredProviderThreadIdentityScope,
  providerThreadId: string,
): StoredProviderThreadClaim | undefined {
  const earliestHostCondition =
    scope.hostId === null
      ? sql`1`
      : sql`(earliest_environment.host_id IS NULL OR earliest_environment.host_id = ${scope.hostId})`;
  const claimantThreadIds = db
    .selectDistinct({ threadId: events.threadId })
    .from(events)
    .innerJoin(threads, eq(threads.id, events.threadId))
    .leftJoin(environments, eq(environments.id, threads.environmentId))
    .where(
      and(
        eq(events.type, "thread/identity"),
        eq(events.providerThreadId, providerThreadId),
        eq(threads.providerId, scope.providerId),
        scope.hostId === null
          ? undefined
          : or(
              isNull(environments.hostId),
              eq(environments.hostId, scope.hostId),
            ),
        sql`${events.createdAt} = (
          SELECT earliest.created_at
          FROM events AS earliest
          INNER JOIN threads AS earliest_thread
            ON earliest_thread.id = earliest.thread_id
          LEFT JOIN environments AS earliest_environment
            ON earliest_environment.id = earliest_thread.environment_id
          WHERE earliest.type = 'thread/identity'
            AND earliest.provider_thread_id = ${providerThreadId}
            AND earliest_thread.provider_id = ${scope.providerId}
            AND ${earliestHostCondition}
          ORDER BY earliest.created_at
          LIMIT 1
        )`,
      ),
    )
    .orderBy(events.threadId)
    .all()
    .map((row) => row.threadId);
  const [owner, ...others] = claimantThreadIds;
  if (owner === undefined) {
    return undefined;
  }
  return others.length === 0
    ? { kind: "owned", threadId: owner }
    : { kind: "tied", threadIds: claimantThreadIds };
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

function readNewestStoredProviderThreadIdentity(
  db: DbQueryConnection,
  args: {
    excludedProviderThreadIds: readonly string[];
    threadId: string;
  },
):
  | (StoredProviderThreadIdentityScope & { providerThreadId: string | null })
  | null {
  const row = db
    .select({
      hostId: environments.hostId,
      providerId: threads.providerId,
      providerThreadId: events.providerThreadId,
    })
    .from(events)
    .innerJoin(threads, eq(threads.id, events.threadId))
    .leftJoin(environments, eq(environments.id, threads.environmentId))
    .where(
      and(
        eq(events.threadId, args.threadId),
        eq(events.type, "thread/identity"),
        sql`${events.sequence} > COALESCE((
          SELECT MAX(context_clear.sequence)
          FROM events AS context_clear
          WHERE context_clear.thread_id = ${args.threadId}
            AND context_clear.type = 'system/operation'
            AND json_extract(bb_text(context_clear.data), '$.operation') = ${THREAD_CONTEXT_CLEAR_OPERATION}
            AND json_extract(bb_text(context_clear.data), '$.status') = 'completed'
        ), 0)`,
        args.excludedProviderThreadIds.length === 0
          ? undefined
          : or(
              isNull(events.providerThreadId),
              notInArray(events.providerThreadId, [
                ...args.excludedProviderThreadIds,
              ]),
            ),
      ),
    )
    .orderBy(desc(events.sequence))
    .limit(1)
    .get();
  if (row === undefined) {
    return null;
  }
  return {
    hostId: row.hostId,
    providerId: row.providerId,
    providerThreadId: row.providerThreadId,
    threadId: args.threadId,
  };
}

function resolveThreadProviderSession(
  db: DbQueryConnection,
  threadId: string,
): StoredProviderSession {
  const visited: string[] = [];
  let firstForeign: StoredProviderSession | null = null;
  for (;;) {
    const identity = readNewestStoredProviderThreadIdentity(db, {
      excludedProviderThreadIds: visited,
      threadId,
    });
    if (identity === null) {
      return firstForeign ?? { kind: "none" };
    }
    const { providerThreadId } = identity;
    if (providerThreadId === null || providerThreadId.length === 0) {
      return { kind: "invalid", providerThreadId, claimantThreadIds: [] };
    }
    visited.push(providerThreadId);
    const claim = readStoredProviderThreadClaim(db, identity, providerThreadId);
    switch (classifyClaim(claim, threadId)) {
      case "owned":
      case "unannounced":
        return { kind: "owned", providerThreadId };
      case "ambiguous":
        return {
          kind: "ambiguous",
          providerThreadId,
          claimantThreadIds: otherClaimants(claim, threadId),
        };
      case "foreign":
        firstForeign ??= {
          kind: "foreign",
          providerThreadId,
          claimantThreadIds: otherClaimants(claim, threadId),
        };
    }
  }
}

export function resolveStoredProviderSessions(
  db: DbQueryConnection,
  args: ResolveStoredProviderSessionsArgs,
): Map<string, StoredProviderSession> {
  return new Map(
    [...new Set(args.threadIds)].map(
      (threadId): [string, StoredProviderSession] => [
        threadId,
        resolveThreadProviderSession(db, threadId),
      ],
    ),
  );
}

export function getStoredProviderSession(
  db: DbQueryConnection,
  threadId: string,
): StoredProviderSession {
  return resolveThreadProviderSession(db, threadId);
}

export function getLastStoredProviderThreadId(
  db: DbQueryConnection,
  threadId: string,
): string | null {
  const session = getStoredProviderSession(db, threadId);
  return session.kind === "owned" ? session.providerThreadId : null;
}

export function wouldRemoveSharedProviderSessionClaim(
  db: DbQueryConnection,
  args: DeleteThreadEventSuffixArgs,
): boolean {
  const [scope] = listStoredProviderThreadIdentityScopes(db, [args.threadId]);
  if (scope === undefined) return false;
  const removedClaims = db
    .select({
      providerThreadId: events.providerThreadId,
      createdAt: sql<number>`min(${events.createdAt})`,
    })
    .from(events)
    .where(
      and(
        eq(events.threadId, args.threadId),
        eq(events.type, "thread/identity"),
        isNotNull(events.providerThreadId),
        gte(events.sequence, args.cutoffSequence),
        lte(events.sequence, args.oldMaxSequence),
      ),
    )
    .groupBy(events.providerThreadId)
    .all();
  for (const removed of removedClaims) {
    if (removed.providerThreadId === null) continue;
    const claim = readStoredProviderThreadClaim(
      db,
      scope,
      removed.providerThreadId,
    );
    if (classifyClaim(claim, args.threadId) === "foreign") continue;
    const retained = db
      .select({ id: events.id })
      .from(events)
      .where(
        and(
          eq(events.threadId, args.threadId),
          eq(events.type, "thread/identity"),
          eq(events.providerThreadId, removed.providerThreadId),
          lte(events.createdAt, removed.createdAt),
          or(
            lt(events.sequence, args.cutoffSequence),
            gt(events.sequence, args.oldMaxSequence),
          ),
        ),
      )
      .limit(1)
      .get();
    if (retained !== undefined) continue;
    const other = db
      .select({ id: events.id })
      .from(events)
      .innerJoin(threads, eq(threads.id, events.threadId))
      .leftJoin(environments, eq(environments.id, threads.environmentId))
      .where(
        and(
          eq(events.type, "thread/identity"),
          eq(events.providerThreadId, removed.providerThreadId),
          sql`${events.threadId} != ${args.threadId}`,
          eq(threads.providerId, scope.providerId),
          scope.hostId === null
            ? undefined
            : or(
                isNull(environments.hostId),
                eq(environments.hostId, scope.hostId),
              ),
        ),
      )
      .limit(1)
      .get();
    if (other !== undefined) return true;
  }
  return false;
}

export function classifyStoredProviderThreadClaim(
  db: DbQueryConnection,
  args: ClassifyStoredProviderThreadClaimArgs,
): StoredProviderThreadClaimClass {
  const [scope] = listStoredProviderThreadIdentityScopes(db, [args.threadId]);
  if (scope === undefined) {
    return "foreign";
  }
  return classifyClaim(
    readStoredProviderThreadClaim(db, scope, args.providerThreadId),
    args.threadId,
  );
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

export function listThreadIdsStoppedSinceLastTurnStart(
  db: DbConnection,
  args: ListThreadIdsStoppedSinceLastTurnStartArgs,
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
        sql`json_extract(${storedText(events.data)}, '$.reason') = 'manual-stop'`,
        sql`${events.sequence} = (
          SELECT MAX(latest.sequence)
          FROM events AS latest
          WHERE latest.thread_id = ${events.threadId}
            AND latest.type IN ('turn/started', 'system/thread/interrupted')
        )`,
      ),
    )
    .all()
    .map((row) => row.threadId);
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
        sql`json_extract(${storedText(events.data)}, '$.reason') = 'host-daemon-restarted'`,
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
        data: storedText(events.data),
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
            AND json_type(${storedText(events.data)}, '$.input') IS NOT NULL
          )
        )`,
      )
      .orderBy(sql`${events.sequence} DESC`)
      .limit(1)
      .get() ?? null
  );
}

function pruneUsageSnapshots(
  db: DbQueryConnection,
  args: PruningWindow & {
    eventType:
      | "thread/contextWindowUsage/updated"
      | "thread/tokenUsage/updated";
    threadId: string;
  },
): number {
  const keepers = args.usageKeepers;
  const boundarySequence =
    args.eventType === "thread/contextWindowUsage/updated"
      ? (getLatestContextWindowBoundary(db, {
          threadId: args.threadId,
          sequenceStart: 0,
        })?.sequence ?? 0)
      : 0;
  const sequences = [
    ...new Set([keepers.latestRootSequence, keepers.latestContextSequence]),
  ].filter((sequence) => sequence > 0);
  for (const sequence of sequences) {
    if (
      !db.get(
        sql`SELECT 1 FROM events WHERE thread_id = ${args.threadId} AND type = ${args.eventType} AND sequence = ${sequence}`,
      )
    )
      return 0;
  }
  return db.run(sql`DELETE FROM events
    WHERE id IN (${pruningCandidates(args)}) AND thread_id = ${args.threadId}
      AND type = ${args.eventType}
      AND ${isBeforeLatestThreadEvent(args.threadId)}
      AND sequence NOT IN (${keepers.latestRootSequence}, ${keepers.latestContextSequence}, ${boundarySequence})`)
    .changes;
}

export function pruneContextWindowUsageEventsInTransaction(
  db: DbQueryConnection,
  args: PruneContextWindowUsageEventsArgs,
): number {
  return pruneUsageSnapshots(db, {
    ...args,
    eventType: "thread/contextWindowUsage/updated",
  });
}

export function pruneTokenUsageEventsInTransaction(
  db: DbQueryConnection,
  args: PruneTokenUsageEventsArgs,
): number {
  return pruneUsageSnapshots(db, {
    ...args,
    eventType: "thread/tokenUsage/updated",
  });
}

export function listOpenBackgroundTaskItemRowsForHost(
  db: DbQueryConnection,
  args: ListOpenBackgroundTaskItemRowsForHostArgs,
): OpenBackgroundTaskItemRow[] {
  const startedType = "item/started" satisfies ThreadEventType;
  const progressType = "item/backgroundTask/progress" satisfies ThreadEventType;
  const completedType =
    "item/backgroundTask/completed" satisfies ThreadEventType;
  const settled = alias(events, "settled_background_task");

  const rows = db
    .select({
      data: storedText(events.data),
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
  const progressType = "item/backgroundTask/progress" satisfies ThreadEventType;
  const completedType =
    "item/backgroundTask/completed" satisfies ThreadEventType;
  const settled = alias(events, "settled_thread_background_task");

  const rows = db
    .select({
      data: storedText(events.data),
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
