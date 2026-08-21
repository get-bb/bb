import path from "node:path";
import type {
  GitBranchRefClassification,
  WorkspaceGitOperation,
} from "@bb/domain";
import {
  detectGitRepo,
  detectGitRepoKind,
  fetchRemoteBranches,
  getCheckoutRef,
  getGitCommonDir,
  getWorkspaceGitOperation,
  hasUncommittedChanges,
  listBranchRefsWithDefaults,
  listBranches,
  listRemoteBranches,
  readDefaultBranchRefs,
  type GitProcessOptions,
} from "@bb/host-workspace";
import type { HostDaemonOnlineRpcResult } from "@bb/host-daemon-contract";
import { CommandDispatchError } from "../command-dispatch-support.js";
import type {
  CommandDispatchOptions,
  CommandOf,
} from "../command-dispatch-support.js";
import { userExecutableProcessOptions } from "../user-executable-env.js";

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
  branch: string | null | undefined;
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

const remoteBranchFetchStateByCommonDir = new Map<
  string,
  { fetchedAt: number; inFlight: Promise<void> | null }
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
): Promise<void> {
  const commonDir = await getGitCommonDir(cwd, options);
  const now = Date.now();
  const existingState = remoteBranchFetchStateByCommonDir.get(commonDir);
  if (
    existingState &&
    now - existingState.fetchedAt < REMOTE_BRANCH_FETCH_THROTTLE_MS
  ) {
    if (existingState.inFlight) {
      await existingState.inFlight;
    }
    return;
  }

  if (existingState?.inFlight) {
    await existingState.inFlight;
    return;
  }

  const inFlight = fetchRemoteBranches(cwd, {
    timeoutMs: REMOTE_BRANCH_FETCH_TIMEOUT_MS,
    ...options,
  })
    .catch(() => undefined)
    .then(() => undefined)
    .finally(() => {
      remoteBranchFetchStateByCommonDir.set(commonDir, {
        fetchedAt: Date.now(),
        inFlight: null,
      });
    });

  remoteBranchFetchStateByCommonDir.set(commonDir, {
    fetchedAt: now,
    inFlight,
  });

  await inFlight;
}

async function readBranchOptions({
  path: cwd,
  limit,
  query,
  selectedBranch: requestedBranch,
  ...gitProcessOptions
}: ReadBranchOptionsArgs): Promise<
  HostDaemonOnlineRpcResult<"host.list_branch_options">
> {
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

export async function listHostBranchOptions(
  command: CommandOf<"host.list_branch_options">,
  options?: Pick<CommandDispatchOptions, "runtimeManager">,
): Promise<HostDaemonOnlineRpcResult<"host.list_branch_options">> {
  if (!path.isAbsolute(command.path)) {
    throw new CommandDispatchError("invalid_path", "Path must be absolute");
  }

  const gitProcessOptions = userExecutableProcessOptions(
    options?.runtimeManager.getShellEnv() ?? {},
  );
  if (!(await detectGitRepo(command.path, gitProcessOptions))) {
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

  if (command.remoteRefresh === "background") {
    // Return cached refs immediately. A successful fetch updates shared Git
    // refs, whose workspace watcher event invalidates the observed picker
    // query so the refreshed options arrive without blocking this response.
    void refreshRemoteBranches(command.path, gitProcessOptions).catch(
      () => undefined,
    );
  }

  return readBranchOptions({ ...command, ...gitProcessOptions });
}

export async function listHostBranches(
  command: CommandOf<"host.list_branches">,
  options?: Pick<CommandDispatchOptions, "runtimeManager">,
): Promise<HostDaemonOnlineRpcResult<"host.list_branches">> {
  if (!path.isAbsolute(command.path)) {
    throw new CommandDispatchError("invalid_path", "Path must be absolute");
  }

  // A project source can be a bare repository whose checkouts are sibling
  // worktrees (`<root>/.bare` + `<root>/.git` gitdir file). It has refs and
  // can seed new worktrees, but has no work tree to be dirty or mid-operation.
  const gitProcessOptions = userExecutableProcessOptions(
    options?.runtimeManager.getShellEnv() ?? {},
  );
  const repoKind = await detectGitRepoKind(command.path, gitProcessOptions);
  if (repoKind === "none") {
    return {
      branches: [],
      branchesTruncated: false,
      checkout: { kind: "unknown", reason: "Path is not a git repository" },
      defaultBranch: null,
      defaultBranchRelation: null,
      hasUncommittedChanges: false,
      operation: { kind: "none" },
      originDefaultBranch: null,
      remoteBranches: [],
      remoteBranchesTruncated: false,
      selectedBranch: classifySelectedBranch({
        branches: [],
        remoteBranches: [],
        selectedBranch: command.selectedBranch,
      }),
    };
  }

  await refreshRemoteBranches(command.path, gitProcessOptions);

  const [branches, remoteBranches, checkout, defaultRefs, dirty, operation] =
    await Promise.all([
      listBranches(command.path, gitProcessOptions),
      listRemoteBranches(command.path, gitProcessOptions),
      getCheckoutRef(command.path, gitProcessOptions),
      readDefaultBranchRefs(command.path, gitProcessOptions),
      repoKind === "work-tree"
        ? hasUncommittedChanges(command.path, gitProcessOptions)
        : false,
      repoKind === "work-tree"
        ? getWorkspaceGitOperation(command.path, gitProcessOptions)
        : NO_GIT_OPERATION,
    ]);
  const defaultBranch = defaultRefs.defaultBranch;
  const originDefaultBranch = defaultRefs.originDefaultBranch;
  // Pin default refs to the first page so common picks like main and
  // origin/main are available before the user searches.
  const sorted = pinBranch({ branches, branch: defaultBranch });
  const sortedRemoteBranches = pinBranch({
    branches: remoteBranches,
    branch:
      originDefaultBranch ?? (defaultBranch ? `origin/${defaultBranch}` : null),
  });
  const limitedBranches = limitBranchList({
    branches: sorted,
    limit: command.limit,
    query: command.query,
  });
  const limitedRemoteBranches = limitBranchList({
    branches: sortedRemoteBranches,
    limit: command.limit,
    query: command.query,
  });
  const selectedBranch = classifySelectedBranch({
    branches,
    remoteBranches,
    selectedBranch: command.selectedBranch,
  });
  return {
    branches: limitedBranches.branches,
    branchesTruncated: limitedBranches.truncated,
    checkout,
    defaultBranch: defaultBranch ?? null,
    defaultBranchRelation: defaultRefs.defaultBranchRelation ?? null,
    hasUncommittedChanges: dirty,
    operation,
    originDefaultBranch: originDefaultBranch ?? null,
    remoteBranches: limitedRemoteBranches.branches,
    remoteBranchesTruncated: limitedRemoteBranches.truncated,
    selectedBranch,
  };
}
