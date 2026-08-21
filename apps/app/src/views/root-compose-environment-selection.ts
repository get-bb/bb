import {
  findLocalPathProjectSourceForHost,
  type ProjectSource,
  type ThreadListEntry,
} from "@bb/domain";
import type {
  ProjectBranchesResponse,
  SystemProvidersQuery,
} from "@bb/server-contract";
import {
  encodeHostValue,
  parseEnvironmentValue,
  REUSE_VALUE_WITHOUT_ENVIRONMENT,
} from "@/components/pickers/environment-picker-value";
import type { ReuseThreadOption } from "@/components/pickers/WorktreePicker";
import { getThreadDisplayTitle } from "@/lib/thread-title";

/**
 * Pure environment-selection resolvers shared by every new-thread compose
 * surface: `RootComposeView` (the primary one) and `PluginNewThreadComposer`
 * (the SDK's `experimental_NewThreadComposer`). They take plain data and
 * return plain data, so both surfaces resolve a picker selection into a
 * create-thread environment the same way.
 */

interface ResolveRootComposeEffectiveEnvironmentValueArgs {
  environmentSelectionValue: string;
  isProjectless: boolean;
  /** Ids of all hosts known to the server. */
  knownHostIds: ReadonlySet<string>;
  primaryHostId: string | null;
  projectSources: readonly ProjectSource[];
  reuseThreadOptions: readonly ReuseThreadOption[];
  reuseThreadOptionsLoading: boolean;
}

const PROJECT_SOURCE_NOT_GIT_WORKTREE_DISABLED_REASON =
  "New worktrees require a Git repository with at least one commit";
const PROJECT_SOURCE_NO_COMMITS_WORKTREE_DISABLED_REASON =
  "Project source has no commits. Create an initial commit before creating a worktree";

function isWorktreeWithEnv(thread: ThreadListEntry): boolean {
  if (thread.environmentId === null) return false;
  return (
    thread.environmentWorkspaceDisplayKind === "managed-worktree" ||
    thread.environmentWorkspaceDisplayKind === "unmanaged-worktree"
  );
}

export function buildReuseThreadOptions(
  threads: readonly ThreadListEntry[],
  /** Host id → machine name, provided only when worktree rows should carry a
   * machine hint when more than one host exists. */
  hostNameById: ReadonlyMap<string, string> | null = null,
): ReuseThreadOption[] {
  // One option per worktree env. Threads within each env are sorted
  // most-recently-active first so the picker preview surfaces the threads
  // the user is most likely to recognize. Only unarchived threads reach
  // here — `useThreads({ archived: false })` filters at the source. Envs
  // with no unarchived threads naturally drop out.
  const threadsByEnvironmentId = new Map<string, ThreadListEntry[]>();
  const branchByEnvironmentId = new Map<string, string | null>();
  const nameByEnvironmentId = new Map<string, string | null>();
  const hostIdByEnvironmentId = new Map<string, string | null>();
  for (const thread of threads) {
    if (!isWorktreeWithEnv(thread)) continue;
    if (thread.environmentId === null) continue;
    let bucket = threadsByEnvironmentId.get(thread.environmentId);
    if (!bucket) {
      bucket = [];
      threadsByEnvironmentId.set(thread.environmentId, bucket);
      branchByEnvironmentId.set(
        thread.environmentId,
        thread.environmentBranchName,
      );
      nameByEnvironmentId.set(thread.environmentId, thread.environmentName);
      hostIdByEnvironmentId.set(thread.environmentId, thread.environmentHostId);
    }
    bucket.push(thread);
  }
  const options: ReuseThreadOption[] = [];
  for (const [environmentId, bucket] of threadsByEnvironmentId) {
    bucket.sort(
      (left, right) => right.latestAttentionAt - left.latestAttentionAt,
    );
    const hostId = hostIdByEnvironmentId.get(environmentId) ?? null;
    options.push({
      environmentId,
      branchName: branchByEnvironmentId.get(environmentId) ?? null,
      name: nameByEnvironmentId.get(environmentId) ?? null,
      hostName:
        hostNameById !== null && hostId !== null
          ? (hostNameById.get(hostId) ?? null)
          : null,
      threads: bucket.map((thread) => ({
        id: thread.id,
        title: getThreadDisplayTitle(thread),
      })),
    });
  }
  options.sort((left, right) => {
    const leftLabel = left.name ?? left.branchName;
    const rightLabel = right.name ?? right.branchName;
    if (leftLabel && rightLabel) {
      return leftLabel.localeCompare(rightLabel);
    }
    return left.environmentId.localeCompare(right.environmentId);
  });
  return options;
}

export function resolveProjectSourceWorktreeDisabledReason(
  data: ProjectBranchesResponse | undefined,
): string | null {
  switch (data?.checkout.kind) {
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

export function resolveRootComposeEffectiveEnvironmentValue({
  environmentSelectionValue,
  isProjectless,
  knownHostIds,
  primaryHostId,
  projectSources,
  reuseThreadOptions,
  reuseThreadOptionsLoading,
}: ResolveRootComposeEffectiveEnvironmentValueArgs): string {
  if (!primaryHostId) {
    return "";
  }

  const parsedSelection = parseEnvironmentValue(environmentSelectionValue);

  // A host selection survives as long as that machine still exists and has
  // this project. Otherwise it falls through to the primary-host rewrite.
  if (
    parsedSelection?.type === "host" &&
    knownHostIds.has(parsedSelection.hostId)
  ) {
    // Projectless threads run in the machine's personal workspace — no
    // project source is required and there is no worktree mode to keep.
    if (isProjectless) {
      return encodeHostValue(parsedSelection.hostId, "local");
    }
    if (
      findLocalPathProjectSourceForHost(
        projectSources,
        parsedSelection.hostId,
      ) !== undefined
    ) {
      return environmentSelectionValue;
    }
  }
  const canUseHostWorkspace =
    isProjectless ||
    findLocalPathProjectSourceForHost(projectSources, primaryHostId) !==
      undefined;
  const fallbackHostValue = canUseHostWorkspace
    ? encodeHostValue(primaryHostId, "local")
    : "";

  if (isProjectless) {
    return fallbackHostValue;
  }

  if (parsedSelection?.type === "reuse") {
    if (parsedSelection.environmentId === null) {
      return reuseThreadOptionsLoading || reuseThreadOptions.length > 0
        ? environmentSelectionValue
        : fallbackHostValue;
    }

    if (reuseThreadOptionsLoading) {
      return REUSE_VALUE_WITHOUT_ENVIRONMENT;
    }

    return reuseThreadOptions.some(
      (option) => option.environmentId === parsedSelection.environmentId,
    )
      ? environmentSelectionValue
      : fallbackHostValue;
  }

  if (!canUseHostWorkspace) {
    return "";
  }

  if (parsedSelection?.type === "host") {
    return encodeHostValue(primaryHostId, parsedSelection.mode);
  }

  return fallbackHostValue;
}

/**
 * The machine the composed thread will run on: the effective selection's host
 * when it names one, otherwise the primary. Provider-CLI status, update
 * actions, and submit blocking all key off this host — the primary's CLI
 * state must not gate work targeted at another machine.
 */
export function resolveComposeHostId(
  parsedEnvironment: ReturnType<typeof parseEnvironmentValue>,
  primaryHostId: string | null,
): string | null {
  return parsedEnvironment?.type === "host"
    ? parsedEnvironment.hostId
    : primaryHostId;
}

export function resolveRootComposeProjectRouting(
  parsedEnvironment: ReturnType<typeof parseEnvironmentValue>,
  primaryHostId: string | null,
): { environmentId?: string; hostId?: string } {
  if (parsedEnvironment?.type === "reuse") {
    return parsedEnvironment.environmentId === null
      ? {}
      : { environmentId: parsedEnvironment.environmentId };
  }
  const hostId = resolveComposeHostId(parsedEnvironment, primaryHostId);
  return hostId === null ? {} : { hostId };
}

export function resolveRootComposeProviderRouting(
  args: ResolveRootComposeEffectiveEnvironmentValueArgs,
): SystemProvidersQuery {
  const parsed = parseEnvironmentValue(
    resolveRootComposeEffectiveEnvironmentValue(args),
  );
  if (parsed?.type === "host") {
    return { hostId: parsed.hostId };
  }
  if (parsed?.type === "reuse" && parsed.environmentId !== null) {
    return { environmentId: parsed.environmentId };
  }
  return {};
}
