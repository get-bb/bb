// Durable spool for workflow run events (plan §3/§8 PROGRESS): every
// WorkflowRunEvent the run manager emits is persisted to a daemon-local SQLite
// spool with a minted producerEventId + protocol-independent payload hash,
// then posted in order to POST /internal/session/workflow-run-events. The
// server re-acks duplicates by producerEventId, so at-least-once delivery is
// safe; the spool survives server downtime and daemon restarts.
//
// A deliberate sibling of event-buffer.ts (the thread-event spool) rather than
// a parameterized shared core: the thread spool carries thread-only invariants
// (threadEventSchema, legacy protocol-versioned-hash migration) that must not
// bend to fit run events, and this is only the second spool. Same discipline
// throughout: WAL + synchronous=FULL, fail-closed strict schema validation,
// ordered whole-spool flush, settle-deletes-accepted-AND-rejected (rejection
// is settlement — logged and discarded), bounded no-progress/non-retryable
// fail-closed retry.

import Database from "better-sqlite3";
import {
  canonicalizeWorkflowRunEventPayload,
  createDebouncedCallbackScheduler,
  hostDaemonProducerEventIdSchema,
  workflowRunEventSchema,
  WORKFLOW_RUN_JOURNAL_EVENT_TYPES,
  WORKFLOW_RUN_TERMINAL_EVENT_TYPES,
  type HostDaemonProducerEventId,
  type WorkflowRunEvent,
  type WorkflowRunEventType,
} from "@bb/domain";
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { createHostDaemonProducerEventId } from "./producer-event-id.js";
import { ServerResponseError } from "./server-client.js";
import type { HostDaemonLogger } from "./logger.js";
import { runtimeErrorLogFields } from "./error-utils.js";
import type { HostDaemonWorkflowRunEventEnvelope } from "@bb/host-daemon-contract";
import type {
  WorkflowRunEventBatchResponse,
  WorkflowRunEventRejected,
} from "./workflow-server-wire.js";

const DEFAULT_DEBOUNCE_MS = 100;
const DEFAULT_MAX_WAIT_MS = 500;
const WORKFLOW_EVENT_SPOOL_SCHEMA_VERSION = 1;
const WORKFLOW_EVENT_SPOOL_FILE_NAME = "workflow-event-spool.sqlite";
const MAX_CONSECUTIVE_NO_PROGRESS_FLUSHES = 3;
const MAX_NON_RETRYABLE_POST_FAILURES = 3;

interface WorkflowEventSpoolRow {
  localOrder: number;
  producerEventId: string;
  runId: string;
  eventType: string;
  payloadJson: string;
  payloadHash: string;
  createdAt: string;
  lastPostAttemptAt: string | null;
  postAttemptCount: number;
}

interface TableInfoRow {
  cid: number;
  dflt_value: string | null;
  name: string;
  notnull: number;
  pk: number;
  type: string;
}

interface TableNameRow {
  name: string;
}

interface ExpectedColumn {
  dfltValue: string | null;
  name: string;
  notnull: number;
  pk: number;
  type: string;
}

interface SnapshotAttemptResult {
  events: BufferedWorkflowRunEvent[];
  producerEventIds: HostDaemonProducerEventId[];
}

interface SettlePostedBatchArgs {
  acceptedEvents: WorkflowRunEventBatchResponse["acceptedEvents"];
  rejectedEvents: WorkflowRunEventBatchResponse["rejectedEvents"];
  sentProducerEventIds: readonly HostDaemonProducerEventId[];
}

interface SettlePostedBatchResult {
  deletedCount: number;
  rejectedEvents: WorkflowRunEventRejected[];
}

interface CreateBufferedEventRecordArgs {
  input: BufferedWorkflowRunEventInput;
  producerEventId: HostDaemonProducerEventId;
  createdAt: string;
}

interface BufferedWorkflowRunEventLogSummary {
  eventType: string;
  localOrder: number;
  payloadHash: string;
  producerEventId: HostDaemonProducerEventId;
  runId: string;
}

interface RejectedWorkflowRunEventLogSummary {
  producerEventId: HostDaemonProducerEventId;
  reason: string;
  runId: string;
}

export interface BufferedWorkflowRunEventInput {
  runId: string;
  event: WorkflowRunEvent;
}

export interface BufferedWorkflowRunEvent extends HostDaemonWorkflowRunEventEnvelope {
  createdAt: string;
  localOrder: number;
  payloadHash: string;
}

export interface WorkflowRunEventPostResult {
  acceptedEvents: WorkflowRunEventBatchResponse["acceptedEvents"];
  rejectedEvents: WorkflowRunEventBatchResponse["rejectedEvents"];
}

export interface CreateWorkflowEventBufferOptions {
  dataDir: string;
  logger: Pick<HostDaemonLogger, "error" | "warn">;
  postEvents: (
    events: HostDaemonWorkflowRunEventEnvelope[],
  ) => Promise<WorkflowRunEventPostResult>;
  createProducerEventId?: () => HostDaemonProducerEventId;
  debounceMs?: number;
  maxWaitMs?: number;
  now?: () => number;
}

export interface WorkflowEventBuffer {
  /**
   * Spooled events are retained durably until the server acknowledges them.
   * Intentionally uncapped: during outages host-local storage pressure beats
   * silently dropping run events (a lost terminal event strands the run).
   */
  push(event: BufferedWorkflowRunEventInput): BufferedWorkflowRunEvent;
  flush(): Promise<void>;
  depth(): number;
  snapshot(): BufferedWorkflowRunEvent[];
  dispose(): Promise<void>;
}

export class WorkflowEventBufferDisposedError extends Error {
  constructor() {
    super("Cannot push to disposed workflow event buffer");
    this.name = "WorkflowEventBufferDisposedError";
  }
}

const expectedOutboundWorkflowRunEventColumns: ExpectedColumn[] = [
  { dfltValue: null, name: "localOrder", notnull: 0, pk: 1, type: "INTEGER" },
  { dfltValue: null, name: "producerEventId", notnull: 1, pk: 0, type: "TEXT" },
  { dfltValue: null, name: "runId", notnull: 1, pk: 0, type: "TEXT" },
  { dfltValue: null, name: "eventType", notnull: 1, pk: 0, type: "TEXT" },
  { dfltValue: null, name: "payloadJson", notnull: 1, pk: 0, type: "TEXT" },
  { dfltValue: null, name: "payloadHash", notnull: 1, pk: 0, type: "TEXT" },
  { dfltValue: null, name: "createdAt", notnull: 1, pk: 0, type: "TEXT" },
  {
    dfltValue: null,
    name: "lastPostAttemptAt",
    notnull: 0,
    pk: 0,
    type: "TEXT",
  },
  {
    dfltValue: "0",
    name: "postAttemptCount",
    notnull: 1,
    pk: 0,
    type: "INTEGER",
  },
];

const IMMEDIATE_FLUSH_WORKFLOW_RUN_EVENT_TYPES: ReadonlySet<WorkflowRunEventType> =
  new Set([
    ...WORKFLOW_RUN_TERMINAL_EVENT_TYPES,
    ...WORKFLOW_RUN_JOURNAL_EVENT_TYPES,
  ]);

/**
 * Terminal events settle the run server-side and journal entries
 * (agent/completed, agent/failed) must reach the authoritative resume journal
 * promptly; coarse progress and logs ride the debounce.
 */
export function shouldFlushWorkflowRunEventImmediately(
  event: WorkflowRunEvent,
): boolean {
  return IMMEDIATE_FLUSH_WORKFLOW_RUN_EVENT_TYPES.has(event.type);
}

function formatTimestamp(value: number): string {
  return new Date(value).toISOString();
}

function hashPayload(args: { event: WorkflowRunEvent; runId: string }): string {
  return createHash("sha256")
    .update(canonicalizeWorkflowRunEventPayload(args))
    .digest("hex");
}

function toPostEvent(
  event: BufferedWorkflowRunEvent,
): HostDaemonWorkflowRunEventEnvelope {
  return {
    producerEventId: event.producerEventId,
    runId: event.runId,
    event: event.event,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readUserVersion(db: Database.Database): number {
  const rows = db.pragma("user_version");
  if (!Array.isArray(rows)) {
    throw new Error(
      "Workflow event spool schema version returned unexpected rows",
    );
  }
  const row = rows[0];
  if (
    !isRecord(row) ||
    !("user_version" in row) ||
    typeof row.user_version !== "number"
  ) {
    throw new Error("Workflow event spool schema version could not be read");
  }
  return row.user_version;
}

function runIntegrityCheck(db: Database.Database): void {
  const rows = db.pragma("integrity_check");
  if (!Array.isArray(rows) || rows.length !== 1) {
    throw new Error(
      "Workflow event spool integrity check returned unexpected rows",
    );
  }
  const row = rows[0];
  if (
    !isRecord(row) ||
    !("integrity_check" in row) ||
    typeof row.integrity_check !== "string"
  ) {
    throw new Error(
      "Workflow event spool integrity check returned unexpected shape",
    );
  }
  if (row.integrity_check !== "ok") {
    throw new Error(
      `Workflow event spool integrity check failed: ${row.integrity_check}`,
    );
  }
}

function createSchema(db: Database.Database): void {
  const createSchemaTransaction = db.transaction(() => {
    db.exec(`
      CREATE TABLE outbound_workflow_run_events (
        localOrder INTEGER PRIMARY KEY AUTOINCREMENT,
        producerEventId TEXT NOT NULL UNIQUE,
        runId TEXT NOT NULL,
        eventType TEXT NOT NULL,
        payloadJson TEXT NOT NULL,
        payloadHash TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        lastPostAttemptAt TEXT,
        postAttemptCount INTEGER NOT NULL DEFAULT 0
      );
    `);
    db.pragma(`user_version = ${WORKFLOW_EVENT_SPOOL_SCHEMA_VERSION}`);
  });
  createSchemaTransaction();
}

function outboundWorkflowRunEventsTableExists(db: Database.Database): boolean {
  const row = db
    .prepare<
      [],
      TableNameRow
    >("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'outbound_workflow_run_events'")
    .get();
  return row !== undefined;
}

function validateSchema(db: Database.Database): void {
  const schemaVersion = readUserVersion(db);
  if (schemaVersion !== WORKFLOW_EVENT_SPOOL_SCHEMA_VERSION) {
    throw new Error(
      `Workflow event spool schema version mismatch: expected ${WORKFLOW_EVENT_SPOOL_SCHEMA_VERSION}, got ${schemaVersion}`,
    );
  }

  const rows = db
    .prepare<
      [],
      TableInfoRow
    >("PRAGMA table_info(outbound_workflow_run_events)")
    .all();
  if (rows.length !== expectedOutboundWorkflowRunEventColumns.length) {
    throw new Error(
      "Workflow event spool schema mismatch: outbound_workflow_run_events columns differ",
    );
  }

  for (const [
    index,
    expected,
  ] of expectedOutboundWorkflowRunEventColumns.entries()) {
    const actual = rows[index];
    if (
      actual === undefined ||
      actual.name !== expected.name ||
      actual.type.toUpperCase() !== expected.type ||
      actual.notnull !== expected.notnull ||
      actual.pk !== expected.pk ||
      actual.dflt_value !== expected.dfltValue
    ) {
      throw new Error(
        `Workflow event spool schema mismatch at column ${expected.name}`,
      );
    }
  }
}

function openSpoolDatabase(dataDir: string): Database.Database {
  mkdirSync(dataDir, { recursive: true });
  const db = new Database(join(dataDir, WORKFLOW_EVENT_SPOOL_FILE_NAME));
  try {
    db.pragma("journal_mode = WAL");
    db.pragma("synchronous = FULL");
    runIntegrityCheck(db);

    const schemaVersion = readUserVersion(db);
    if (schemaVersion === 0) {
      if (outboundWorkflowRunEventsTableExists(db)) {
        throw new Error(
          "Workflow event spool schema mismatch: outbound_workflow_run_events exists with schema version 0",
        );
      }
      createSchema(db);
    }
    validateSchema(db);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

function parseBufferedEvent(
  row: WorkflowEventSpoolRow,
): BufferedWorkflowRunEvent {
  const producerEventId = hostDaemonProducerEventIdSchema.parse(
    row.producerEventId,
  );
  const event = workflowRunEventSchema.parse(JSON.parse(row.payloadJson));
  if (event.type !== row.eventType) {
    throw new Error(
      "Workflow event spool payload type does not match eventType",
    );
  }
  if (event.type === "run/started" && event.runId !== row.runId) {
    throw new Error(
      "Workflow event spool payload runId does not match row runId",
    );
  }
  const payloadHash = hashPayload({ event, runId: row.runId });
  if (row.payloadHash !== payloadHash) {
    throw new Error("Workflow event spool payload hash mismatch");
  }
  return {
    createdAt: row.createdAt,
    event,
    localOrder: row.localOrder,
    payloadHash,
    producerEventId,
    runId: row.runId,
  };
}

function summarizeBufferedEvents(
  events: readonly BufferedWorkflowRunEvent[],
): BufferedWorkflowRunEventLogSummary[] {
  return events.map((event) => ({
    eventType: event.event.type,
    localOrder: event.localOrder,
    payloadHash: event.payloadHash,
    producerEventId: event.producerEventId,
    runId: event.runId,
  }));
}

function summarizeRejectedEvents(
  events: readonly WorkflowRunEventRejected[],
): RejectedWorkflowRunEventLogSummary[] {
  return events.map((event) => ({
    producerEventId: event.producerEventId,
    reason: event.reason,
    runId: event.runId,
  }));
}

function isNonRetryableServerPostError(
  error: unknown,
): error is ServerResponseError {
  return error instanceof ServerResponseError && !error.retryable;
}

export function createWorkflowEventBuffer(
  options: CreateWorkflowEventBufferOptions,
): WorkflowEventBuffer {
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const maxWaitMs = options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
  const now = options.now ?? Date.now;
  const createProducerEventId =
    options.createProducerEventId ?? createHostDaemonProducerEventId;
  const db = openSpoolDatabase(options.dataDir);

  const selectPendingRows = db.prepare<[], WorkflowEventSpoolRow>(`
    SELECT
      localOrder,
      producerEventId,
      runId,
      eventType,
      payloadJson,
      payloadHash,
      createdAt,
      lastPostAttemptAt,
      postAttemptCount
    FROM outbound_workflow_run_events
    ORDER BY localOrder ASC
  `);
  const countPendingRows = db.prepare<[], { count: number }>(`
    SELECT COUNT(*) AS count
    FROM outbound_workflow_run_events
  `);
  const insertEvent = db.prepare<
    [string, string, string, string, string, string],
    never
  >(`
    INSERT INTO outbound_workflow_run_events (
      producerEventId,
      runId,
      eventType,
      payloadJson,
      payloadHash,
      createdAt
    )
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const selectEventByProducerId = db.prepare<
    [HostDaemonProducerEventId],
    WorkflowEventSpoolRow
  >(`
    SELECT
      localOrder,
      producerEventId,
      runId,
      eventType,
      payloadJson,
      payloadHash,
      createdAt,
      lastPostAttemptAt,
      postAttemptCount
    FROM outbound_workflow_run_events
    WHERE producerEventId = ?
  `);
  const updatePostAttempt = db.prepare<[string, number], never>(`
    UPDATE outbound_workflow_run_events
    SET
      lastPostAttemptAt = ?,
      postAttemptCount = postAttemptCount + 1
    WHERE localOrder = ?
  `);
  const deleteByProducerEventId = db.prepare<
    [HostDaemonProducerEventId],
    never
  >(`
    DELETE FROM outbound_workflow_run_events
    WHERE producerEventId = ?
  `);

  let disposed = false;
  let flushPromise: Promise<boolean> | null = null;
  let disposePromise: Promise<void> | null = null;
  let consecutiveNoProgressFlushes = 0;
  let nonRetryablePostFailureCount = 0;
  const flushScheduler = createDebouncedCallbackScheduler({
    debounceMs,
    maxWaitMs,
    onFlush: () => {
      void flush().catch((error) => {
        options.logger.error(
          { err: error },
          "workflow event flush failed closed after protocol inconsistency",
        );
      });
    },
  });

  const insertEventTransaction = db.transaction(
    (args: CreateBufferedEventRecordArgs): BufferedWorkflowRunEvent => {
      const event = workflowRunEventSchema.parse(args.input.event);
      if (event.type === "run/started" && event.runId !== args.input.runId) {
        throw new Error(
          "Buffered workflow run event runId does not match payload runId",
        );
      }
      insertEvent.run(
        args.producerEventId,
        args.input.runId,
        event.type,
        JSON.stringify(event),
        hashPayload({ event, runId: args.input.runId }),
        args.createdAt,
      );
      const row = selectEventByProducerId.get(args.producerEventId);
      if (row === undefined) {
        throw new Error(
          "Workflow event spool insert did not create a readable row",
        );
      }
      return parseBufferedEvent(row);
    },
  );

  const snapshotPostAttemptTransaction = db.transaction(
    (): SnapshotAttemptResult => {
      // Validate every stored row before posting. One corrupt row fails the
      // whole spool so the daemon cannot silently drop or reorder run events.
      const rows = selectPendingRows.all();
      const attemptedAt = formatTimestamp(now());
      const events: BufferedWorkflowRunEvent[] = [];
      const producerEventIds: HostDaemonProducerEventId[] = [];
      for (const row of rows) {
        const event = parseBufferedEvent(row);
        events.push(event);
        producerEventIds.push(event.producerEventId);
      }
      for (const row of rows) {
        updatePostAttempt.run(attemptedAt, row.localOrder);
      }
      return { events, producerEventIds };
    },
  );

  const snapshotTransaction = db.transaction((): BufferedWorkflowRunEvent[] => {
    // Read-only, transactional, fail-closed on local corruption.
    return selectPendingRows.all().map(parseBufferedEvent);
  });

  const settlePostedBatchTransaction = db.transaction(
    (args: SettlePostedBatchArgs): SettlePostedBatchResult => {
      const sentProducerEventIds = new Set(args.sentProducerEventIds);
      const settledProducerEventIds = new Set<HostDaemonProducerEventId>();
      for (const event of args.acceptedEvents) {
        if (!sentProducerEventIds.has(event.producerEventId)) {
          throw new Error(
            `Workflow event spool received acknowledgement for unsent producerEventId: ${event.producerEventId}`,
          );
        }
        settledProducerEventIds.add(event.producerEventId);
      }

      for (const event of args.rejectedEvents) {
        if (!sentProducerEventIds.has(event.producerEventId)) {
          throw new Error(
            `Workflow event spool received rejection for unsent producerEventId: ${event.producerEventId}`,
          );
        }
        if (settledProducerEventIds.has(event.producerEventId)) {
          throw new Error(
            `Workflow event spool received conflicting settlement for producerEventId: ${event.producerEventId}`,
          );
        }
        settledProducerEventIds.add(event.producerEventId);
      }

      let deletedCount = 0;
      for (const producerEventId of settledProducerEventIds) {
        deletedCount += deleteByProducerEventId.run(producerEventId).changes;
      }
      if (deletedCount !== settledProducerEventIds.size) {
        throw new Error(
          "Workflow event spool settlement referenced an already-deleted event",
        );
      }
      return {
        deletedCount,
        rejectedEvents: [...args.rejectedEvents],
      };
    },
  );

  function scheduleFlush(): void {
    if (disposed) {
      return;
    }
    flushScheduler.schedule();
  }

  function flushImmediately(): void {
    if (disposed) {
      return;
    }
    flushScheduler.flush();
  }

  function push(input: BufferedWorkflowRunEventInput): BufferedWorkflowRunEvent {
    if (disposed) {
      throw new WorkflowEventBufferDisposedError();
    }
    const event = insertEventTransaction({
      createdAt: formatTimestamp(now()),
      input,
      producerEventId: createProducerEventId(),
    });

    if (shouldFlushWorkflowRunEventImmediately(input.event)) {
      flushImmediately();
    } else {
      scheduleFlush();
    }

    return event;
  }

  async function flush(): Promise<void> {
    while (!disposed) {
      if (flushPromise) {
        const madeProgress = await flushPromise;
        if (!madeProgress) {
          return;
        }
        continue;
      }

      const snapshot = snapshotPostAttemptTransaction();
      if (snapshot.events.length === 0) {
        return;
      }

      flushPromise = (async (): Promise<boolean> => {
        try {
          let postResult: WorkflowRunEventPostResult;
          try {
            postResult = await options.postEvents(
              snapshot.events.map(toPostEvent),
            );
          } catch (error) {
            if (isNonRetryableServerPostError(error)) {
              nonRetryablePostFailureCount++;
              const logContext = {
                bufferDepth: snapshot.events.length,
                code: error.code,
                events: summarizeBufferedEvents(snapshot.events),
                nonRetryableFailureCount: nonRetryablePostFailureCount,
                nonRetryableFailureLimit: MAX_NON_RETRYABLE_POST_FAILURES,
                retryable: error.retryable,
                status: error.status,
                ...runtimeErrorLogFields(error),
              };
              if (
                nonRetryablePostFailureCount >= MAX_NON_RETRYABLE_POST_FAILURES
              ) {
                options.logger.error(
                  { ...logContext, err: error },
                  "workflow event flush received non-retryable server response; failing closed",
                );
                throw new Error(
                  `Workflow event spool flush received non-retryable server response after ${nonRetryablePostFailureCount} attempts`,
                );
              }
              options.logger.warn(
                logContext,
                "workflow event flush received non-retryable server response",
              );
              scheduleFlush();
              return false;
            }
            options.logger.warn(
              {
                bufferDepth: snapshot.events.length,
                ...runtimeErrorLogFields(error),
              },
              "workflow event flush failed, will retry",
            );
            scheduleFlush();
            return false;
          }
          const settledResult = settlePostedBatchTransaction({
            acceptedEvents: postResult.acceptedEvents,
            rejectedEvents: postResult.rejectedEvents,
            sentProducerEventIds: snapshot.producerEventIds,
          });
          if (settledResult.rejectedEvents.length > 0) {
            options.logger.warn(
              {
                rejectedEvents: summarizeRejectedEvents(
                  settledResult.rejectedEvents,
                ),
              },
              "workflow event flush discarded rejected events",
            );
          }
          if (settledResult.deletedCount === 0) {
            consecutiveNoProgressFlushes++;
            const logContext = {
              bufferDepth: snapshot.events.length,
              events: summarizeBufferedEvents(snapshot.events),
              noProgressCount: consecutiveNoProgressFlushes,
              noProgressLimit: MAX_CONSECUTIVE_NO_PROGRESS_FLUSHES,
            };
            if (
              consecutiveNoProgressFlushes >=
              MAX_CONSECUTIVE_NO_PROGRESS_FLUSHES
            ) {
              const noProgressError = new Error(
                `Workflow event spool flush made no progress after ${consecutiveNoProgressFlushes} attempts`,
              );
              options.logger.error(
                { ...logContext, err: noProgressError },
                "workflow event flush made no progress; failing closed",
              );
              throw noProgressError;
            }
            options.logger.warn(
              logContext,
              "workflow event flush made no progress",
            );
            scheduleFlush();
            return false;
          }
          consecutiveNoProgressFlushes = 0;
          nonRetryablePostFailureCount = 0;
          return depth() > 0;
        } finally {
          flushPromise = null;
        }
      })();

      const madeProgress = await flushPromise;
      if (!madeProgress) {
        return;
      }
    }
  }

  function depth(): number {
    return countPendingRows.get()?.count ?? 0;
  }

  function snapshot(): BufferedWorkflowRunEvent[] {
    return snapshotTransaction();
  }

  async function dispose(): Promise<void> {
    if (disposePromise) {
      return disposePromise;
    }

    disposed = true;
    flushScheduler.dispose();
    disposePromise = (async () => {
      try {
        if (flushPromise) {
          await flushPromise;
        }
      } finally {
        db.close();
      }
    })();
    return disposePromise;
  }

  return {
    push,
    flush,
    depth,
    snapshot,
    dispose,
  };
}
