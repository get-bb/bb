import type Database from "better-sqlite3";
import { createAutomationId, createAutomationRunId } from "./ids.js";
import {
  automationExecutionSchema,
  automationResponseSchema,
  automationRunResponseSchema,
  automationTriggerSchema,
  type AutomationExecution,
  type AutomationOrigin,
  type AutomationResponse,
  type AutomationRunMode,
  type AutomationRunResponse,
  type AutomationRunStatus,
  type AutomationRunTrigger,
  type AutomationTrigger,
} from "./rpc-types.js";

export type Db = Database.Database;

export interface AutomationRow {
  id: string;
  projectId: string;
  targetThreadId: string | null;
  name: string;
  enabled: boolean;
  triggerType: "schedule" | "once";
  triggerConfig: string;
  runMode: AutomationRunMode;
  execution: string;
  origin: AutomationOrigin;
  createdByThreadId: string | null;
  nextRunAt: number | null;
  lastRunAt: number | null;
  runCount: number;
  lastRunStatus: AutomationRunStatus | null;
  lastRunThreadId: string | null;
  lastError: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface AutomationRunRow {
  id: string;
  automationId: string;
  runMode: AutomationRunMode;
  threadId: string | null;
  status: AutomationRunStatus;
  trigger: AutomationRunTrigger;
  skipReason: string | null;
  error: string | null;
  output: string | null;
  exitCode: number | null;
  idempotencyKey: string | null;
  scheduledFor: number;
  startedAt: number;
  finishedAt: number | null;
}

interface RawAutomationRow
  extends Omit<AutomationRow, "enabled"> {
  enabled: 0 | 1;
}

function boolToInt(value: boolean): 0 | 1 {
  return value ? 1 : 0;
}

function automationRow(raw: RawAutomationRow): AutomationRow {
  return {
    ...raw,
    enabled: raw.enabled === 1,
  };
}

function requiredAutomationRow(value: unknown): AutomationRow {
  return automationRow(value as RawAutomationRow);
}

function optionalAutomationRow(value: unknown): AutomationRow | null {
  return value === undefined ? null : requiredAutomationRow(value);
}

function requiredRunRow(value: unknown): AutomationRunRow {
  return value as AutomationRunRow;
}

function optionalRunRow(value: unknown): AutomationRunRow | null {
  return value === undefined ? null : requiredRunRow(value);
}

export const migrations = [
  `CREATE TABLE IF NOT EXISTS automations (
     id TEXT PRIMARY KEY,
     project_id TEXT NOT NULL,
     target_thread_id TEXT,
     name TEXT NOT NULL,
     enabled INTEGER NOT NULL DEFAULT 1,
     trigger_type TEXT NOT NULL,
     trigger_config TEXT NOT NULL,
     run_mode TEXT NOT NULL,
     execution TEXT NOT NULL,
     -- Legacy compatibility only. The plugin accepts legacy exports carrying
     -- autoArchive but no longer reads or writes this accepted-but-ignored
     -- contract field.
     auto_archive INTEGER NOT NULL DEFAULT 0,
     origin TEXT NOT NULL,
     created_by_thread_id TEXT,
     next_run_at INTEGER,
     last_run_at INTEGER,
     run_count INTEGER NOT NULL DEFAULT 0,
     last_run_status TEXT,
     last_run_thread_id TEXT,
     last_error TEXT,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL
   );
   CREATE INDEX IF NOT EXISTS automations_project_idx
     ON automations(project_id);
   CREATE INDEX IF NOT EXISTS automations_due_idx
     ON automations(enabled, trigger_type, next_run_at);
   CREATE INDEX IF NOT EXISTS automations_target_thread_idx
     ON automations(target_thread_id);
   CREATE TABLE IF NOT EXISTS automation_runs (
     id TEXT PRIMARY KEY,
     automation_id TEXT NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
     run_mode TEXT NOT NULL,
     thread_id TEXT,
     status TEXT NOT NULL,
     trigger TEXT NOT NULL,
     skip_reason TEXT,
     error TEXT,
     output TEXT,
     exit_code INTEGER,
     idempotency_key TEXT,
     scheduled_for INTEGER NOT NULL,
     started_at INTEGER NOT NULL,
     finished_at INTEGER
   );
   CREATE INDEX IF NOT EXISTS automation_runs_automation_started_idx
     ON automation_runs(automation_id, started_at, id);
   CREATE INDEX IF NOT EXISTS automation_runs_thread_idx
     ON automation_runs(thread_id);
   CREATE UNIQUE INDEX IF NOT EXISTS automation_runs_idempotency_idx
     ON automation_runs(automation_id, idempotency_key)
     WHERE idempotency_key IS NOT NULL;
   CREATE TABLE IF NOT EXISTS automation_thread_marks (
     thread_id TEXT PRIMARY KEY,
     automation_id TEXT NOT NULL,
     run_id TEXT NOT NULL,
     created_at INTEGER NOT NULL
   );`,
];

export interface CreateAutomationInput {
  id?: string;
  projectId: string;
  name: string;
  enabled: boolean;
  trigger: AutomationTrigger;
  runMode: AutomationRunMode;
  execution: AutomationExecution;
  origin: AutomationOrigin;
  createdByThreadId: string | null;
  nextRunAt: number | null;
}

export interface UpdateAutomationInput {
  name?: string;
  trigger?: AutomationTrigger;
  execution?: AutomationExecution;
  targetThreadId?: string | null;
  nextRunAt?: number | null;
}

function serializeTrigger(trigger: AutomationTrigger): string {
  return JSON.stringify(trigger);
}

function serializeExecution(execution: AutomationExecution): string {
  return JSON.stringify(execution);
}

export function parseAutomationTrigger(triggerConfig: string): AutomationTrigger {
  return automationTriggerSchema.parse(JSON.parse(triggerConfig));
}

export function parseAutomationExecution(execution: string): AutomationExecution {
  return automationExecutionSchema.parse(JSON.parse(execution));
}

export function toAutomationResponse(row: AutomationRow): AutomationResponse {
  const trigger = parseAutomationTrigger(row.triggerConfig);
  const execution = parseAutomationExecution(row.execution);
  return automationResponseSchema.parse({
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    enabled: row.enabled,
    trigger,
    execution,
    origin: row.origin,
    createdByThreadId: row.createdByThreadId,
    nextRunAt: row.nextRunAt,
    lastRunAt: row.lastRunAt,
    runCount: row.runCount,
    lastRunStatus: row.lastRunStatus,
    lastRunThreadId: row.lastRunThreadId,
    lastError: row.lastError,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

export function toAutomationRunResponse(
  row: AutomationRunRow,
): AutomationRunResponse {
  return automationRunResponseSchema.parse({
    id: row.id,
    automationId: row.automationId,
    runMode: row.runMode,
    threadId: row.threadId,
    status: row.status,
    trigger: row.trigger,
    skipReason: row.skipReason,
    error: row.error,
    output: row.output,
    exitCode: row.exitCode,
    scheduledFor: row.scheduledFor,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
  });
}

export function createAutomation(db: Db, input: CreateAutomationInput): AutomationRow {
  const now = Date.now();
  const id = input.id ?? createAutomationId();
  db.prepare(
    `INSERT INTO automations (
       id, project_id, target_thread_id, name, enabled, trigger_type,
       trigger_config, run_mode, execution, origin,
       created_by_thread_id, next_run_at, last_run_at, run_count,
       last_run_status, last_run_thread_id, last_error, created_at, updated_at
     ) VALUES (
       @id, @projectId, @targetThreadId, @name, @enabled, @triggerType,
       @triggerConfig, @runMode, @execution, @origin,
       @createdByThreadId, @nextRunAt, NULL, 0, NULL, NULL, NULL, @now, @now
     )`,
  ).run({
    id,
    projectId: input.projectId,
    targetThreadId:
      input.execution.mode === "agent"
        ? (input.execution.targetThreadId ?? null)
        : null,
    name: input.name,
    enabled: boolToInt(input.enabled),
    triggerType: input.trigger.triggerType,
    triggerConfig: serializeTrigger(input.trigger),
    runMode: input.runMode,
    execution: serializeExecution(input.execution),
    origin: input.origin,
    createdByThreadId: input.createdByThreadId,
    nextRunAt: input.nextRunAt,
    now,
  });
  const created = getAutomation(db, id);
  if (!created) throw new Error("failed to create automation");
  return created;
}

export function getAutomation(db: Db, id: string): AutomationRow | null {
  return optionalAutomationRow(
    db
      .prepare(
        `SELECT
           id, project_id AS projectId, target_thread_id AS targetThreadId,
           name, enabled, trigger_type AS triggerType,
           trigger_config AS triggerConfig, run_mode AS runMode, execution, origin,
           created_by_thread_id AS createdByThreadId,
           next_run_at AS nextRunAt, last_run_at AS lastRunAt,
           run_count AS runCount, last_run_status AS lastRunStatus,
           last_run_thread_id AS lastRunThreadId, last_error AS lastError,
           created_at AS createdAt, updated_at AS updatedAt
         FROM automations WHERE id = ?`,
      )
      .get(id),
  );
}

export function getAutomationForProject(
  db: Db,
  args: { projectId: string; automationId: string },
): AutomationRow | null {
  const row = getAutomation(db, args.automationId);
  return row?.projectId === args.projectId ? row : null;
}

export function listAutomationsForProject(
  db: Db,
  projectId: string,
): AutomationRow[] {
  return db
    .prepare(
      `SELECT
         id, project_id AS projectId, target_thread_id AS targetThreadId,
         name, enabled, trigger_type AS triggerType,
         trigger_config AS triggerConfig, run_mode AS runMode, execution, origin,
         created_by_thread_id AS createdByThreadId,
         next_run_at AS nextRunAt, last_run_at AS lastRunAt,
         run_count AS runCount, last_run_status AS lastRunStatus,
         last_run_thread_id AS lastRunThreadId, last_error AS lastError,
         created_at AS createdAt, updated_at AS updatedAt
       FROM automations
       WHERE project_id = ?
       ORDER BY created_at DESC, id DESC`,
    )
    .all(projectId)
    .map(requiredAutomationRow);
}

export function listAllAutomations(db: Db): AutomationRow[] {
  return db
    .prepare(
      `SELECT
         id, project_id AS projectId, target_thread_id AS targetThreadId,
         name, enabled, trigger_type AS triggerType,
         trigger_config AS triggerConfig, run_mode AS runMode, execution, origin,
         created_by_thread_id AS createdByThreadId,
         next_run_at AS nextRunAt, last_run_at AS lastRunAt,
         run_count AS runCount, last_run_status AS lastRunStatus,
         last_run_thread_id AS lastRunThreadId, last_error AS lastError,
         created_at AS createdAt, updated_at AS updatedAt
       FROM automations
       ORDER BY created_at DESC, id DESC`,
    )
    .all()
    .map(requiredAutomationRow);
}

export function updateAutomation(
  db: Db,
  args: { projectId: string; automationId: string; patch: UpdateAutomationInput },
): AutomationRow | null {
  const existing = getAutomationForProject(db, args);
  if (!existing) return null;
  const nextTrigger = args.patch.trigger ?? parseAutomationTrigger(existing.triggerConfig);
  const nextExecution =
    args.patch.execution ?? parseAutomationExecution(existing.execution);
  const now = Date.now();
  db.prepare(
    `UPDATE automations SET
       name = @name,
       trigger_type = @triggerType,
       trigger_config = @triggerConfig,
       run_mode = @runMode,
       execution = @execution,
       target_thread_id = @targetThreadId,
       next_run_at = @nextRunAt,
       updated_at = @now
     WHERE id = @automationId AND project_id = @projectId`,
  ).run({
    automationId: args.automationId,
    projectId: args.projectId,
    name: args.patch.name ?? existing.name,
    triggerType: nextTrigger.triggerType,
    triggerConfig: serializeTrigger(nextTrigger),
    runMode: nextExecution.mode,
    execution: serializeExecution(nextExecution),
    targetThreadId:
      args.patch.targetThreadId !== undefined
        ? args.patch.targetThreadId
        : nextExecution.mode === "agent"
          ? (nextExecution.targetThreadId ?? null)
          : null,
    nextRunAt:
      args.patch.nextRunAt !== undefined ? args.patch.nextRunAt : existing.nextRunAt,
    now,
  });
  return getAutomationForProject(db, args);
}

export function setAutomationEnabled(
  db: Db,
  args: {
    projectId: string;
    automationId: string;
    enabled: boolean;
    nextRunAt: number | null;
    lastError?: string | null;
  },
): AutomationRow | null {
  db.prepare(
    `UPDATE automations SET
       enabled = @enabled,
       next_run_at = @nextRunAt,
       last_error = CASE WHEN @hasLastError THEN @lastError ELSE last_error END,
       updated_at = @now
     WHERE id = @automationId AND project_id = @projectId`,
  ).run({
    automationId: args.automationId,
    projectId: args.projectId,
    enabled: boolToInt(args.enabled),
    nextRunAt: args.nextRunAt,
    hasLastError: args.lastError === undefined ? 0 : 1,
    lastError: args.lastError ?? null,
    now: Date.now(),
  });
  return getAutomationForProject(db, args);
}

export function deleteAutomation(
  db: Db,
  args: { projectId: string; automationId: string },
): boolean {
  const existing = getAutomationForProject(db, args);
  if (!existing) return false;
  db.prepare(`DELETE FROM automation_runs WHERE automation_id = ?`).run(
    args.automationId,
  );
  db.prepare(`DELETE FROM automation_thread_marks WHERE automation_id = ?`).run(
    args.automationId,
  );
  db.prepare(`DELETE FROM automations WHERE id = ? AND project_id = ?`).run(
    args.automationId,
    args.projectId,
  );
  return true;
}

export function listDueAutomations(
  db: Db,
  args: { now: number; limit: number },
): AutomationRow[] {
  return db
    .prepare(
      `SELECT
         id, project_id AS projectId, target_thread_id AS targetThreadId,
         name, enabled, trigger_type AS triggerType,
         trigger_config AS triggerConfig, run_mode AS runMode, execution, origin,
         created_by_thread_id AS createdByThreadId,
         next_run_at AS nextRunAt, last_run_at AS lastRunAt,
         run_count AS runCount, last_run_status AS lastRunStatus,
         last_run_thread_id AS lastRunThreadId, last_error AS lastError,
         created_at AS createdAt, updated_at AS updatedAt
       FROM automations
       WHERE enabled = 1
         AND trigger_type IN ('schedule', 'once')
         AND next_run_at IS NOT NULL
         AND next_run_at <= ?
       ORDER BY next_run_at ASC, created_at ASC, id ASC
       LIMIT ?`,
    )
    .all(args.now, args.limit)
    .map(requiredAutomationRow);
}

export type ClaimScheduledRunResult =
  | { advanced: false }
  | { advanced: true; automation: AutomationRow; run: AutomationRunRow };

export function claimAutomationScheduledRun(
  db: Db,
  args: {
    automationId: string;
    expectedNextRunAt: number;
    newNextRunAt: number | null;
    now: number;
    skipReason?: string | null;
  },
): ClaimScheduledRunResult {
  return db.transaction((): ClaimScheduledRunResult => {
    const row = getAutomation(db, args.automationId);
    if (
      !row ||
      !row.enabled ||
      (row.triggerType !== "schedule" && row.triggerType !== "once") ||
      row.nextRunAt !== args.expectedNextRunAt
    ) {
      return { advanced: false };
    }
    const skip = args.skipReason != null;
    const updated = db
      .prepare(
        `UPDATE automations SET
           enabled = @enabled,
           next_run_at = @newNextRunAt,
           last_run_at = @now,
           run_count = run_count + 1,
           last_run_status = @lastRunStatus,
           updated_at = @now
         WHERE id = @automationId AND next_run_at = @expectedNextRunAt
         RETURNING
           id, project_id AS projectId, target_thread_id AS targetThreadId,
           name, enabled, trigger_type AS triggerType,
           trigger_config AS triggerConfig, run_mode AS runMode, execution, origin,
           created_by_thread_id AS createdByThreadId,
           next_run_at AS nextRunAt, last_run_at AS lastRunAt,
           run_count AS runCount, last_run_status AS lastRunStatus,
           last_run_thread_id AS lastRunThreadId, last_error AS lastError,
           created_at AS createdAt, updated_at AS updatedAt`,
      )
      .get({
        automationId: args.automationId,
        expectedNextRunAt: args.expectedNextRunAt,
        enabled: boolToInt(row.triggerType === "once" ? false : row.enabled),
        newNextRunAt: args.newNextRunAt,
        lastRunStatus: skip ? "skipped" : "running",
        now: args.now,
      });
    if (updated === undefined) return { advanced: false };
    const runId = createAutomationRunId();
    db.prepare(
      `INSERT INTO automation_runs (
         id, automation_id, run_mode, thread_id, status, trigger, skip_reason,
         error, output, exit_code, idempotency_key, scheduled_for, started_at,
         finished_at
       ) VALUES (
         @id, @automationId, @runMode, NULL, @status, 'schedule', @skipReason,
         NULL, NULL, NULL, NULL, @scheduledFor, @startedAt, @finishedAt
       )`,
    ).run({
      id: runId,
      automationId: args.automationId,
      runMode: row.runMode,
      status: skip ? "skipped" : "running",
      skipReason: args.skipReason ?? null,
      scheduledFor: args.expectedNextRunAt,
      startedAt: args.now,
      finishedAt: skip ? args.now : null,
    });
    const run = getAutomationRun(db, runId);
    if (!run) throw new Error("failed to create automation run");
    return { advanced: true, automation: requiredAutomationRow(updated), run };
  })();
}

export function restoreAutomationAfterFailedRun(
  db: Db,
  args: {
    automationId: string;
    runId: string;
    triggerType: "schedule" | "once";
    advancedNextRunAt: number | null;
    restoredNextRunAt: number;
    expectedRunCount: number;
    error: string;
    now: number;
  },
): void {
  db.transaction(() => {
    if (args.triggerType === "once") {
      // A failed one-shot is terminal: the claim already disabled it and its
      // runAt is in the past, so re-arming would retry every sweep forever
      // (and re-enable automations deliberately disabled elsewhere).
      db.prepare(
        `UPDATE automations SET
           last_run_status = 'failed',
           last_error = @error,
           updated_at = @now
         WHERE id = @automationId`,
      ).run({
        automationId: args.automationId,
        error: args.error,
        now: args.now,
      });
    } else {
      db.prepare(
        `UPDATE automations SET
           enabled = 1,
           next_run_at = @restoredNextRunAt,
           run_count = @restoredRunCount,
           last_run_status = 'failed',
           last_error = @error,
           updated_at = @now
         WHERE id = @automationId
           AND run_count = @expectedRunCount
           AND next_run_at = @advancedNextRunAt`,
      ).run({
        automationId: args.automationId,
        restoredNextRunAt: args.restoredNextRunAt,
        restoredRunCount: args.expectedRunCount - 1,
        expectedRunCount: args.expectedRunCount,
        advancedNextRunAt: args.advancedNextRunAt,
        error: args.error,
        now: args.now,
      });
    }
    db.prepare(
      `UPDATE automation_runs
       SET status = 'failed', error = @error, finished_at = @now
       WHERE id = @runId`,
    ).run({ runId: args.runId, error: args.error, now: args.now });
  })();
}

export function closeAutomationRun(
  db: Db,
  args: {
    runId: string;
    status: "succeeded" | "failed" | "skipped";
    skipReason?: string | null;
    error?: string | null;
    output?: string | null;
    exitCode?: number | null;
    threadId?: string | null;
    now: number;
  },
): { run: AutomationRunRow; automationId: string } | null {
  return db.transaction(() => {
    const existing = getAutomationRun(db, args.runId);
    if (!existing) return null;
    db.prepare(
       `UPDATE automation_runs SET
         status = @status,
         skip_reason = @skipReason,
         error = @error,
         output = @output,
         exit_code = @exitCode,
         thread_id = CASE WHEN @hasThreadId THEN @threadId ELSE thread_id END,
         finished_at = @now
       WHERE id = @runId`,
    ).run({
      runId: args.runId,
      status: args.status,
      skipReason: args.skipReason ?? null,
      error: args.error ?? null,
      output: args.output ?? null,
      exitCode: args.exitCode ?? null,
      hasThreadId: args.threadId === undefined ? 0 : 1,
      threadId: args.threadId ?? null,
      now: args.now,
    });
    db.prepare(
      `UPDATE automations SET
         last_run_status = @status,
         last_run_thread_id = CASE
           WHEN @threadId IS NOT NULL THEN @threadId
           ELSE last_run_thread_id
         END,
         last_error = CASE WHEN @status = 'failed' THEN @error ELSE NULL END,
         updated_at = @now
       WHERE id = @automationId`,
    ).run({
      automationId: existing.automationId,
      status: args.status,
      threadId: args.threadId ?? null,
      error: args.error ?? null,
      now: args.now,
    });
    const run = getAutomationRun(db, args.runId);
    if (!run) return null;
    return { run, automationId: run.automationId };
  })();
}

export function createManualRun(
  db: Db,
  args: {
    automationId: string;
    runMode: AutomationRunMode;
    idempotencyKey?: string | null;
    now: number;
  },
): { run: AutomationRunRow; deduped: boolean } {
  return db.transaction(() => {
    if (args.idempotencyKey) {
      const existing = optionalRunRow(
        db
          .prepare(
            `SELECT
               id, automation_id AS automationId, run_mode AS runMode,
               thread_id AS threadId, status, trigger, skip_reason AS skipReason,
               error, output, exit_code AS exitCode,
               idempotency_key AS idempotencyKey, scheduled_for AS scheduledFor,
               started_at AS startedAt, finished_at AS finishedAt
             FROM automation_runs
             WHERE automation_id = ? AND idempotency_key = ?`,
          )
          .get(args.automationId, args.idempotencyKey),
      );
      if (existing) return { run: existing, deduped: true };
    }
    const runId = createAutomationRunId();
    db.prepare(
      `INSERT INTO automation_runs (
         id, automation_id, run_mode, thread_id, status, trigger, skip_reason,
         error, output, exit_code, idempotency_key, scheduled_for, started_at,
         finished_at
       ) VALUES (
         @id, @automationId, @runMode, NULL, 'running', 'manual', NULL,
         NULL, NULL, NULL, @idempotencyKey, @now, @now, NULL
       )`,
    ).run({
      id: runId,
      automationId: args.automationId,
      runMode: args.runMode,
      idempotencyKey: args.idempotencyKey ?? null,
      now: args.now,
    });
    const run = getAutomationRun(db, runId);
    if (!run) throw new Error("failed to create manual run");
    return { run, deduped: false };
  })();
}

export function getAutomationRun(db: Db, id: string): AutomationRunRow | null {
  return optionalRunRow(
    db
      .prepare(
        `SELECT
           id, automation_id AS automationId, run_mode AS runMode,
           thread_id AS threadId, status, trigger, skip_reason AS skipReason,
           error, output, exit_code AS exitCode,
           idempotency_key AS idempotencyKey, scheduled_for AS scheduledFor,
           started_at AS startedAt, finished_at AS finishedAt
         FROM automation_runs WHERE id = ?`,
      )
      .get(id),
  );
}

export function setAutomationRunThread(
  db: Db,
  args: { runId: string; threadId: string },
): AutomationRunRow | null {
  db.prepare(`UPDATE automation_runs SET thread_id = ? WHERE id = ?`).run(
    args.threadId,
    args.runId,
  );
  return getAutomationRun(db, args.runId);
}

export function markAutomationThread(
  db: Db,
  args: { threadId: string; automationId: string; runId: string; now: number },
): void {
  db.prepare(
    `INSERT OR REPLACE INTO automation_thread_marks (
       thread_id, automation_id, run_id, created_at
     ) VALUES (?, ?, ?, ?)`,
  ).run(args.threadId, args.automationId, args.runId, args.now);
}

export function isAutomationSpawnedThread(db: Db, threadId: string): boolean {
  return (
    db
      .prepare(
        `SELECT thread_id FROM automation_thread_marks WHERE thread_id = ? LIMIT 1`,
      )
      .get(threadId) !== undefined ||
    db
      .prepare(
        `SELECT id FROM automation_runs WHERE thread_id = ? LIMIT 1`,
      )
      .get(threadId) !== undefined
  );
}

export function getRunningAutomationRunByThread(
  db: Db,
  threadId: string,
): AutomationRunRow | null {
  return optionalRunRow(
    db
      .prepare(
        `SELECT
           id, automation_id AS automationId, run_mode AS runMode,
           thread_id AS threadId, status, trigger, skip_reason AS skipReason,
           error, output, exit_code AS exitCode,
           idempotency_key AS idempotencyKey, scheduled_for AS scheduledFor,
           started_at AS startedAt, finished_at AS finishedAt
         FROM automation_runs
         WHERE thread_id = ? AND status = 'running'
         ORDER BY started_at DESC
         LIMIT 1`,
      )
      .get(threadId),
  );
}

export function listAutomationRuns(
  db: Db,
  args: {
    automationId: string;
    limit: number;
    cursor?: { startedAt: number; id: string } | null;
  },
): AutomationRunRow[] {
  const rows = args.cursor
    ? db
        .prepare(
          `SELECT
             id, automation_id AS automationId, run_mode AS runMode,
             thread_id AS threadId, status, trigger, skip_reason AS skipReason,
             error, output, exit_code AS exitCode,
             idempotency_key AS idempotencyKey, scheduled_for AS scheduledFor,
             started_at AS startedAt, finished_at AS finishedAt
           FROM automation_runs
           WHERE automation_id = ?
             AND (started_at < ? OR (started_at = ? AND id < ?))
           ORDER BY started_at DESC, id DESC
           LIMIT ?`,
        )
        .all(
          args.automationId,
          args.cursor.startedAt,
          args.cursor.startedAt,
          args.cursor.id,
          args.limit,
        )
    : db
        .prepare(
          `SELECT
             id, automation_id AS automationId, run_mode AS runMode,
             thread_id AS threadId, status, trigger, skip_reason AS skipReason,
             error, output, exit_code AS exitCode,
             idempotency_key AS idempotencyKey, scheduled_for AS scheduledFor,
             started_at AS startedAt, finished_at AS finishedAt
           FROM automation_runs
           WHERE automation_id = ?
           ORDER BY started_at DESC, id DESC
           LIMIT ?`,
        )
        .all(args.automationId, args.limit);
  return rows.map(requiredRunRow);
}

export function disableAutomationsForDeletedThread(
  db: Db,
  args: { threadId: string; now: number },
): AutomationRow[] {
  db.prepare(
    `UPDATE automations SET
       enabled = 0,
       next_run_at = NULL,
       last_error = 'target thread deleted',
       updated_at = @now
     WHERE target_thread_id = @threadId AND enabled = 1`,
  ).run(args);
  return db
    .prepare(
      `SELECT
         id, project_id AS projectId, target_thread_id AS targetThreadId,
         name, enabled, trigger_type AS triggerType,
         trigger_config AS triggerConfig, run_mode AS runMode, execution, origin,
         created_by_thread_id AS createdByThreadId,
         next_run_at AS nextRunAt, last_run_at AS lastRunAt,
         run_count AS runCount, last_run_status AS lastRunStatus,
         last_run_thread_id AS lastRunThreadId, last_error AS lastError,
         created_at AS createdAt, updated_at AS updatedAt
       FROM automations
       WHERE target_thread_id = @threadId AND last_error = 'target thread deleted'
       ORDER BY updated_at DESC`,
    )
    .all(args)
    .map(requiredAutomationRow);
}
