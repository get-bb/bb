import type { DbConnection } from "../connection.js";

export type LegacyAutomationTable = "automations" | "automation_runs";

interface SqliteCountRow {
  count: number;
}

export function legacyAutomationTableExists(
  db: DbConnection,
  tableName: LegacyAutomationTable,
): boolean {
  const row = db.$client
    .prepare(
      `SELECT COUNT(*) AS count
       FROM sqlite_master
       WHERE type = 'table' AND name = ?`,
    )
    .get(tableName) as SqliteCountRow | undefined;
  return (row?.count ?? 0) > 0;
}

export function countLegacyAutomations(db: DbConnection): number {
  const row = db.$client
    .prepare(`SELECT COUNT(*) AS count FROM automations`)
    .get() as SqliteCountRow | undefined;
  return row?.count ?? 0;
}

export function listLegacyAutomationRows(db: DbConnection): unknown[] {
  return db.$client
    .prepare(
      `SELECT
         id,
         project_id AS projectId,
         target_thread_id AS targetThreadId,
         name,
         enabled,
         trigger_type AS triggerType,
         trigger_config AS triggerConfig,
         run_mode AS runMode,
         execution,
         environment,
         auto_archive AS autoArchive,
         origin,
         created_by_thread_id AS createdByThreadId,
         next_run_at AS nextRunAt,
         last_run_at AS lastRunAt,
         run_count AS runCount,
         last_run_status AS lastRunStatus,
         last_run_thread_id AS lastRunThreadId,
         last_error AS lastError,
         created_at AS createdAt,
         updated_at AS updatedAt
       FROM automations
       ORDER BY created_at, id`,
    )
    .all();
}

export function listLegacyAutomationRunRows(db: DbConnection): unknown[] {
  return db.$client
    .prepare(
      `SELECT
         id,
         automation_id AS automationId,
         run_mode AS runMode,
         thread_id AS threadId,
         status,
         trigger,
         skip_reason AS skipReason,
         error,
         output,
         exit_code AS exitCode,
         idempotency_key AS idempotencyKey,
         scheduled_for AS scheduledFor,
         started_at AS startedAt,
         finished_at AS finishedAt
       FROM automation_runs
       ORDER BY started_at, id`,
    )
    .all();
}
