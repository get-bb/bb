import { and, eq, inArray, ne, sql, lt } from "drizzle-orm";
import type {
  DiscoveredWorkspaceProperties,
  EnvironmentChangeKind,
  EnvironmentLifecycleEvent,
  EnvironmentLifecycleNoopReason,
  EnvironmentStatus,
  WorkspaceProvisionType,
} from "@bb/domain";
import { evaluateEnvironmentLifecycleEvent } from "@bb/domain";
import type { DbConnection, DbTransaction } from "../connection.js";
import type { DbNotifier } from "../notifier.js";
import { environments } from "../schema.js";
import { createEnvironmentId } from "../ids.js";

type EnvironmentReadConnection = DbConnection | DbTransaction;
type EnvironmentWriteConnection = DbConnection | DbTransaction;
type EnvironmentRow = typeof environments.$inferSelect;

export interface CreateEnvironmentInput {
  name?: string | null;
  projectId: string;
  hostId: string;
  workspaceProvisionType: WorkspaceProvisionType;
  path?: string | null;
  managed?: boolean;
  isGitRepo?: boolean;
  isWorktree?: boolean;
  branchName?: string | null;
  baseBranch?: string | null;
  defaultBranch?: string | null;
  mergeBaseBranch?: string | null;
  status?: EnvironmentStatus;
}

export function createEnvironment(
  db: EnvironmentWriteConnection,
  notifier: DbNotifier,
  input: CreateEnvironmentInput,
) {
  const now = Date.now();
  const id = createEnvironmentId();
  const row = db
    .insert(environments)
    .values({
      id,
      name: input.name ?? null,
      projectId: input.projectId,
      hostId: input.hostId,
      path: input.path ?? null,
      managed: input.managed ?? false,
      isGitRepo: input.isGitRepo ?? false,
      isWorktree: input.isWorktree ?? false,
      branchName: input.branchName ?? null,
      baseBranch: input.baseBranch ?? null,
      defaultBranch: input.defaultBranch ?? null,
      mergeBaseBranch: input.mergeBaseBranch ?? null,
      workspaceProvisionType: input.workspaceProvisionType,
      status: input.status ?? "provisioning",
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();
  notifier.notifyEnvironment(id, ["environment-created"]);
  return row;
}

export function getEnvironment(db: EnvironmentReadConnection, id: string) {
  return (
    db.select().from(environments).where(eq(environments.id, id)).get() ?? null
  );
}

export function findEnvironmentByHostPath(
  db: DbConnection,
  hostId: string,
  path: string,
) {
  return (
    db
      .select()
      .from(environments)
      .where(and(eq(environments.hostId, hostId), eq(environments.path, path)))
      .get() ?? null
  );
}

export function listEnvironments(db: DbConnection, projectId?: string) {
  if (projectId) {
    return db
      .select()
      .from(environments)
      .where(eq(environments.projectId, projectId))
      .all();
  }
  return db.select().from(environments).all();
}

export function listEnvironmentsByIds(
  db: DbConnection,
  environmentIds: readonly string[],
) {
  if (environmentIds.length === 0) {
    return [];
  }

  return db
    .select()
    .from(environments)
    .where(inArray(environments.id, [...environmentIds]))
    .all();
}

interface EnvironmentMetadataUpdateColumns {
  baseBranch?: string | null;
  branchName?: string | null;
  defaultBranch?: string | null;
  isGitRepo?: boolean;
  isWorktree?: boolean;
  mergeBaseBranch?: string | null;
  name?: string | null;
  path?: string | null;
}

interface EnvironmentMetadataChangeArgs {
  existing: EnvironmentRow;
  metadata: EnvironmentMetadataUpdateColumns;
  updated: EnvironmentRow;
}

export interface UpdateEnvironmentMetadataInput {
  mergeBaseBranch?: string | null;
  name?: string | null;
}

export interface ListRetiredLoadedEnvironmentIdsOnHostArgs {
  environmentIds: readonly string[];
  hostId: string;
}

export function listRetiredLoadedEnvironmentIdsOnHost(
  db: EnvironmentReadConnection,
  args: ListRetiredLoadedEnvironmentIdsOnHostArgs,
): string[] {
  const environmentIds = [...new Set(args.environmentIds)];
  if (environmentIds.length === 0) {
    return [];
  }

  const retainedRows = db
    .select({ id: environments.id })
    .from(environments)
    .where(
      and(
        inArray(environments.id, environmentIds),
        eq(environments.hostId, args.hostId),
        ne(environments.status, "destroyed"),
      ),
    )
    .all();
  const retainedEnvironmentIds = new Set(
    retainedRows.map((environment) => environment.id),
  );

  return environmentIds.filter(
    (environmentId) => !retainedEnvironmentIds.has(environmentId),
  );
}

function buildEnvironmentMetadataUpdateSet(
  input: EnvironmentMetadataUpdateColumns,
): EnvironmentMetadataUpdateColumns {
  const set: EnvironmentMetadataUpdateColumns = {};
  if ("baseBranch" in input) set.baseBranch = input.baseBranch;
  if ("path" in input) set.path = input.path;
  if ("isGitRepo" in input) set.isGitRepo = input.isGitRepo;
  if ("isWorktree" in input) set.isWorktree = input.isWorktree;
  if ("branchName" in input) set.branchName = input.branchName;
  if ("defaultBranch" in input) set.defaultBranch = input.defaultBranch;
  if ("mergeBaseBranch" in input) set.mergeBaseBranch = input.mergeBaseBranch;
  if ("name" in input) set.name = input.name;
  return set;
}

function environmentMetadataChanged(
  args: EnvironmentMetadataChangeArgs,
): boolean {
  return (
    ("baseBranch" in args.metadata &&
      args.updated.baseBranch !== args.existing.baseBranch) ||
    ("path" in args.metadata && args.updated.path !== args.existing.path) ||
    ("isGitRepo" in args.metadata &&
      args.updated.isGitRepo !== args.existing.isGitRepo) ||
    ("isWorktree" in args.metadata &&
      args.updated.isWorktree !== args.existing.isWorktree) ||
    ("branchName" in args.metadata &&
      args.updated.branchName !== args.existing.branchName) ||
    ("defaultBranch" in args.metadata &&
      args.updated.defaultBranch !== args.existing.defaultBranch) ||
    ("mergeBaseBranch" in args.metadata &&
      args.updated.mergeBaseBranch !== args.existing.mergeBaseBranch) ||
    ("name" in args.metadata && args.updated.name !== args.existing.name)
  );
}

function updateEnvironmentMetadataRecord(
  db: EnvironmentWriteConnection,
  notifier: DbNotifier,
  id: string,
  metadataInput: EnvironmentMetadataUpdateColumns,
) {
  const existing = getEnvironment(db, id);
  if (!existing) return null;

  const metadata = buildEnvironmentMetadataUpdateSet(metadataInput);
  const updated = db
    .update(environments)
    .set({ ...metadata, updatedAt: Date.now() })
    .where(eq(environments.id, id))
    .returning()
    .get();

  if (!updated) {
    return null;
  }

  if (environmentMetadataChanged({ existing, metadata, updated })) {
    notifier.notifyEnvironment(id, ["metadata-changed"]);
  }

  return updated;
}

export function updateEnvironmentMetadata(
  db: EnvironmentWriteConnection,
  notifier: DbNotifier,
  id: string,
  input: UpdateEnvironmentMetadataInput,
) {
  return updateEnvironmentMetadataRecord(db, notifier, id, input);
}

export interface RecordProvisionedEnvironmentWorkspaceInput extends DiscoveredWorkspaceProperties {
  baseBranch?: string | null;
  mergeBaseBranch?: string | null;
}

/**
 * Persists the workspace properties a provision result discovered. Pure
 * metadata — the status change rides the separate `provision.succeeded`
 * lifecycle event.
 */
export function recordProvisionedEnvironmentWorkspace(
  db: EnvironmentWriteConnection,
  notifier: DbNotifier,
  id: string,
  input: RecordProvisionedEnvironmentWorkspaceInput,
) {
  return updateEnvironmentMetadataRecord(db, notifier, id, {
    path: input.path,
    isGitRepo: input.isGitRepo,
    isWorktree: input.isWorktree,
    branchName: input.branchName,
    defaultBranch: input.defaultBranch,
    ...(input.baseBranch !== undefined ? { baseBranch: input.baseBranch } : {}),
    ...(input.mergeBaseBranch !== undefined
      ? { mergeBaseBranch: input.mergeBaseBranch }
      : {}),
  });
}

export interface ListStaleDestroyingManagedEnvironmentsArgs {
  updatedBefore: number;
}

/**
 * Managed environments stuck in "destroying" whose destroy RPC result was
 * presumably lost. The sweep applies `destroy.lost` to each.
 */
export function listStaleDestroyingManagedEnvironments(
  db: DbConnection,
  args: ListStaleDestroyingManagedEnvironmentsArgs,
) {
  return db
    .select()
    .from(environments)
    .where(
      and(
        eq(environments.managed, true),
        eq(environments.status, "destroying"),
        lt(environments.updatedAt, args.updatedBefore),
      ),
    )
    .all();
}

export type ApplyEnvironmentLifecycleEventNoopReason =
  | EnvironmentLifecycleNoopReason
  | "not-found"
  | "cas-conflict";

export type ApplyEnvironmentLifecycleEventOutcome =
  | {
      applied: true;
      changes: EnvironmentChangeKind[];
      environment: EnvironmentRow;
    }
  | {
      applied: false;
      detail: string;
      reason: ApplyEnvironmentLifecycleEventNoopReason;
    };

export interface ApplyEnvironmentLifecycleEventArgs {
  environmentId: string;
  event: EnvironmentLifecycleEvent;
}

interface EnvironmentLifecycleEventNotAppliedErrorArgs {
  detail: string;
  reason: ApplyEnvironmentLifecycleEventNoopReason;
}

export class EnvironmentLifecycleEventNotAppliedError extends Error {
  readonly detail: string;
  readonly reason: ApplyEnvironmentLifecycleEventNoopReason;

  constructor(args: EnvironmentLifecycleEventNotAppliedErrorArgs) {
    super(
      `Environment lifecycle event not applied (${args.reason}): ${args.detail}`,
    );
    this.name = "EnvironmentLifecycleEventNotAppliedError";
    this.detail = args.detail;
    this.reason = args.reason;
  }
}

/**
 * For boundary callers where a no-op outcome is a real error (e.g. a 4xx
 * response): returns the updated row, or throws
 * EnvironmentLifecycleEventNotAppliedError.
 */
export function requireEnvironmentLifecycleEventApplied(
  outcome: ApplyEnvironmentLifecycleEventOutcome,
) {
  if (!outcome.applied) {
    throw new EnvironmentLifecycleEventNotAppliedError(outcome);
  }
  return outcome.environment;
}

function applyEnvironmentLifecycleEventRecord(
  db: EnvironmentWriteConnection,
  args: ApplyEnvironmentLifecycleEventArgs,
): ApplyEnvironmentLifecycleEventOutcome {
  const environment = getEnvironment(db, args.environmentId);
  if (!environment) {
    return {
      applied: false,
      detail: `environment not found: ${args.environmentId}`,
      reason: "not-found",
    };
  }

  const evaluation = evaluateEnvironmentLifecycleEvent({
    environment,
    event: args.event,
  });
  if ("noop" in evaluation) {
    return {
      applied: false,
      detail: evaluation.detail,
      reason: evaluation.noop,
    };
  }

  const set: Partial<typeof environments.$inferInsert> = {
    status: evaluation.to,
    updatedAt: Date.now(),
  };
  if (args.event.type === "destroy.started") {
    set.destroyAttemptId = args.event.destroyAttemptId;
  }
  if (args.event.type === "destroy.failed" || args.event.type === "destroy.lost") {
    set.destroyAttemptId = null;
  }
  if (evaluation.to === "destroyed") {
    set.destroyAttemptId = null;
  }

  // Compare-and-set on the loaded status: belt-and-braces under
  // better-sqlite3's synchronous transactions, and the contract that survives
  // any future executor change. The destroy claim additionally re-asserts the
  // cross-table thread conditions the row cannot express, atomically with the
  // status write.
  const conditions = [
    eq(environments.id, args.environmentId),
    eq(environments.status, environment.status),
  ];
  if (args.event.type === "destroy.started") {
    conditions.push(
      sql`NOT EXISTS (
        SELECT 1 FROM threads
        WHERE threads.environment_id = ${environments.id}
        AND threads.archived_at IS NULL
        AND threads.deleted_at IS NULL
      )`,
      sql`NOT EXISTS (
        SELECT 1 FROM threads
        WHERE threads.environment_id = ${environments.id}
        AND threads.status = 'stopping'
      )`,
    );
  }

  const updated = db
    .update(environments)
    .set(set)
    .where(and(...conditions))
    .returning()
    .get();
  if (!updated) {
    return {
      applied: false,
      detail: `state changed while applying ${args.event.type} from status ${environment.status}`,
      reason: "cas-conflict",
    };
  }

  return { applied: true, changes: ["status-changed"], environment: updated };
}

/**
 * Single writer for environment lifecycle events: loads the row, evaluates
 * the event against ENVIRONMENT_LIFECYCLE and its supersession predicates,
 * applies the transition with a status compare-and-set, and stamps or clears
 * destroyAttemptId on start/settlement — all in one transaction. Never throws on stale or
 * illegal events; returns a typed outcome for the caller to log. Use
 * applyEnvironmentLifecycleEventInTransaction from inside an existing
 * transaction (the caller then owns notification of `outcome.changes`).
 */
export function applyEnvironmentLifecycleEvent(
  db: DbConnection,
  notifier: DbNotifier,
  args: ApplyEnvironmentLifecycleEventArgs,
): ApplyEnvironmentLifecycleEventOutcome {
  const outcome = db.transaction(
    (tx) => applyEnvironmentLifecycleEventRecord(tx, args),
    { behavior: "immediate" },
  );
  if (outcome.applied) {
    notifier.notifyEnvironment(args.environmentId, outcome.changes);
  }
  return outcome;
}

export function applyEnvironmentLifecycleEventInTransaction(
  tx: DbTransaction,
  args: ApplyEnvironmentLifecycleEventArgs,
): ApplyEnvironmentLifecycleEventOutcome {
  return applyEnvironmentLifecycleEventRecord(tx, args);
}
