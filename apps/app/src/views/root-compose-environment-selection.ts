import {
  findLocalPathProjectSourceForHost,
  type ProjectSource,
  type ThreadListEntry,
} from "@bb/domain";
import type {
  ProjectBranchesResponse,
  ProjectWorktree,
  ProjectWorktreeFailure,
  SystemProvidersQuery,
} from "@bb/server-contract";
import {
  encodeHostValue,
  encodeReuseValue,
  encodeWorktreePathValue,
  parseEnvironmentValue,
  REUSE_VALUE_WITHOUT_ENVIRONMENT,
} from "@/components/pickers/environment-picker-value";
import type {
  WorktreeDiscoveryFailure,
  WorktreeOption,
} from "@/components/pickers/WorktreePicker";
import { getThreadDisplayTitle } from "@/lib/thread-title";

interface ResolveRootComposeEffectiveEnvironmentValueArgs {
  environmentSelectionValue: string;
  isProjectless: boolean;
  knownHostIds: ReadonlySet<string>;
  primaryHostId: string | null;
  projectSources: readonly ProjectSource[];
  worktreeOptions: readonly WorktreeOption[];
  worktreeOptionsLoading: boolean;
  /** At least one machine's discovery failed; keep reuse mode inspectable. */
  hasWorktreeDiscoveryFailures: boolean;
}

const PROJECT_SOURCE_NOT_GIT_WORKTREE_DISABLED_REASON =
  "New worktrees require a Git repository with at least one commit";
const PROJECT_SOURCE_NO_COMMITS_WORKTREE_DISABLED_REASON =
  "Project source has no commits. Create an initial commit before creating a worktree";

export interface WorktreeOptionsModel {
  options: WorktreeOption[];
  failures: WorktreeDiscoveryFailure[];
}

interface BuildWorktreeOptionsArgs {
  worktrees: readonly ProjectWorktree[];
  failures: readonly ProjectWorktreeFailure[];
  threads: readonly ThreadListEntry[];
  hostNameById: ReadonlyMap<string, string> | null;
}

export function buildWorktreeOptions(
  args: BuildWorktreeOptionsArgs,
): WorktreeOptionsModel {
  const threadsByEnvironmentId = new Map<string, ThreadListEntry[]>();
  for (const thread of args.threads) {
    if (thread.environmentId === null) continue;
    const bucket = threadsByEnvironmentId.get(thread.environmentId);
    if (bucket) {
      bucket.push(thread);
    } else {
      threadsByEnvironmentId.set(thread.environmentId, [thread]);
    }
  }
  for (const bucket of threadsByEnvironmentId.values()) {
    bucket.sort(
      (left, right) => right.latestAttentionAt - left.latestAttentionAt,
    );
  }

  const hostName = (hostId: string): string | null =>
    args.hostNameById === null ? null : (args.hostNameById.get(hostId) ?? null);

  const options = args.worktrees.map((worktree): WorktreeOption => {
    const availability = worktree.availability;
    const selectable = availability.kind === "selectable";
    const value =
      worktree.environmentId !== null
        ? encodeReuseValue(worktree.environmentId)
        : availability.kind === "selectable"
          ? encodeWorktreePathValue(worktree.hostId, availability.canonicalPath)
          : null;
    const threads =
      worktree.environmentId !== null
        ? (threadsByEnvironmentId.get(worktree.environmentId) ?? [])
        : [];
    return {
      value: selectable ? value : null,
      environmentId: worktree.environmentId,
      hostId: worktree.hostId,
      hostName: hostName(worktree.hostId),
      name: worktree.environmentName,
      checkout: worktree.checkout,
      displayPath: worktree.path,
      availability:
        availability.kind === "selectable" ? "selectable" : availability.reason,
      lock: worktree.lock,
      ownership: worktree.ownership,
      threads: threads.map((thread) => ({
        id: thread.id,
        title: getThreadDisplayTitle(thread),
      })),
    };
  });

  return {
    options,
    failures: args.failures.map((failure) => ({
      hostId: failure.hostId,
      hostName: hostName(failure.hostId),
      message:
        failure.code === "host_offline"
          ? "Machine is offline"
          : failure.message,
    })),
  };
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
  worktreeOptions,
  worktreeOptionsLoading,
  hasWorktreeDiscoveryFailures,
}: ResolveRootComposeEffectiveEnvironmentValueArgs): string {
  if (!primaryHostId) {
    return "";
  }

  const parsedSelection = parseEnvironmentValue(environmentSelectionValue);

  if (
    parsedSelection?.type === "host" &&
    knownHostIds.has(parsedSelection.hostId)
  ) {
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
      return worktreeOptionsLoading ||
        worktreeOptions.length > 0 ||
        hasWorktreeDiscoveryFailures
        ? environmentSelectionValue
        : fallbackHostValue;
    }

    if (worktreeOptionsLoading) {
      return REUSE_VALUE_WITHOUT_ENVIRONMENT;
    }

    // A refresh that removed or disabled the selected row clears the choice
    // and keeps the picker in reuse mode: silently retargeting the thread at
    // "Work locally" would run it somewhere the user never picked.
    return worktreeOptions.some(
      (option) =>
        option.environmentId === parsedSelection.environmentId &&
        option.value !== null,
    )
      ? environmentSelectionValue
      : REUSE_VALUE_WITHOUT_ENVIRONMENT;
  }

  if (parsedSelection?.type === "worktree-path") {
    if (worktreeOptionsLoading) {
      return environmentSelectionValue;
    }
    return worktreeOptions.some(
      (option) =>
        option.value !== null && option.value === environmentSelectionValue,
    )
      ? environmentSelectionValue
      : REUSE_VALUE_WITHOUT_ENVIRONMENT;
  }

  if (!canUseHostWorkspace) {
    return "";
  }

  if (parsedSelection?.type === "host") {
    return encodeHostValue(primaryHostId, parsedSelection.mode);
  }

  return fallbackHostValue;
}

export function resolveComposeHostId(
  parsedEnvironment: ReturnType<typeof parseEnvironmentValue>,
  primaryHostId: string | null,
): string | null {
  if (
    parsedEnvironment?.type === "host" ||
    parsedEnvironment?.type === "worktree-path"
  ) {
    return parsedEnvironment.hostId;
  }
  return primaryHostId;
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
  if (parsed?.type === "host" || parsed?.type === "worktree-path") {
    return { hostId: parsed.hostId };
  }
  if (parsed?.type === "reuse" && parsed.environmentId !== null) {
    return { environmentId: parsed.environmentId };
  }
  return {};
}
