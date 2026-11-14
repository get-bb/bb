import { and, eq } from "drizzle-orm";
import type {
  DiscoveredWorkspaceProperties,
  EnvironmentChangeKind,
  EnvironmentLifecycleEvent,
  EnvironmentLifecycleNoopReason,
} from "@bb/domain";
import { evaluateEnvironmentLifecycleEvent } from "@bb/domain";
import type { DbConnection, DbTransaction } from "../connection.js";
import type { DbNotifier } from "../notifier.js";
import { environments } from "../schema.js";
import { getEnvironment } from "./environments.js";
import type { EnvironmentRow } from "./environments.js";

type EnvironmentWriteConnection = DbConnection | DbTransaction;

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
    .set({
      ...metadata,
      updatedAt: Date.now(),
    })
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

export interface UpdateEnvironmentMetadataInput {
  mergeBaseBranch?: string | null;
  name?: string | null;
}

export interface RecordEnvironmentCurrentBranchInput {
  branchName: string | null;
}

export function updateEnvironmentMetadata(
  db: EnvironmentWriteConnection,
  notifier: DbNotifier,
  id: string,
  input: UpdateEnvironmentMetadataInput,
) {
  return updateEnvironmentMetadataRecord(db, notifier, id, input);
}

export function recordEnvironmentCurrentBranch(
  db: EnvironmentWriteConnection,
  notifier: DbNotifier,
  id: string,
  input: RecordEnvironmentCurrentBranchInput,
) {
  return updateEnvironmentMetadataRecord(db, notifier, id, {
    branchName: input.branchName,
  });
}

export interface RecordProvisionedEnvironmentWorkspaceInput extends DiscoveredWorkspaceProperties {
  baseBranch?: string | null;
  mergeBaseBranch?: string | null;
}

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

export function applyEnvironmentLifecycleEventInTransaction(
  db: DbTransaction,
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

  const now = Date.now();
  const set: Partial<typeof environments.$inferInsert> = {
    status: evaluation.to,
    updatedAt: now,
  };
  if (evaluation.to === "destroyed") {
    set.path = null;
  }

  const updated = db
    .update(environments)
    .set(set)
    .where(
      and(
        eq(environments.id, args.environmentId),
        eq(environments.status, environment.status),
      ),
    )
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

export function applyEnvironmentLifecycleEvent(
  db: DbConnection,
  notifier: DbNotifier,
  args: ApplyEnvironmentLifecycleEventArgs,
): ApplyEnvironmentLifecycleEventOutcome {
  const outcome = db.transaction(
    (tx) => applyEnvironmentLifecycleEventInTransaction(tx, args),
    { behavior: "immediate" },
  );
  if (outcome.applied) {
    notifier.notifyEnvironment(args.environmentId, outcome.changes);
  }
  return outcome;
}
