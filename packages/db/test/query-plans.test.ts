import { describe, expect, it } from "vitest";
import { threadScope, turnScope } from "@bb/domain";
import {
  createConnection,
  type DbConnection,
  type SlowDbQueryLogger,
  type SlowDbQueryLogFields,
} from "../src/connection.js";
import { migrate } from "../src/migrate.js";
import { noopNotifier } from "../src/notifier.js";
import {
  createPendingInteraction,
  getPendingInteractionByProviderRequest,
} from "../src/data/pending-interactions.js";
import {
  insertEvents,
  pruneContextWindowUsageEventsBeforeSequence,
  pruneResolvedItemDeltas,
} from "../src/data/events.js";
import {
  COMPLETED_EVENT_OUTPUT_TRUNCATION_THRESHOLD_CHARS,
  pruneClosedSessions,
  truncateCompletedEventItemOutputs,
} from "../src/data/sweeps.js";
import { getDatabaseMaintenanceActivity } from "../src/data/maintenance.js";
import { openSession } from "../src/data/sessions.js";
import { upsertHost } from "../src/data/hosts.js";
import { createProject } from "../src/data/projects.js";
import { createThread } from "../src/data/threads.js";

type SqliteParameter = string | number | bigint | Buffer | null;
type LoggedSqlPredicate = (fields: SlowDbQueryLogFields) => boolean;
type CloseSessionAtParameters = ["closed", number, number, string];

interface CloseSessionAtArgs {
  closedAt: number;
  db: DbConnection;
  sessionId: string;
}

interface LoggedDebug {
  fields: SlowDbQueryLogFields;
  message: string;
}

interface QueryPlanRow {
  detail: string;
  id: number;
  notused: number;
  parent: number;
}

interface IndexNameRow {
  name: string;
}

interface IdentifiedRow {
  id: string;
}

interface TestDb {
  db: DbConnection;
  host: IdentifiedRow;
  logger: CapturingSlowQueryLogger;
  thread: IdentifiedRow;
}

interface FindOnlyDebugLogArgs {
  logger: CapturingSlowQueryLogger;
  predicate: LoggedSqlPredicate;
}

interface QueryPlanDetailsArgs {
  db: DbConnection;
  params: readonly SqliteParameter[];
  sql: string;
}

interface AssertEmittedQueryPlanUsesIndexArgs {
  db: DbConnection;
  debugLog: LoggedDebug;
  indexName: string;
  params: readonly SqliteParameter[];
}

class CapturingSlowQueryLogger implements SlowDbQueryLogger {
  readonly debugLogs: LoggedDebug[] = [];

  debug: SlowDbQueryLogger["debug"] = (fields, message) => {
    this.debugLogs.push({ fields, message });
  };

  clear(): void {
    this.debugLogs.length = 0;
  }
}

function setup(): TestDb {
  const logger = new CapturingSlowQueryLogger();
  const db = createConnection(":memory:", {
    slowQueryLogger: logger,
    slowQueryThresholdMs: 0,
  });
  migrate(db);
  const host = upsertHost(db, noopNotifier, {
    name: "query-plan-host",
    type: "persistent",
  });
  const { project } = createProject(db, noopNotifier, {
    name: "query-plan-project",
    source: { type: "local_path", hostId: host.id, path: "/tmp/query-plan" },
  });
  const thread = createThread(db, noopNotifier, {
    projectId: project.id,
    providerId: "codex",
  });
  logger.clear();
  return { db, host, logger, thread };
}

function closeSessionAt(args: CloseSessionAtArgs): void {
  args.db.$client
    .prepare<CloseSessionAtParameters>(
      `
        UPDATE host_daemon_sessions
        SET status = ?, closed_at = ?, updated_at = ?
        WHERE id = ?
      `,
    )
    .run("closed", args.closedAt, args.closedAt, args.sessionId);
}

function findOnlyDebugLog(args: FindOnlyDebugLogArgs): LoggedDebug {
  const matches = args.logger.debugLogs.filter((debugLog) =>
    args.predicate(debugLog.fields),
  );
  expect(matches.map((debugLog) => debugLog.fields.sql)).toHaveLength(1);
  const debugLog = matches[0];
  if (!debugLog) {
    throw new Error("Expected one matching SQL debug log");
  }
  return debugLog;
}

function queryPlanDetails(args: QueryPlanDetailsArgs): string {
  const planRows = args.db.$client
    .prepare<SqliteParameter[], QueryPlanRow>(`EXPLAIN QUERY PLAN ${args.sql}`)
    .all(...args.params);
  return planRows.map((row) => row.detail).join("\n");
}

function assertEmittedQueryPlanUsesIndex(
  args: AssertEmittedQueryPlanUsesIndexArgs,
): void {
  expect(args.debugLog.fields.bindingArgumentCount).toBe(args.params.length);
  const details = queryPlanDetails({
    db: args.db,
    params: args.params,
    sql: args.debugLog.fields.sql,
  });
  expect(
    details.includes(`USING INDEX ${args.indexName}`) ||
      details.includes(`USING COVERING INDEX ${args.indexName}`),
  ).toBe(true);
}

describe("slow query index plans", () => {
  it("uses the closed-session prune index for emitted delete SQL", () => {
    const { db, host, logger } = setup();
    const now = Date.now();
    const staleSession = openSession(db, noopNotifier, {
      hostId: host.id,
      instanceId: "closed-prune-query-plan",
      hostName: "query-plan-host",
      hostType: "persistent",
      dataDir: "/tmp/query-plan-host-data",
      protocolVersion: 1,
      heartbeatIntervalMs: 10_000,
      leaseTimeoutMs: 30_000,
    });
    const closedBefore = now - 5_000;
    closeSessionAt({
      closedAt: now - 10_000,
      db,
      sessionId: staleSession.id,
    });
    logger.clear();

    pruneClosedSessions(db, { closedBefore, limit: 100 });

    const debugLog = findOnlyDebugLog({
      logger,
      predicate: (fields) =>
        fields.operation === "run" &&
        fields.sql.startsWith("DELETE FROM host_daemon_sessions"),
    });
    assertEmittedQueryPlanUsesIndex({
      db,
      debugLog,
      indexName: "host_daemon_sessions_closed_prune_idx",
      params: ["closed", closedBefore, 100],
    });
    db.$client.close();
  });

  it("uses the provider request index for pending interaction lookups", () => {
    const { db, logger, thread } = setup();
    createPendingInteraction(db, {
      threadId: thread.id,
      turnId: "turn-provider-request-query-plan",
      providerId: "codex",
      providerThreadId: "provider-thread-query-plan",
      providerRequestId: "request-query-plan",
      payload: "{}",
    });
    logger.clear();

    expect(
      getPendingInteractionByProviderRequest(db, {
        providerId: "codex",
        providerThreadId: "provider-thread-query-plan",
        providerRequestId: "request-query-plan",
      }),
    ).toMatchObject({
      threadId: thread.id,
    });

    const debugLog = findOnlyDebugLog({
      logger,
      predicate: (fields) =>
        fields.operation === "get" &&
        fields.sql.includes('from "pending_interactions"') &&
        fields.sql.includes('"provider_request_id" = ?'),
    });
    assertEmittedQueryPlanUsesIndex({
      db,
      debugLog,
      indexName: "pending_interactions_provider_request_idx",
      params: ["codex", "provider-thread-query-plan", "request-query-plan"],
    });

    db.$client.close();
  });

  it("uses the thread/type/sequence index for emitted context-window prune SQL", () => {
    const { db, logger, thread } = setup();
    const sequenceCutoff = 3;
    insertEvents(db, noopNotifier, [
      {
        data: JSON.stringify({
          contextWindowUsage: {
            modelContextWindow: 200_000,
            usedTokens: 10,
          },
        }),
        itemId: null,
        itemKind: null,
        scope: turnScope("turn_query_plan"),
        sequence: 1,
        threadId: thread.id,
        type: "thread/contextWindowUsage/updated",
      },
      {
        data: JSON.stringify({
          contextWindowUsage: {
            modelContextWindow: null,
            usedTokens: 20,
          },
        }),
        itemId: null,
        itemKind: null,
        scope: turnScope("turn_query_plan"),
        sequence: 2,
        threadId: thread.id,
        type: "thread/contextWindowUsage/updated",
      },
      {
        data: "{}",
        itemId: null,
        itemKind: null,
        scope: threadScope(),
        sequence: 3,
        threadId: thread.id,
        type: "system/error",
      },
    ]);
    logger.clear();

    pruneContextWindowUsageEventsBeforeSequence(db, {
      sequenceCutoff,
      threadId: thread.id,
    });

    const debugLog = findOnlyDebugLog({
      logger,
      predicate: (fields) =>
        fields.operation === "run" &&
        fields.sql.startsWith("DELETE FROM events") &&
        fields.sql.includes("latest_context"),
    });
    assertEmittedQueryPlanUsesIndex({
      db,
      debugLog,
      indexName: "events_thread_type_sequence_idx",
      params: [
        thread.id,
        "thread/contextWindowUsage/updated",
        sequenceCutoff,
        thread.id,
        "thread/contextWindowUsage/updated",
        thread.id,
        "thread/contextWindowUsage/updated",
        "$.contextWindowUsage.modelContextWindow",
      ],
    });

    db.$client.close();
  });

  it("uses the active-thread maintenance index for emitted idle checks", () => {
    const { db, logger } = setup();
    logger.clear();

    getDatabaseMaintenanceActivity(db);

    const debugLog = findOnlyDebugLog({
      logger,
      predicate: (fields) =>
        fields.operation === "get" &&
        fields.sql.includes('from "threads"') &&
        fields.sql.includes('"threads"."deleted_at" is null'),
    });
    assertEmittedQueryPlanUsesIndex({
      db,
      debugLog,
      indexName: "threads_active_maintenance_idx",
      params: ["active", "provisioning"],
    });

    db.$client.close();
  });

  it("uses rowid lookups for thread search FTS segment hydration", () => {
    const { db } = setup();

    const details = queryPlanDetails({
      db,
      params: ['"queryplanneedle"*', 20],
      sql: `
        SELECT s.id
        FROM thread_search_segments_fts
        JOIN thread_search_segments AS s
          ON s.rowid = thread_search_segments_fts.rowid
        WHERE thread_search_segments_fts MATCH ?
        LIMIT ?
      `,
    });

    expect(details).toContain(
      "SCAN thread_search_segments_fts VIRTUAL TABLE INDEX",
    );
    expect(details).toContain("SEARCH s USING INTEGER PRIMARY KEY (rowid=?)");
    expect(details).not.toContain("SCAN s");

    db.$client.close();
  });

  it("uses the completed item truncation partial index for emitted cursor scans", () => {
    const { db, logger, thread } = setup();
    const createdBefore = Date.now();
    const commandOutput =
      "command-head-" +
      "a".repeat(COMPLETED_EVENT_OUTPUT_TRUNCATION_THRESHOLD_CHARS) +
      "-command-tail";
    insertEvents(db, noopNotifier, [
      {
        createdAt: createdBefore - 10_000,
        data: JSON.stringify({
          item: {
            aggregatedOutput: commandOutput,
            id: "cmd-truncation-query-plan",
            type: "commandExecution",
          },
        }),
        itemId: "cmd-truncation-query-plan",
        itemKind: "commandExecution",
        scope: turnScope("turn_truncation_query_plan"),
        sequence: 1,
        threadId: thread.id,
        type: "item/completed",
      },
    ]);
    logger.clear();

    truncateCompletedEventItemOutputs(db, {
      createdBefore,
      limit: 10,
      truncatedAt: createdBefore,
    });

    const scanDebugLogs = logger.debugLogs.filter(
      (debugLog) =>
        debugLog.fields.operation === "all" &&
        debugLog.fields.sql.startsWith("SELECT id, created_at FROM events") &&
        debugLog.fields.sql.includes("ORDER BY created_at, id") &&
        debugLog.fields.bindingArgumentCount === 6,
    );
    expect(scanDebugLogs.map((debugLog) => debugLog.fields.sql)).toHaveLength(
      4,
    );
    const debugLog = scanDebugLogs[0];
    if (!debugLog) {
      throw new Error("Expected completed item truncation scan SQL debug log");
    }
    assertEmittedQueryPlanUsesIndex({
      db,
      debugLog,
      indexName: "events_completed_item_truncation_idx",
      params: ["item/completed", "commandExecution", createdBefore, 0, "", 10],
    });

    db.$client.close();
  });

  it("uses the consolidated turn/item event index for resolved delta pruning", () => {
    const { db, thread } = setup();
    const turnId = "turn_resolved_delta_query_plan";
    const itemId = "call_resolved_delta_query_plan";
    insertEvents(db, noopNotifier, [
      {
        data: JSON.stringify({ output: "first", parentToolCallId: "parent" }),
        itemId,
        itemKind: null,
        scope: turnScope(turnId),
        sequence: 1,
        threadId: thread.id,
        type: "item/commandExecution/outputDelta",
      },
      {
        data: JSON.stringify({ output: "second", parentToolCallId: "parent" }),
        itemId,
        itemKind: null,
        scope: turnScope(turnId),
        sequence: 2,
        threadId: thread.id,
        type: "item/commandExecution/outputDelta",
      },
      {
        data: JSON.stringify({
          item: {
            aggregatedOutput: "firstsecond",
            id: itemId,
            parentToolCallId: "parent",
            type: "commandExecution",
          },
        }),
        itemId,
        itemKind: "commandExecution",
        scope: turnScope(turnId),
        sequence: 3,
        threadId: thread.id,
        type: "item/completed",
      },
    ]);

    expect(pruneResolvedItemDeltas(db, { threadId: thread.id })).toBe(1);

    const completedLookupPlan = queryPlanDetails({
      db,
      params: [thread.id, turnId, itemId],
      sql: `
        SELECT 1
        FROM events AS completed
        WHERE completed.thread_id = ?
          AND completed.turn_id = ?
          AND completed.type = 'item/completed'
          AND completed.item_kind = 'commandExecution'
          AND completed.item_id = ?
          AND json_type(completed.data, '$.item.aggregatedOutput') IS NOT NULL
        LIMIT 1
      `,
    });
    const earlierDeltaLookupPlan = queryPlanDetails({
      db,
      params: [thread.id, turnId, itemId, 3],
      sql: `
        SELECT 1
        FROM events AS earlier_delta
        WHERE earlier_delta.thread_id = ?
          AND earlier_delta.turn_id = ?
          AND earlier_delta.type = 'item/commandExecution/outputDelta'
          AND earlier_delta.item_id = ?
          AND earlier_delta.sequence < ?
        LIMIT 1
      `,
    });

    expect(completedLookupPlan).toContain(
      "events_thread_turn_type_item_sequence_idx",
    );
    expect(earlierDeltaLookupPlan).toContain(
      "events_thread_turn_type_item_sequence_idx",
    );
    expect(completedLookupPlan).not.toContain(
      "events_thread_turn_type_item_kind_item_idx",
    );

    db.$client.close();
  });

  it("drops redundant events indexes after creating their consolidated replacement", () => {
    const { db } = setup();
    const indexRows = db.$client
      .prepare<
        [],
        IndexNameRow
      >("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'events'")
      .all();
    const indexNames = indexRows.map((row) => row.name);

    expect(indexNames).toContain("events_thread_turn_type_item_sequence_idx");
    expect(indexNames).toContain("events_completed_item_truncation_idx");
    expect(indexNames).not.toContain("events_thread_turn_sequence_idx");
    expect(indexNames).not.toContain("events_thread_item_id_sequence_idx");
    expect(indexNames).not.toContain(
      "events_thread_turn_type_item_kind_item_idx",
    );

    db.$client.close();
  });
});
