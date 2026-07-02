import { and, asc, desc, eq, inArray, isNotNull, isNull, lte, sql } from "drizzle-orm";
import type {
  AutomationOrigin,
  AutomationRunMode,
  AutomationTriggerType,
} from "@bb/domain";
import type { DbConnection } from "../connection.js";
import type { DbNotifier } from "../notifier.js";
import { automationRuns, automations, projects } from "../schema.js";
import { createAutomationId, createAutomationRunId } from "../ids.js";

export type AutomationRow = typeof automations.$inferSelect;
export type AutomationRunRow = typeof automationRuns.$inferSelect;

// triggerConfig / execution / environment are JSON-as-text; the server owns
// (de)serialization at the boundary and passes already-serialized strings here.
export interface CreateAutomationInput {
  /** Optional pre-generated id so the caller can write disk artifacts (the
   * inline script file) under it BEFORE the row exists; defaults to a fresh id. */
  id?: string;
  projectId: string;
  name: string;
  enabled: boolean;
  triggerType: AutomationTriggerType;
  triggerConfig: string;
  runMode: AutomationRunMode;
  execution: string;
  environment: string;
  autoArchive: boolean;
  origin: AutomationOrigin;
  createdByThreadId: string | null;
  targetThreadId: string | null;
  nextRunAt: number | null;
}

export interface UpdateAutomationInput {
  name?: string;
  triggerType?: AutomationTriggerType;
  triggerConfig?: string;
  runMode?: AutomationRunMode;
  execution?: string;
  environment?: string;
  autoArchive?: boolean;
  targetThreadId?: string | null;
  nextRunAt?: number | null;
}

export interface AutomationWithProject {
  automation: AutomationRow;
  projectId: string;
  projectName: string;
}

export function createAutomation(
  db: DbConnection,
  notifier: DbNotifier,
  input: CreateAutomationInput,
): AutomationRow {
  const now = Date.now();
  const row = db
    .insert(automations)
    .values({
      id: input.id ?? createAutomationId(),
      projectId: input.projectId,
      targetThreadId: input.targetThreadId,
      name: input.name,
      enabled: input.enabled,
      triggerType: input.triggerType,
      triggerConfig: input.triggerConfig,
      runMode: input.runMode,
      execution: input.execution,
      environment: input.environment,
      autoArchive: input.autoArchive,
      origin: input.origin,
      createdByThreadId: input.createdByThreadId,
      nextRunAt: input.nextRunAt,
      lastRunAt: null,
      runCount: 0,
      lastRunStatus: null,
      lastRunThreadId: null,
      lastError: null,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();
  notifier.notifyProject(input.projectId, ["automations-changed"]);
  return row;
}

export function getAutomation(
  db: DbConnection,
  id: string,
): AutomationRow | null {
  return (
    db.select().from(automations).where(eq(automations.id, id)).get() ?? null
  );
}

export function getAutomationForProject(
  db: DbConnection,
  args: { projectId: string; automationId: string },
): AutomationRow | null {
  return (
    db
      .select()
      .from(automations)
      .where(
        and(
          eq(automations.id, args.automationId),
          eq(automations.projectId, args.projectId),
        ),
      )
      .get() ?? null
  );
}

export function listAutomationsForProject(
  db: DbConnection,
  projectId: string,
): AutomationRow[] {
  return db
    .select()
    .from(automations)
    .where(eq(automations.projectId, projectId))
    .orderBy(desc(automations.createdAt), desc(automations.id))
    .all();
}

/** Cross-project list for the app overview; excludes deleted projects. */
export function listAutomationsWithProject(
  db: DbConnection,
): AutomationWithProject[] {
  return db
    .select({ automation: automations, projectName: projects.name })
    .from(automations)
    .innerJoin(projects, eq(projects.id, automations.projectId))
    .where(isNull(projects.deletedAt))
    .orderBy(desc(automations.createdAt), desc(automations.id))
    .all()
    .map((r) => ({
      automation: r.automation,
      projectId: r.automation.projectId,
      projectName: r.projectName,
    }));
}

export function updateAutomation(
  db: DbConnection,
  notifier: DbNotifier,
  args: { projectId: string; automationId: string; patch: UpdateAutomationInput },
): AutomationRow | null {
  const now = Date.now();
  const updated =
    db
      .update(automations)
      .set({ ...args.patch, updatedAt: now })
      .where(
        and(
          eq(automations.id, args.automationId),
          eq(automations.projectId, args.projectId),
        ),
      )
      .returning()
      .get() ?? null;
  if (updated) {
    notifier.notifyProject(args.projectId, ["automations-changed"]);
  }
  return updated;
}

/** pause/resume: server computes nextRunAt (null to pause, recomputed to resume). */
export function setAutomationEnabled(
  db: DbConnection,
  notifier: DbNotifier,
  args: {
    projectId: string;
    automationId: string;
    enabled: boolean;
    nextRunAt: number | null;
    lastError?: string | null;
  },
): AutomationRow | null {
  const now = Date.now();
  const updated =
    db
      .update(automations)
      .set({
        enabled: args.enabled,
        nextRunAt: args.nextRunAt,
        ...(args.lastError !== undefined ? { lastError: args.lastError } : {}),
        updatedAt: now,
      })
      .where(
        and(
          eq(automations.id, args.automationId),
          eq(automations.projectId, args.projectId),
        ),
      )
      .returning()
      .get() ?? null;
  if (updated) {
    notifier.notifyProject(args.projectId, ["automations-changed"]);
  }
  return updated;
}

export function deleteAutomation(
  db: DbConnection,
  notifier: DbNotifier,
  args: { projectId: string; automationId: string },
): boolean {
  const existing = getAutomationForProject(db, args);
  if (!existing) return false;
  db.delete(automations)
    .where(
      and(
        eq(automations.id, args.automationId),
        eq(automations.projectId, args.projectId),
      ),
    )
    .run();
  notifier.notifyProject(args.projectId, [
    "automations-changed",
    "automation-runs-changed",
  ]);
  return true;
}

export function listDueAutomations(
  db: DbConnection,
  args: { now: number; limit: number },
): AutomationRow[] {
  return db
    .select({ automation: automations })
    .from(automations)
    .innerJoin(projects, eq(projects.id, automations.projectId))
    .where(
      and(
        eq(automations.enabled, true),
        inArray(automations.triggerType, ["schedule", "once"]),
        isNotNull(automations.nextRunAt),
        lte(automations.nextRunAt, args.now),
        isNull(projects.deletedAt),
      ),
    )
    .orderBy(
      asc(automations.nextRunAt),
      asc(automations.createdAt),
      asc(automations.id),
    )
    .limit(args.limit)
    .all()
    .map((r) => r.automation);
}

export interface ClaimScheduledRunArgs {
  automationId: string;
  expectedNextRunAt: number;
  newNextRunAt: number | null;
  now: number;
  /** When set, the run is recorded as skipped (still advancing next_run_at). */
  skipReason?: string | null;
}
export type ClaimScheduledRunResult =
  | { advanced: false }
  | { advanced: true; automation: AutomationRow; run: AutomationRunRow };

/**
 * Optimistic at-most-once claim: advance next_run_at only if it still equals the
 * expected value (CAS), inside an immediate transaction, and insert the run row.
 */
export function claimAutomationScheduledRun(
  db: DbConnection,
  args: ClaimScheduledRunArgs,
): ClaimScheduledRunResult {
  return db.transaction(
    (tx): ClaimScheduledRunResult => {
      const row = tx
        .select()
        .from(automations)
        .where(eq(automations.id, args.automationId))
        .get();
      if (
        !row ||
        !row.enabled ||
        !["schedule", "once"].includes(row.triggerType) ||
        row.nextRunAt !== args.expectedNextRunAt
      ) {
        return { advanced: false };
      }
      const skip = args.skipReason != null;
      const updated = tx
        .update(automations)
        .set({
          enabled: row.triggerType === "once" ? false : row.enabled,
          nextRunAt: args.newNextRunAt,
          lastRunAt: args.now,
          runCount: row.runCount + 1,
          lastRunStatus: skip ? "skipped" : "running",
          updatedAt: args.now,
        })
        .where(
          and(
            eq(automations.id, args.automationId),
            eq(automations.nextRunAt, args.expectedNextRunAt),
          ),
        )
        .returning()
        .get();
      if (!updated) return { advanced: false };
      const run = tx
        .insert(automationRuns)
        .values({
          id: createAutomationRunId(),
          automationId: args.automationId,
          runMode: row.runMode,
          threadId: null,
          status: skip ? "skipped" : "running",
          trigger: "schedule",
          skipReason: args.skipReason ?? null,
          error: null,
          output: null,
          exitCode: null,
          idempotencyKey: null,
          scheduledFor: args.expectedNextRunAt,
          startedAt: args.now,
          finishedAt: skip ? args.now : null,
        })
        .returning()
        .get();
      return { advanced: true, automation: updated, run };
    },
    { behavior: "immediate" },
  );
}

/** Roll back a claim whose spawn/RPC failed before producing a result. */
export function restoreAutomationAfterFailedRun(
  db: DbConnection,
  args: {
    automationId: string;
    runId: string;
    advancedNextRunAt: number | null;
    restoredNextRunAt: number;
    expectedRunCount: number;
    error: string;
    now: number;
  },
): void {
  db.transaction(
    (tx) => {
      tx.update(automations)
        .set({
          enabled: true,
          nextRunAt: args.restoredNextRunAt,
          runCount: args.expectedRunCount - 1,
          lastRunStatus: "failed",
          lastError: args.error,
          updatedAt: args.now,
        })
        .where(
          and(
            eq(automations.id, args.automationId),
            args.advancedNextRunAt === null
              ? isNull(automations.nextRunAt)
              : eq(automations.nextRunAt, args.advancedNextRunAt),
            eq(automations.runCount, args.expectedRunCount),
          ),
        )
        .run();
      tx.update(automationRuns)
        .set({ status: "failed", error: args.error, finishedAt: args.now })
        .where(eq(automationRuns.id, args.runId))
        .run();
    },
    { behavior: "immediate" },
  );
}

export interface CloseAutomationRunArgs {
  runId: string;
  status: "succeeded" | "failed";
  error?: string | null;
  output?: string | null;
  exitCode?: number | null;
  threadId?: string | null;
  now: number;
}

/** Settle a run (script sync-close or agent turn-complete) + denormalize summary. */
export function closeAutomationRun(
  db: DbConnection,
  args: CloseAutomationRunArgs,
): { run: AutomationRunRow; automationId: string } | null {
  return db.transaction(
    (tx) => {
      const run = tx
        .update(automationRuns)
        .set({
          status: args.status,
          error: args.error ?? null,
          output: args.output ?? null,
          exitCode: args.exitCode ?? null,
          ...(args.threadId !== undefined ? { threadId: args.threadId } : {}),
          finishedAt: args.now,
        })
        .where(eq(automationRuns.id, args.runId))
        .returning()
        .get();
      if (!run) return null;
      tx.update(automations)
        .set({
          lastRunStatus: args.status,
          ...(args.threadId ? { lastRunThreadId: args.threadId } : {}),
          lastError: args.status === "failed" ? (args.error ?? null) : null,
          updatedAt: args.now,
        })
        .where(eq(automations.id, run.automationId))
        .run();
      return { run, automationId: run.automationId };
    },
    { behavior: "immediate" },
  );
}

/** run-now: create a manual run, deduping on idempotency key. */
export function createManualRun(
  db: DbConnection,
  args: {
    automationId: string;
    runMode: AutomationRunMode;
    idempotencyKey?: string | null;
    now: number;
  },
): { run: AutomationRunRow; deduped: boolean } {
  return db.transaction(
    (tx) => {
      if (args.idempotencyKey) {
        const existing = tx
          .select()
          .from(automationRuns)
          .where(
            and(
              eq(automationRuns.automationId, args.automationId),
              eq(automationRuns.idempotencyKey, args.idempotencyKey),
            ),
          )
          .get();
        if (existing) return { run: existing, deduped: true };
      }
      const run = tx
        .insert(automationRuns)
        .values({
          id: createAutomationRunId(),
          automationId: args.automationId,
          runMode: args.runMode,
          threadId: null,
          status: "running",
          trigger: "manual",
          skipReason: null,
          error: null,
          output: null,
          exitCode: null,
          idempotencyKey: args.idempotencyKey ?? null,
          scheduledFor: args.now,
          startedAt: args.now,
          finishedAt: null,
        })
        .returning()
        .get();
      return { run, deduped: false };
    },
    { behavior: "immediate" },
  );
}

export function getAutomationRun(
  db: DbConnection,
  id: string,
): AutomationRunRow | null {
  return (
    db
      .select()
      .from(automationRuns)
      .where(eq(automationRuns.id, id))
      .get() ?? null
  );
}

/**
 * Link a spawned thread to its (still-running) agent run row so the turn-complete
 * hook can later close it by thread. Returns the updated run, or null if missing.
 */
export function setAutomationRunThread(
  db: DbConnection,
  args: { runId: string; threadId: string },
): AutomationRunRow | null {
  return (
    db
      .update(automationRuns)
      .set({ threadId: args.threadId })
      .where(eq(automationRuns.id, args.runId))
      .returning()
      .get() ?? null
  );
}

/**
 * Server-trusted recursion guard: a thread is automation-spawned if any
 * `automation_runs` row links to it. Keyed on persisted run state, not the
 * thread title or a client-declared flag, so it cannot be spoofed by the caller.
 */
export function isAutomationSpawnedThread(
  db: DbConnection,
  threadId: string,
): boolean {
  return (
    db
      .select({ id: automationRuns.id })
      .from(automationRuns)
      .where(eq(automationRuns.threadId, threadId))
      .limit(1)
      .get() !== undefined
  );
}

/** Find a still-running run linked to a thread (agent turn-complete close path). */
export function getRunningAutomationRunByThread(
  db: DbConnection,
  threadId: string,
): AutomationRunRow | null {
  return (
    db
      .select()
      .from(automationRuns)
      .where(
        and(
          eq(automationRuns.threadId, threadId),
          eq(automationRuns.status, "running"),
        ),
      )
      .orderBy(desc(automationRuns.startedAt))
      .get() ?? null
  );
}

export interface ListAutomationRunsArgs {
  automationId: string;
  limit: number;
  cursor?: { startedAt: number; id: string } | null;
}

/** Run history, newest first, keyset-paginated by (started_at, id). */
export function listAutomationRuns(
  db: DbConnection,
  args: ListAutomationRunsArgs,
): AutomationRunRow[] {
  const where = args.cursor
    ? and(
        eq(automationRuns.automationId, args.automationId),
        sql`(${automationRuns.startedAt}, ${automationRuns.id}) < (${args.cursor.startedAt}, ${args.cursor.id})`,
      )
    : eq(automationRuns.automationId, args.automationId);
  return db
    .select()
    .from(automationRuns)
    .where(where)
    .orderBy(desc(automationRuns.startedAt), desc(automationRuns.id))
    .limit(args.limit)
    .all();
}

/**
 * Target-thread deletion: disable (never delete) automations re-prompting it, so
 * the schedule is preserved and visible. Returns the disabled rows so the caller
 * can emit per-project realtime notifications.
 */
export function disableAutomationsForDeletedThread(
  db: DbConnection,
  args: { threadId: string; now: number },
): AutomationRow[] {
  return db
    .update(automations)
    .set({
      enabled: false,
      nextRunAt: null,
      lastError: "target thread deleted",
      updatedAt: args.now,
    })
    .where(
      and(
        eq(automations.targetThreadId, args.threadId),
        eq(automations.enabled, true),
      ),
    )
    .returning()
    .all();
}
