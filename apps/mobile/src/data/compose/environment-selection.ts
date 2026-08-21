import {
  findLocalPathProjectSourceForHost,
  PERSONAL_PROJECT_ID,
  type ProjectSource,
  type ThreadListEntry,
} from "@bb/domain";
import type {
  BaseBranchSpec,
  CreateThreadEnvironmentArgs,
  ProjectBranchesResponse,
} from "@bb/server-contract";
import { getThreadDisplayTitle } from "../threads/thread-title";

/**
 * Environment selection for a new thread as the mobile compose screen holds
 * it — a typed value rather than the web app's `host:<id>:<mode>` picker
 * strings (apps/app/src/components/pickers/environment-picker-value.ts) —
 * plus the resolvers that turn it into `CreateThreadRequest.environment`
 * (mirrors views/root-compose-environment-selection.ts and
 * root-compose-thread-environment.ts).
 */

export interface BranchSelection {
  name: string;
  /** Create `name` from the current checkout instead of switching to it. */
  isNew: boolean;
}

export type ThreadWorkspaceSelection =
  | {
      type: "unmanaged";
      /** Null: the project source's own checkout path. */
      path: string | null;
      branch: BranchSelection | null;
    }
  | {
      type: "managed-worktree";
      /** Null: the server's default worktree base branch. */
      baseBranch: string | null;
    }
  | { type: "personal" };

export type ThreadEnvironmentSelection =
  | { type: "project-default" }
  | {
      type: "reuse";
      /** Null while the user has picked Reuse but not yet a worktree. */
      environmentId: string | null;
    }
  | { type: "host"; hostId: string; workspace: ThreadWorkspaceSelection };

export const PROJECT_DEFAULT_ENVIRONMENT: ThreadEnvironmentSelection = {
  type: "project-default",
};

/** One worktree the user can reuse, described by the threads it holds. */
export interface ReuseEnvironmentOption {
  environmentId: string;
  branchName: string | null;
  name: string | null;
  /** Machine name; only set when a host map is supplied (several machines). */
  hostName: string | null;
  /** Threads in this worktree, most recently active first. */
  threads: ReadonlyArray<{ id: string; title: string }>;
}

function isWorktreeWithEnvironment(thread: ThreadListEntry): boolean {
  if (thread.environmentId === null) return false;
  return (
    thread.environmentWorkspaceDisplayKind === "managed-worktree" ||
    thread.environmentWorkspaceDisplayKind === "unmanaged-worktree"
  );
}

/**
 * One option per worktree environment among the given (unarchived) threads.
 * Environments with no live thread naturally drop out. Sorted by label.
 */
export function buildReuseEnvironmentOptions(
  threads: readonly ThreadListEntry[],
  hostNameById: ReadonlyMap<string, string> | null = null,
): ReuseEnvironmentOption[] {
  const buckets = new Map<
    string,
    { threads: ThreadListEntry[]; first: ThreadListEntry }
  >();
  for (const thread of threads) {
    if (!isWorktreeWithEnvironment(thread) || thread.environmentId === null) {
      continue;
    }
    const bucket = buckets.get(thread.environmentId);
    if (bucket) bucket.threads.push(thread);
    else
      buckets.set(thread.environmentId, { threads: [thread], first: thread });
  }
  const options: ReuseEnvironmentOption[] = [];
  for (const [environmentId, bucket] of buckets) {
    bucket.threads.sort(
      (left, right) => right.latestAttentionAt - left.latestAttentionAt,
    );
    const hostId = bucket.first.environmentHostId;
    options.push({
      environmentId,
      branchName: bucket.first.environmentBranchName,
      name: bucket.first.environmentName,
      hostName:
        hostNameById !== null && hostId !== null
          ? (hostNameById.get(hostId) ?? null)
          : null,
      threads: bucket.threads.map((thread) => ({
        id: thread.id,
        title: getThreadDisplayTitle(thread),
      })),
    });
  }
  options.sort((left, right) => {
    const leftLabel = left.name ?? left.branchName;
    const rightLabel = right.name ?? right.branchName;
    if (leftLabel && rightLabel) return leftLabel.localeCompare(rightLabel);
    return left.environmentId.localeCompare(right.environmentId);
  });
  return options;
}

export interface ResolveEffectiveEnvironmentSelectionArgs {
  selection: ThreadEnvironmentSelection;
  projectId: string;
  /** Ids of every host the server lists. */
  knownHostIds: ReadonlySet<string>;
  projectSources: readonly ProjectSource[];
  reuseOptions: readonly ReuseEnvironmentOption[];
  reuseOptionsLoading: boolean;
}

/**
 * Keep a selection only while it is still actionable: a host selection needs
 * a known host with a project source (any host works for the personal
 * project, whose threads run in the machine's personal workspace); a reuse
 * selection needs its worktree to still exist. Anything else falls back to
 * the server-resolved project default.
 */
export function resolveEffectiveEnvironmentSelection({
  selection,
  projectId,
  knownHostIds,
  projectSources,
  reuseOptions,
  reuseOptionsLoading,
}: ResolveEffectiveEnvironmentSelectionArgs): ThreadEnvironmentSelection {
  const isPersonal = projectId === PERSONAL_PROJECT_ID;
  switch (selection.type) {
    case "project-default":
      return selection;
    case "host": {
      if (!knownHostIds.has(selection.hostId))
        return PROJECT_DEFAULT_ENVIRONMENT;
      if (isPersonal) {
        return selection.workspace.type === "personal"
          ? selection
          : { ...selection, workspace: { type: "personal" } };
      }
      if (selection.workspace.type === "personal") {
        return PROJECT_DEFAULT_ENVIRONMENT;
      }
      return findLocalPathProjectSourceForHost(projectSources, selection.hostId)
        ? selection
        : PROJECT_DEFAULT_ENVIRONMENT;
    }
    case "reuse": {
      if (isPersonal) return PROJECT_DEFAULT_ENVIRONMENT;
      if (selection.environmentId === null) {
        return reuseOptionsLoading || reuseOptions.length > 0
          ? selection
          : PROJECT_DEFAULT_ENVIRONMENT;
      }
      if (reuseOptionsLoading) return { type: "reuse", environmentId: null };
      return reuseOptions.some(
        (option) => option.environmentId === selection.environmentId,
      )
        ? selection
        : PROJECT_DEFAULT_ENVIRONMENT;
    }
  }
}

export type ExecutionOptionsRoutingArgs =
  | { environmentId: string }
  | { hostId: string }
  | Record<string, never>;

/**
 * Where to probe providers/models for a selection: the reused environment's
 * host, the explicit host, or (project default) the primary host.
 */
export function resolveExecutionOptionsRouting(
  selection: ThreadEnvironmentSelection,
): ExecutionOptionsRoutingArgs {
  if (selection.type === "host") return { hostId: selection.hostId };
  if (selection.type === "reuse" && selection.environmentId !== null) {
    return { environmentId: selection.environmentId };
  }
  return {};
}

/** The machine the thread will run on, when the selection names one. */
export function resolveSelectedHostId(
  selection: ThreadEnvironmentSelection,
  primaryHostId: string | null,
): string | null {
  return selection.type === "host" ? selection.hostId : primaryHostId;
}

const PROJECT_SOURCE_NOT_GIT_WORKTREE_DISABLED_REASON =
  "New worktrees require a Git repository with at least one commit";
const PROJECT_SOURCE_NO_COMMITS_WORKTREE_DISABLED_REASON =
  "Project source has no commits. Create an initial commit before creating a worktree";

/** Why "New worktree" is unavailable for a checkout, or null when it is fine. */
export function resolveWorktreeDisabledReason(
  branches: Pick<ProjectBranchesResponse, "checkout"> | undefined,
): string | null {
  switch (branches?.checkout.kind) {
    case "unknown":
      return PROJECT_SOURCE_NOT_GIT_WORKTREE_DISABLED_REASON;
    case "unborn":
      return PROJECT_SOURCE_NO_COMMITS_WORKTREE_DISABLED_REASON;
    case "branch":
    case "detached":
    case undefined:
      return null;
  }
}

export interface ResolveThreadEnvironmentArgsInput {
  selection: ThreadEnvironmentSelection;
  projectId: string;
  /** From `useProjectBranches` for the selected host (managed-worktree base). */
  defaultBranch?: string | null;
  defaultWorktreeBaseBranch?: string | null;
}

function resolveManagedBaseBranch(
  baseBranch: string | null,
  defaultBranch: string | null | undefined,
  defaultWorktreeBaseBranch: string | null | undefined,
): BaseBranchSpec {
  if (baseBranch !== null) return { kind: "named", name: baseBranch };
  if (
    defaultWorktreeBaseBranch &&
    defaultWorktreeBaseBranch !== defaultBranch
  ) {
    return { kind: "named", name: defaultWorktreeBaseBranch };
  }
  return { kind: "default" };
}

/**
 * The `environment` field of `POST /threads` for a selection, or null when
 * the selection is incomplete (reuse without a worktree). Personal-project
 * threads always run in the personal workspace of the chosen host.
 */
export function resolveThreadEnvironmentArgs({
  selection,
  projectId,
  defaultBranch,
  defaultWorktreeBaseBranch,
}: ResolveThreadEnvironmentArgsInput): CreateThreadEnvironmentArgs | null {
  switch (selection.type) {
    case "project-default":
      return { type: "project-default" };
    case "reuse":
      return selection.environmentId === null
        ? null
        : { type: "reuse", environmentId: selection.environmentId };
    case "host": {
      if (projectId === PERSONAL_PROJECT_ID) {
        return {
          type: "host",
          hostId: selection.hostId,
          workspace: { type: "personal" },
        };
      }
      const { workspace } = selection;
      switch (workspace.type) {
        case "personal":
          return {
            type: "host",
            hostId: selection.hostId,
            workspace: { type: "personal" },
          };
        case "managed-worktree":
          return {
            type: "host",
            hostId: selection.hostId,
            workspace: {
              type: "managed-worktree",
              baseBranch: resolveManagedBaseBranch(
                workspace.baseBranch,
                defaultBranch,
                defaultWorktreeBaseBranch,
              ),
            },
          };
        case "unmanaged":
          return {
            type: "host",
            hostId: selection.hostId,
            workspace: {
              type: "unmanaged",
              path: workspace.path,
              ...(workspace.branch
                ? {
                    branch: workspace.branch.isNew
                      ? { kind: "new", baseBranch: workspace.branch.name }
                      : { kind: "existing", name: workspace.branch.name },
                  }
                : {}),
            },
          };
      }
    }
  }
}
