import type {
  GitBranchOptions,
  GitBranchRefClassification,
} from "./git-types.js";
import {
  detectGitRepoKind,
  ensureGitRepo,
  getGitCommonDir,
  readLocalBranches,
  readOriginHeadBranchName,
  resolvePreferredLocalDefaultBranch,
  runGit,
  WorkspaceError,
  type GitProcessOptions,
  type GitTimeoutOptions,
} from "./workspace-git.js";
import { withGitRefMutationLock } from "./process-local-lock.js";

interface FetchRemoteBranchesResult {
  status: "fetched" | "failed" | "skipped";
}

interface FetchRemoteBranchesOptions extends GitTimeoutOptions {
  interactive: boolean;
}

interface BranchRefsWithDefaults {
  branches: string[];
  defaultBranch: string | undefined;
  originDefaultBranch: string | undefined;
  remoteBranches: string[];
}

async function fetchRemoteBranchesNonInteractively(
  cwd: string,
  options: GitTimeoutOptions,
): Promise<FetchRemoteBranchesResult> {
  try {
    await runGit(["fetch", "--all", "--prune", "--quiet"], {
      cwd,
      ...options,
      priority: "background",
      env: {
        GIT_TERMINAL_PROMPT: "0",
        GIT_ASKPASS: "false",
        SSH_ASKPASS: "false",
        SSH_ASKPASS_REQUIRE: "never",
        GCM_INTERACTIVE: "never",
      },
    });
    return { status: "fetched" };
  } catch {
    return { status: "failed" };
  }
}

export async function fetchRemoteBranches(
  cwd: string,
  { interactive, ...options }: FetchRemoteBranchesOptions,
): Promise<FetchRemoteBranchesResult> {
  await ensureGitRepo(cwd, options);

  const remotes = await runGit(["remote"], {
    cwd,
    ...options,
    allowFailure: true,
  });
  if (
    remotes.exitCode !== 0 ||
    remotes.stdout
      .split("\n")
      .map((remote) => remote.trim())
      .filter(Boolean).length === 0
  ) {
    return { status: "skipped" };
  }

  if (!interactive) {
    return fetchRemoteBranchesNonInteractively(cwd, options);
  }

  try {
    const result = await runGit(["fetch", "--all", "--prune", "--quiet"], {
      cwd,
      ...options,
      allowFailure: true,
    });
    return { status: result.exitCode === 0 ? "fetched" : "failed" };
  } catch (error) {
    if (
      error instanceof WorkspaceError &&
      error.code === "git_command_timeout"
    ) {
      return { status: "failed" };
    }
    throw error;
  }
}

async function readRemoteBranches(
  cwd: string,
  options: GitProcessOptions,
): Promise<string[]> {
  const result = await runGit(
    ["for-each-ref", "--format=%(refname:short)%09%(symref)", "refs/remotes"],
    { cwd, ...options },
  );
  return result.stdout
    .split("\n")
    .map((line) => {
      const [branch = "", symref = ""] = line.split("\t");
      return { branch: branch.trim(), symref: symref.trim() };
    })
    .filter((ref) => ref.branch.length > 0 && ref.symref.length === 0)
    .map((ref) => ref.branch);
}

async function listBranchRefsWithDefaults(
  cwd: string,
  options: GitProcessOptions = {},
  repositoryKnown = false,
): Promise<BranchRefsWithDefaults> {
  if (!repositoryKnown) await ensureGitRepo(cwd, options);
  const [branches, remoteBranches, originHeadBranch] = await Promise.all([
    readLocalBranches(cwd, options),
    readRemoteBranches(cwd, options),
    readOriginHeadBranchName(cwd, options),
  ]);
  const defaultBranch = resolvePreferredLocalDefaultBranch(
    branches,
    originHeadBranch,
  );
  const originDefaultBranch = [
    originHeadBranch ? `origin/${originHeadBranch}` : undefined,
    defaultBranch ? `origin/${defaultBranch}` : undefined,
  ].find(
    (branch): branch is string =>
      branch !== undefined && remoteBranches.includes(branch),
  );

  return {
    branches,
    defaultBranch,
    originDefaultBranch,
    remoteBranches,
  };
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

export async function refreshRemoteBranches(
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
    { timeoutMs: REMOTE_BRANCH_FETCH_TIMEOUT_MS },
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

export async function readBranchOptions({
  path: cwd,
  limit,
  query,
  selectedBranch: requestedBranch,
  ...gitProcessOptions
}: ReadBranchOptionsArgs): Promise<GitBranchOptions> {
  const { branches, defaultBranch, originDefaultBranch, remoteBranches } =
    await listBranchRefsWithDefaults(cwd, gitProcessOptions, true);
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

export async function listBranchOptions(
  args: ReadBranchOptionsArgs & { remoteRefresh: "background" | "none" },
): Promise<GitBranchOptions> {
  const { remoteRefresh, ...readArgs } = args;
  const processOptions: GitProcessOptions = {
    ...(readArgs.shellPath === undefined ? {} : { shellPath: readArgs.shellPath }),
    ...(readArgs.priority === undefined ? {} : { priority: readArgs.priority }),
  };
  if ((await detectGitRepoKind(readArgs.path, processOptions)) === "none") {
    return {
      branches: [],
      branchesTruncated: false,
      remoteBranches: [],
      remoteBranchesTruncated: false,
      selectedBranch: classifySelectedBranch({
        branches: [],
        remoteBranches: [],
        selectedBranch: readArgs.selectedBranch,
      }),
    };
  }
  if (remoteRefresh === "background") {
    void refreshRemoteBranches(
      readArgs.path,
      processOptions,
      "background",
    ).catch(() => undefined);
  }
  return readBranchOptions(readArgs);
}
