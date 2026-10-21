import path from "node:path";
import type {
  GitBranchRefClassification,
  GitBranchOptions,
  GitSourceInspection,
  WorkspaceGitOperation,
} from "bb-git-contract";
import {
  detectGitRepoKind,
  detectLinkedWorktree,
  fetchRemoteBranches,
  getCheckoutRef,
  getGitCommonDir,
  getWorkspaceGitOperation,
  hasUncommittedChanges,
  listBranchRefsWithDefaults,
  readDefaultBranchRefs,
  type GitProcessOptions,
  WorkspaceError,
} from "./git.js";
import { withGitRefMutationLock } from "bb-environment-provider-host/process-local-lock";

interface BranchOptionsArgs extends GitProcessOptions {
  path: string;
  query?: string;
  selectedBranch?: string;
  limit: number;
  remoteRefresh: "background" | "none";
}
interface GitSourceArgs extends GitProcessOptions {
  path: string;
  remoteRefresh: "background" | "blocking";
}

interface LimitBranchListArgs {
  branches: readonly string[];
  limit: number;
  query?: string;
}

interface LimitedBranchList {
  branches: string[];
  truncated: boolean;
}

interface PinBranchArgs {
  branches: readonly string[];
  branch: string | undefined;
}

interface ClassifySelectedBranchArgs {
  branches: readonly string[];
  remoteBranches: readonly string[];
  selectedBranch?: string;
}

interface ReadBranchOptionsArgs extends GitProcessOptions {
  path: string;
  limit: number;
  query?: string;
  selectedBranch?: string;
}

const REMOTE_BRANCH_FETCH_THROTTLE_MS = 30_000;
const REMOTE_BRANCH_FETCH_TIMEOUT_MS = 5_000;
const NO_GIT_OPERATION: WorkspaceGitOperation = { kind: "none" };

type RemoteRefreshMode = "background" | "blocking";

const remoteBranchFetchStateByCommonDir = new Map<
  string,
  {
    fetchedAt: number;
    inFlight: Promise<void> | null;
    needsInteractiveRetry: boolean;
  }
>();

function limitBranchList({
  branches,
  limit,
  query,
}: LimitBranchListArgs): LimitedBranchList {
  const normalizedQuery = query?.trim().toLowerCase();
  const filteredBranches =
    normalizedQuery && normalizedQuery.length > 0
      ? branches.filter((branch) =>
          branch.toLowerCase().includes(normalizedQuery),
        )
      : [...branches];
  return {
    branches: filteredBranches.slice(0, limit),
    truncated: filteredBranches.length > limit,
  };
}

function pinBranch({ branches, branch }: PinBranchArgs): string[] {
  if (!branch || !branches.includes(branch)) {
    return [...branches];
  }

  return [branch, ...branches.filter((candidate) => candidate !== branch)];
}

function classifySelectedBranch({
  branches,
  remoteBranches,
  selectedBranch,
}: ClassifySelectedBranchArgs): GitBranchRefClassification | null {
  if (!selectedBranch) {
    return null;
  }

  if (branches.includes(selectedBranch)) {
    return { name: selectedBranch, kind: "local" };
  }

  if (remoteBranches.includes(selectedBranch)) {
    return { name: selectedBranch, kind: "remote" };
  }

  return { name: selectedBranch, kind: "missing" };
}

async function refreshRemoteBranches(
  cwd: string,
  options: GitProcessOptions,
  mode: RemoteRefreshMode,
): Promise<void> {
  const commonDir = await getGitCommonDir(cwd, options);
  const interactive = mode === "blocking";
  const existingState = remoteBranchFetchStateByCommonDir.get(commonDir);
  if (existingState?.inFlight) {
    await existingState.inFlight;
  }

  const settledState = remoteBranchFetchStateByCommonDir.get(commonDir);
  if (settledState?.inFlight) {
    await settledState.inFlight;
    return;
  }
  const throttled =
    settledState !== undefined &&
    Date.now() - settledState.fetchedAt < REMOTE_BRANCH_FETCH_THROTTLE_MS;
  if (throttled && !(interactive && settledState.needsInteractiveRetry)) {
    return;
  }

  const refreshDeadline = Date.now() + REMOTE_BRANCH_FETCH_TIMEOUT_MS;
  const inFlight = withGitRefMutationLock(
    commonDir,
    () => {
      const remainingTimeoutMs = Math.max(1, refreshDeadline - Date.now());
      return fetchRemoteBranches(cwd, {
        ...options,
        interactive,
        timeoutMs: remainingTimeoutMs,
      });
    },
    { timeoutMs: REMOTE_BRANCH_FETCH_TIMEOUT_MS, signal: options.signal },
  )
    .then(
      (result) => !interactive && result.status === "failed",
      () => false,
    )
    .then((needsInteractiveRetry) => {
      remoteBranchFetchStateByCommonDir.set(commonDir, {
        fetchedAt: Date.now(),
        inFlight: null,
        needsInteractiveRetry,
      });
    });

  remoteBranchFetchStateByCommonDir.set(commonDir, {
    fetchedAt: Date.now(),
    inFlight,
    needsInteractiveRetry: false,
  });

  await inFlight;
}

async function readBranchOptions({
  path: cwd,
  limit,
  query,
  selectedBranch: requestedBranch,
  ...gitProcessOptions
}: ReadBranchOptionsArgs): Promise<GitBranchOptions> {
  const { branches, defaultBranch, originDefaultBranch, remoteBranches } =
    await listBranchRefsWithDefaults(cwd, gitProcessOptions);
  const limitedBranches = limitBranchList({
    branches: pinBranch({ branches, branch: defaultBranch }),
    limit,
    query,
  });
  const limitedRemoteBranches = limitBranchList({
    branches: pinBranch({
      branches: remoteBranches,
      branch: originDefaultBranch,
    }),
    limit,
    query,
  });
  return {
    branches: limitedBranches.branches,
    branchesTruncated: limitedBranches.truncated,
    remoteBranches: limitedRemoteBranches.branches,
    remoteBranchesTruncated: limitedRemoteBranches.truncated,
    selectedBranch: classifySelectedBranch({
      branches,
      remoteBranches,
      selectedBranch: requestedBranch,
    }),
  };
}

export async function listWorkspaceBranchOptions(
  { shellPath, signal, priority, ...command }: BranchOptionsArgs,
  background?: {
    signal: AbortSignal;
    onStart(work: Promise<void>): void;
  },
): Promise<GitBranchOptions> {
  if (!path.isAbsolute(command.path)) {
    throw new WorkspaceError("invalid_path", "Path must be absolute");
  }

  const gitProcessOptions = { shellPath, signal, priority };
  if ((await detectGitRepoKind(command.path, gitProcessOptions)) === "none") {
    return {
      branches: [],
      branchesTruncated: false,
      remoteBranches: [],
      remoteBranchesTruncated: false,
      selectedBranch: classifySelectedBranch({
        branches: [],
        remoteBranches: [],
        selectedBranch: command.selectedBranch,
      }),
    };
  }

  if (
    command.remoteRefresh === "background" &&
    background?.signal.aborted !== true
  ) {
    const work = refreshRemoteBranches(
      command.path,
      background
        ? { ...gitProcessOptions, signal: background.signal }
        : gitProcessOptions,
      "background",
    ).catch(() => undefined);
    background?.onStart(work);
  }

  return readBranchOptions({ ...command, ...gitProcessOptions });
}

export async function inspectWorkspaceGitSource({
  shellPath,
  ...command
}: GitSourceArgs): Promise<GitSourceInspection> {
  if (!path.isAbsolute(command.path)) {
    throw new WorkspaceError("invalid_path", "Path must be absolute");
  }

  const gitProcessOptions = shellPath === undefined ? {} : { shellPath };
  const repoKind = await detectGitRepoKind(command.path, gitProcessOptions);
  if (repoKind === "none") {
    return {
      checkout: { kind: "unknown", reason: "Path is not a git repository" },
      defaultBranch: null,
      defaultBranchRelation: null,
      isWorktree: false,
      hasUncommittedChanges: false,
      operation: { kind: "none" },
      originDefaultBranch: null,
    };
  }

  if (command.remoteRefresh === "blocking") {
    await refreshRemoteBranches(command.path, gitProcessOptions, "blocking");
  } else {
    void refreshRemoteBranches(
      command.path,
      gitProcessOptions,
      "background",
    ).catch(() => undefined);
  }

  const [checkout, defaultRefs, dirty, operation, isWorktree] =
    await Promise.all([
      getCheckoutRef(command.path, gitProcessOptions),
      readDefaultBranchRefs(command.path, gitProcessOptions),
      repoKind === "work-tree"
        ? hasUncommittedChanges(command.path, gitProcessOptions)
        : false,
      repoKind === "work-tree"
        ? getWorkspaceGitOperation(command.path, gitProcessOptions)
        : NO_GIT_OPERATION,
      repoKind === "work-tree"
        ? detectLinkedWorktree(command.path, gitProcessOptions)
        : false,
    ]);
  const defaultBranch = defaultRefs.defaultBranch;
  const originDefaultBranch = defaultRefs.originDefaultBranch;
  return {
    checkout,
    defaultBranch: defaultBranch ?? null,
    defaultBranchRelation: defaultRefs.defaultBranchRelation ?? null,
    isWorktree,
    hasUncommittedChanges: dirty,
    operation,
    originDefaultBranch: originDefaultBranch ?? null,
  };
}
