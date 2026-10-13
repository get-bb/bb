import {
  getHost,
  listHostsByIds,
  type DbConnection,
  type EnvironmentRow,
} from "@bb/db";
import {
  resolveEnvironmentHostLifecycle,
  type Environment,
  type EnvironmentHostLifecycle,
  type EnvironmentWorkspaceDisplayKind,
  type WorkspaceProvisionType,
} from "@bb/domain";
import { DEFAULT_ENVIRONMENT_PROVIDER_ID } from "./environment-provider-ids.js";

const DEPRECATED_WORKSPACE_PROVISION_TYPE_BY_PROVIDER_ID = new Map<
  string,
  WorkspaceProvisionType
>([
  [DEFAULT_ENVIRONMENT_PROVIDER_ID.gitWorktree, "managed-worktree"],
  [DEFAULT_ENVIRONMENT_PROVIDER_ID.personalWorkspace, "personal"],
  [DEFAULT_ENVIRONMENT_PROVIDER_ID.projectCheckout, "unmanaged"],
]);

export interface EnvironmentWorkspaceDisplayKindSource {
  environmentProviderId: string | null;
  isWorktree: boolean | null;
}

export function resolveDeprecatedWorkspaceProvisionType(
  environmentProviderId: string | null,
): WorkspaceProvisionType | null {
  if (environmentProviderId === null) {
    return null;
  }
  return (
    DEPRECATED_WORKSPACE_PROVISION_TYPE_BY_PROVIDER_ID.get(
      environmentProviderId,
    ) ?? null
  );
}

export function resolveEnvironmentWorkspaceDisplayKind(
  source: EnvironmentWorkspaceDisplayKindSource,
): EnvironmentWorkspaceDisplayKind {
  if (
    resolveDeprecatedWorkspaceProvisionType(source.environmentProviderId) ===
    "managed-worktree"
  ) {
    return "managed-worktree";
  }
  if (source.isWorktree) {
    return "unmanaged-worktree";
  }
  return "other";
}

export function toEnvironmentResponse(
  db: DbConnection,
  row: EnvironmentRow,
): Environment {
  return toEnvironmentResponseWithHostLifecycle(
    row,
    resolveEnvironmentHostLifecycle(getHost(db, row.hostId)),
  );
}

export function toEnvironmentResponses(
  db: DbConnection,
  rows: readonly EnvironmentRow[],
): Environment[] {
  const hostById = new Map(
    listHostsByIds(db, [...new Set(rows.map((row) => row.hostId))]).map(
      (host) => [host.id, host],
    ),
  );
  return rows.map((row) =>
    toEnvironmentResponseWithHostLifecycle(
      row,
      resolveEnvironmentHostLifecycle(hostById.get(row.hostId) ?? null),
    ),
  );
}

function toEnvironmentResponseWithHostLifecycle(
  row: EnvironmentRow,
  hostLifecycle: EnvironmentHostLifecycle,
): Environment {
  return {
    id: row.id,
    name: row.name,
    projectId: row.projectId,
    hostId: row.hostId,
    path: row.path,
    isGitRepo: row.isGitRepo,
    isWorktree: row.isWorktree,
    branchName: row.branchName,
    baseBranch: row.baseBranch,
    defaultBranch: row.defaultBranch,
    mergeBaseBranch: row.mergeBaseBranch,
    status: row.status,
    environmentProviderId: row.environmentProviderId,
    lifecycle: {
      phase:
        row.status === "destroyed"
          ? "destroyed"
          : row.teardownStatus !== null
            ? "teardown"
            : row.retireAt !== null
              ? "retiring"
              : "active",
      retireAt: row.retireAt,
      teardown:
        row.teardownStatus === null
          ? null
          : {
              status: row.teardownStatus,
              attempt: row.teardownAttempt,
              ...(row.teardownMessage === null
                ? {}
                : { message: row.teardownMessage }),
            },
    },
    hostLifecycle,
    environmentProviderSelection: row.environmentProviderSelection,
    environmentProviderInstanceKey: row.environmentProviderInstanceKey,
    managed: row.providerOwnsPath,
    workspaceProvisionType: resolveDeprecatedWorkspaceProvisionType(
      row.environmentProviderId,
    ),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
