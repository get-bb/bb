import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lte,
  notInArray,
  or,
} from "drizzle-orm";
import {
  workflowRunTerminalStatusValues,
  type ReasoningLevel,
  type WorkflowRunPendingManagerNotification,
  type WorkflowRunSourceTier,
  type WorkflowRunStatus,
  type WorkflowRunTerminalStatus,
  type WorkflowSandbox,
} from "@bb/domain";
import type { DbConnection, DbTransaction } from "../connection.js";
import { createWorkflowRunId } from "../ids.js";
import { workflowRuns } from "../schema.js";

type WorkflowRunReadConnection = DbConnection | DbTransaction;
type WorkflowRunWriteConnection = DbConnection | DbTransaction;

export type WorkflowRunRow = typeof workflowRuns.$inferSelect;

/**
 * Every field is required (nullable where null carries real semantics): the
 * server boundary resolves all defaults once, and rows are explicit
 * thereafter. The initial lifecycle state is fixed here — status `created`,
 * retention `live`, zero usage, no snapshot/result — and only the lifecycle
 * mutators below (exported via internal-lifecycle) can advance it.
 */
export interface CreateWorkflowRunInput {
  anchorThreadId: string | null;
  argsJson: string | null;
  budgetOutputTokens: number | null;
  /** Null = launched without an idempotency key (no replay protection). */
  clientRequestId: string | null;
  concurrency: number;
  effort: ReasoningLevel;
  hostId: string;
  keyVersion: string;
  maxAgents: number;
  maxFanout: number;
  model: string | null;
  projectId: string;
  providerId: string;
  sandbox: WorkflowSandbox;
  /** The project's sandbox ceiling at launch (per-call enforcement snapshot). */
  sandboxCeiling: WorkflowSandbox;
  scriptHash: string;
  scriptSource: string;
  seed: number;
  sourceTier: WorkflowRunSourceTier;
  workflowName: string;
  workspacePath: string;
}

export function createWorkflowRun(
  db: WorkflowRunWriteConnection,
  input: CreateWorkflowRunInput,
): WorkflowRunRow {
  const now = Date.now();
  return db
    .insert(workflowRuns)
    .values({
      id: createWorkflowRunId(),
      projectId: input.projectId,
      hostId: input.hostId,
      workspacePath: input.workspacePath,
      anchorThreadId: input.anchorThreadId,
      clientRequestId: input.clientRequestId,
      workflowName: input.workflowName,
      sourceTier: input.sourceTier,
      scriptSource: input.scriptSource,
      scriptHash: input.scriptHash,
      argsJson: input.argsJson,
      seed: input.seed,
      keyVersion: input.keyVersion,
      providerId: input.providerId,
      model: input.model,
      effort: input.effort,
      sandbox: input.sandbox,
      sandboxCeiling: input.sandboxCeiling,
      concurrency: input.concurrency,
      maxAgents: input.maxAgents,
      maxFanout: input.maxFanout,
      budgetOutputTokens: input.budgetOutputTokens,
      status: "created",
      failureReason: null,
      pendingManagerNotification: null,
      progressSnapshot: null,
      usageInputTokens: 0,
      usageOutputTokens: 0,
      usageToolUses: 0,
      usageDurationMs: 0,
      resultJson: null,
      retention: "live",
      runDirPrunedAt: null,
      createdAt: now,
      startedAt: null,
      settledAt: null,
      updatedAt: now,
    })
    .returning()
    .get();
}

export function getWorkflowRun(
  db: WorkflowRunReadConnection,
  id: string,
): WorkflowRunRow | null {
  return (
    db.select().from(workflowRuns).where(eq(workflowRuns.id, id)).get() ?? null
  );
}

/** POST /workflow-runs idempotency lookup (unique `client_request_id`). */
export function getWorkflowRunByClientRequestId(
  db: WorkflowRunReadConnection,
  clientRequestId: string,
): WorkflowRunRow | null {
  return (
    db
      .select()
      .from(workflowRuns)
      .where(eq(workflowRuns.clientRequestId, clientRequestId))
      .get() ?? null
  );
}

/** Batch lookup for event-batch ownership resolution (one query per batch). */
export function listWorkflowRunsByIds(
  db: WorkflowRunReadConnection,
  ids: readonly string[],
): WorkflowRunRow[] {
  if (ids.length === 0) {
    return [];
  }
  return db
    .select()
    .from(workflowRuns)
    .where(inArray(workflowRuns.id, [...ids]))
    .all();
}

export interface ListWorkflowRunsForProjectArgs {
  limit?: number;
  projectId: string;
}

export function listWorkflowRunsForProject(
  db: WorkflowRunReadConnection,
  args: ListWorkflowRunsForProjectArgs,
): WorkflowRunRow[] {
  return db
    .select()
    .from(workflowRuns)
    .where(eq(workflowRuns.projectId, args.projectId))
    .orderBy(desc(workflowRuns.createdAt), desc(workflowRuns.id))
    .limit(args.limit ?? -1)
    .all();
}

/**
 * The reconnect-reconciliation read. The optional id filters serve the
 * daemon-report buckets: `runIds` restricts to daemon-reported runs (revival
 * and stale-terminal buckets), `excludeRunIds` finds running-but-unreported
 * runs (interruption bucket). Both filter in SQL, never in JS.
 */
export interface ListWorkflowRunsByHostAndStatusesArgs {
  excludeRunIds?: readonly string[];
  hostId: string;
  runIds?: readonly string[];
  statuses: readonly WorkflowRunStatus[];
}

export function listWorkflowRunsByHostAndStatuses(
  db: WorkflowRunReadConnection,
  args: ListWorkflowRunsByHostAndStatusesArgs,
): WorkflowRunRow[] {
  if (args.statuses.length === 0) {
    return [];
  }
  return db
    .select()
    .from(workflowRuns)
    .where(
      and(
        eq(workflowRuns.hostId, args.hostId),
        inArray(workflowRuns.status, [...args.statuses]),
        args.runIds !== undefined
          ? inArray(workflowRuns.id, [...args.runIds])
          : undefined,
        args.excludeRunIds !== undefined
          ? notInArray(workflowRuns.id, [...args.excludeRunIds])
          : undefined,
      ),
    )
    .all();
}

/**
 * The plan §8 status transition table — the single source of truth for legal
 * moves; only the server lifecycle module drives it (mutators below export
 * via internal-lifecycle). Beyond the headline chain:
 * - `starting → failed`: command settle errors and `command_expired` with no
 *   events since queuedAt fail the run before it ever reported started.
 * - `starting → cancelled`: cancel-before-start convergence (the runner never
 *   spawned, so no `run/cancelled` event will arrive to settle it).
 * - `created → cancelled` / `interrupted → cancelled`: explicit USER cancel
 *   of a never-admitted or interrupted run, settled entirely server-side by
 *   the lifecycle module (M4 decision). Distinct from reconciliation bucket
 *   (d) — reconciliation still never cancels `interrupted` runs, and a late
 *   spooled `run/cancelled` event for an interrupted run still appends as
 *   history only (the ingestion guard owns that exclusion, not this table).
 * - `interrupted → completed | failed`: a spooled run-terminal event carrying
 *   the real outcome supersedes the synthetic interruption.
 * - `interrupted → starting`: resume.
 * Terminal statuses never change; user-cancel is never revived.
 */
export const ALLOWED_WORKFLOW_RUN_STATUS_TRANSITIONS: Record<
  WorkflowRunStatus,
  readonly WorkflowRunStatus[]
> = {
  created: ["starting", "cancelled"],
  starting: ["running", "failed", "cancelled"],
  running: ["completed", "failed", "cancelled", "interrupted"],
  interrupted: ["starting", "running", "completed", "failed", "cancelled"],
  completed: [],
  failed: [],
  cancelled: [],
};

interface InvalidWorkflowRunStatusTransitionErrorArgs {
  currentStatus: WorkflowRunStatus;
  newStatus: WorkflowRunStatus;
  runId: string;
}

export class InvalidWorkflowRunStatusTransitionError extends Error {
  readonly currentStatus: WorkflowRunStatus;
  readonly newStatus: WorkflowRunStatus;
  readonly runId: string;

  constructor(args: InvalidWorkflowRunStatusTransitionErrorArgs) {
    super(
      `Invalid workflow run status transition for ${args.runId}: ${args.currentStatus} → ${args.newStatus}`,
    );
    this.name = "InvalidWorkflowRunStatusTransitionError";
    this.currentStatus = args.currentStatus;
    this.newStatus = args.newStatus;
    this.runId = args.runId;
  }
}

function assertWorkflowRunTransitionAllowed(
  run: WorkflowRunRow,
  newStatus: WorkflowRunStatus,
): void {
  if (!ALLOWED_WORKFLOW_RUN_STATUS_TRANSITIONS[run.status].includes(newStatus)) {
    throw new InvalidWorkflowRunStatusTransitionError({
      currentStatus: run.status,
      newStatus,
      runId: run.id,
    });
  }
}

function getWorkflowRunOrThrow(
  db: WorkflowRunReadConnection,
  id: string,
): WorkflowRunRow {
  const run = getWorkflowRun(db, id);
  if (!run) {
    throw new Error(`Workflow run not found: ${id}`);
  }
  return run;
}

/** Non-terminal target statuses; terminal moves go through settleWorkflowRunInTransaction. */
export type TransitionableWorkflowRunStatus = Exclude<
  WorkflowRunStatus,
  "created" | WorkflowRunTerminalStatus
>;

export interface TransitionWorkflowRunStatusArgs {
  /**
   * Omitted = leave the stored reason untouched; null = clear it (revival);
   * string = record it (interruption).
   */
  failureReason?: string | null;
  id: string;
  newStatus: TransitionableWorkflowRunStatus;
}

/**
 * Guarded non-terminal status advance (created→starting, starting→running,
 * running→interrupted, interrupted→running|starting). Throws
 * InvalidWorkflowRunStatusTransitionError on any move the transition table
 * forbids. `startedAt` is set-once on the first move to `running`; revival
 * keeps the original value. Leaving `interrupted` (revival, resume
 * acceptance) structurally clears a pending "paused" manager notification —
 * the message instructs "resume it" and is wrong the moment the run moves on.
 */
export function transitionWorkflowRunStatusInTransaction(
  db: DbTransaction,
  args: TransitionWorkflowRunStatusArgs,
): WorkflowRunRow {
  const run = getWorkflowRunOrThrow(db, args.id);
  assertWorkflowRunTransitionAllowed(run, args.newStatus);

  const now = Date.now();
  const set: Partial<typeof workflowRuns.$inferInsert> = {
    status: args.newStatus,
    updatedAt: now,
  };
  if (args.failureReason !== undefined) {
    set.failureReason = args.failureReason;
  }
  if (args.newStatus === "running" && run.startedAt === null) {
    set.startedAt = now;
  }
  if (run.status === "interrupted") {
    set.pendingManagerNotification = null;
  }

  return db
    .update(workflowRuns)
    .set(set)
    .where(eq(workflowRuns.id, args.id))
    .returning()
    .get();
}

export interface WorkflowRunUsageTotals {
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  toolUses: number;
}

export interface SettleWorkflowRunArgs {
  /** Null for completed/cancelled; the failure reason for failed runs. */
  failureReason: string | null;
  id: string;
  /** Null when the run produced no result (failed/cancelled). */
  resultJson: string | null;
  settledAt?: number;
  status: WorkflowRunTerminalStatus;
  usage: WorkflowRunUsageTotals;
}

/**
 * Terminal finalize: status, result, usage totals, settledAt — one writer,
 * guarded by the same transition table (so terminal runs can never re-settle;
 * the only legal `created` jump to terminal is the explicit user-cancel edge).
 * Settling clears any pending manager notification — a still-undelivered
 * "paused" intent is stale once the run is terminal (the server-side cancel
 * settle re-sets "settled" intent in the same transaction when it owes the
 * terminal message).
 */
export function settleWorkflowRunInTransaction(
  db: DbTransaction,
  args: SettleWorkflowRunArgs,
): WorkflowRunRow {
  const run = getWorkflowRunOrThrow(db, args.id);
  assertWorkflowRunTransitionAllowed(run, args.status);

  const now = Date.now();
  return db
    .update(workflowRuns)
    .set({
      status: args.status,
      failureReason: args.failureReason,
      pendingManagerNotification: null,
      resultJson: args.resultJson,
      usageInputTokens: args.usage.inputTokens,
      usageOutputTokens: args.usage.outputTokens,
      usageToolUses: args.usage.toolUses,
      usageDurationMs: args.usage.durationMs,
      settledAt: args.settledAt ?? now,
      updatedAt: now,
    })
    .where(eq(workflowRuns.id, args.id))
    .returning()
    .get();
}

export interface UpdateWorkflowRunProgressSnapshotArgs {
  id: string;
  /** Serialized WorkflowProgressSnapshot JSON; supersedes the previous fold. */
  progressSnapshot: string;
}

/**
 * Ingestion fold writer. Touches only non-terminal rows: late spooled events
 * for a settled run still append to workflow_run_events, but the settled
 * snapshot is part of the terminal record and must not be rewritten. Returns
 * null when the run is terminal (or missing).
 */
export interface ListArchivableWorkflowRunsArgs {
  /** Settled (terminal) or last-updated (interrupted) at or before this epoch-ms. */
  archiveBefore: number;
  limit: number;
}

/**
 * Runs the retention sweep may archive: still `live`, and either terminal
 * with `settledAt` past the retention window, or `interrupted` and untouched
 * past the window (abandoned — never resumed, never revived). Oldest first so
 * a bounded sweep batch drains deterministically.
 */
export function listArchivableWorkflowRuns(
  db: WorkflowRunReadConnection,
  args: ListArchivableWorkflowRunsArgs,
): WorkflowRunRow[] {
  return db
    .select()
    .from(workflowRuns)
    .where(
      and(
        eq(workflowRuns.retention, "live"),
        or(
          and(
            inArray(workflowRuns.status, [...workflowRunTerminalStatusValues]),
            lte(workflowRuns.settledAt, args.archiveBefore),
          ),
          and(
            eq(workflowRuns.status, "interrupted"),
            lte(workflowRuns.updatedAt, args.archiveBefore),
          ),
        ),
      ),
    )
    .orderBy(asc(workflowRuns.updatedAt), asc(workflowRuns.id))
    .limit(args.limit)
    .all();
}

/**
 * Retention flip (`live → archived`). One-way: nothing un-archives a run.
 * Archived runs keep status/snapshot/result/usage forever but lose journal
 * payloads (pruned by the same sweep transaction) and resumability.
 */
export function archiveWorkflowRunInTransaction(
  db: DbTransaction,
  args: { id: string },
): WorkflowRunRow | null {
  return (
    db
      .update(workflowRuns)
      .set({ retention: "archived", updatedAt: Date.now() })
      .where(
        and(eq(workflowRuns.id, args.id), eq(workflowRuns.retention, "live")),
      )
      .returning()
      .get() ?? null
  );
}

export interface ListWorkflowRunsAwaitingRunDirPruneArgs {
  hostId: string;
  limit: number;
}

/**
 * Archived runs on the host whose daemon run dir has not been confirmed
 * pruned yet — the run-dir prune sweep's per-host work list (callers query
 * only hosts with an active session, so offline hosts never starve a batch).
 * Oldest first so a bounded batch drains deterministically.
 */
export function listWorkflowRunsAwaitingRunDirPrune(
  db: WorkflowRunReadConnection,
  args: ListWorkflowRunsAwaitingRunDirPruneArgs,
): WorkflowRunRow[] {
  return db
    .select()
    .from(workflowRuns)
    .where(
      and(
        eq(workflowRuns.hostId, args.hostId),
        eq(workflowRuns.retention, "archived"),
        isNull(workflowRuns.runDirPrunedAt),
      ),
    )
    .orderBy(asc(workflowRuns.updatedAt), asc(workflowRuns.id))
    .limit(args.limit)
    .all();
}

/**
 * Records the daemon's confirmation that the run dir is gone. Idempotent
 * (only the first confirmation writes); one-way — nothing un-prunes.
 */
export function markWorkflowRunRunDirPruned(
  db: WorkflowRunWriteConnection,
  args: { id: string },
): void {
  db.update(workflowRuns)
    .set({ runDirPrunedAt: Date.now() })
    .where(
      and(eq(workflowRuns.id, args.id), isNull(workflowRuns.runDirPrunedAt)),
    )
    .run();
}

export interface SetWorkflowRunPendingManagerNotificationArgs {
  id: string;
  kind: WorkflowRunPendingManagerNotification;
}

/**
 * Records durable manager-notification intent for an anchored run, inside the
 * lifecycle transaction that creates the debt: interruption sets "paused"
 * after the `running → interrupted` move; the server-side cancel settle sets
 * "settled" after finalize (which cleared any stale "paused" intent). The
 * best-effort terminal push additionally records "settled" post-commit when a
 * pending manager command transiently blocks it, handing the message to the
 * sweep instead of dropping it. The delivery sweep consumes it.
 */
export function setWorkflowRunPendingManagerNotification(
  db: WorkflowRunWriteConnection,
  args: SetWorkflowRunPendingManagerNotificationArgs,
): void {
  db.update(workflowRuns)
    .set({ pendingManagerNotification: args.kind, updatedAt: Date.now() })
    .where(eq(workflowRuns.id, args.id))
    .run();
}

export interface ClearWorkflowRunPendingManagerNotificationArgs {
  id: string;
  /**
   * The kind the caller delivered (or decided to drop). The clear is
   * conditional on the stored intent still being that kind so an async
   * delivery can never wipe intent that superseded it mid-flight — e.g. a
   * server-side cancel settle replacing "paused" with "settled" while the
   * paused message was on the wire.
   */
  kind: WorkflowRunPendingManagerNotification;
}

export function clearWorkflowRunPendingManagerNotification(
  db: WorkflowRunWriteConnection,
  args: ClearWorkflowRunPendingManagerNotificationArgs,
): void {
  db.update(workflowRuns)
    .set({ pendingManagerNotification: null, updatedAt: Date.now() })
    .where(
      and(
        eq(workflowRuns.id, args.id),
        eq(workflowRuns.pendingManagerNotification, args.kind),
      ),
    )
    .run();
}

/** The delivery sweep's read (indexed by workflow_runs_pending_notification_idx). */
export function listWorkflowRunsWithPendingManagerNotification(
  db: WorkflowRunReadConnection,
): WorkflowRunRow[] {
  return db
    .select()
    .from(workflowRuns)
    .where(isNotNull(workflowRuns.pendingManagerNotification))
    .all();
}

export function updateWorkflowRunProgressSnapshotInTransaction(
  db: DbTransaction,
  args: UpdateWorkflowRunProgressSnapshotArgs,
): WorkflowRunRow | null {
  return (
    db
      .update(workflowRuns)
      .set({
        progressSnapshot: args.progressSnapshot,
        updatedAt: Date.now(),
      })
      .where(
        and(
          eq(workflowRuns.id, args.id),
          notInArray(workflowRuns.status, [...workflowRunTerminalStatusValues]),
        ),
      )
      .returning()
      .get() ?? null
  );
}
