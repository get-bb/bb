import { experimental_killProcessesWithCwdUnder } from "@get-bb/plugin-sdk/host";
import {
  findWorktreeEntry,
  parseWorktreeListPorcelain,
  selectAdoptableWorktrees,
  type GitWorktreeEntry,
} from "./worktree-list.js";
import fs from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  findWorktreeForBranch,
  getCurrentBranch,
  getGitCommonDir,
  hasRef,
  readGitRepositoryState,
  runGit,
  WorkspaceError,
  type GitProcessOptions,
  type RunGitOptions,
} from "bb-environment-provider-host/git";
import {
  ProcessLocalQueuedLockTimeoutError,
  runGitWithWorktreeMetadataLock,
  tryWithCheckoutMutationLock,
  withGitRefMutationLock,
  withWorktreeMetadataLock,
} from "bb-environment-provider-host/locks";
import {
  createProvisionCancelledError,
  emitCwd,
  emitGitOutput,
  emitOutput,
  emitStep,
  isProvisionAbortError,
  throwIfProvisionAborted,
  type ProgressCallback,
} from "bb-environment-provider-host/transcript";
import {
  copyWorktreeIncludeFiles,
  WORKTREE_INCLUDE_FILE_NAME,
  type CopyWorktreeIncludeFilesResult,
} from "./worktree-include.js";
import type { ResolvedWorktreeBaseBranch } from "./base-branch.js";

export type BranchMode = "reset" | "reuse-existing";

interface CreateWorktreeArgs {
  sourcePath: string;
  targetPath: string;
  completionPath: string;
  ownWorktreesRoot: string;
  branchName: string;
  baseBranch: ResolvedWorktreeBaseBranch | null;
  branchMode: BranchMode;
  onProgress?: ProgressCallback | undefined;
  signal?: AbortSignal | undefined;
}

interface RemoveWorktreeArgs {
  path: string;
  onProgress?: ProgressCallback | undefined;
  signal?: AbortSignal | undefined;
}

const REMOTE_BASE_FETCH_TIMEOUT_MS = 60_000;
const REMOTE_REF_LOCK_RETRY_INTERVAL_MS = 200;
const REMOTE_REF_LOCK_RETRY_TIMEOUT_MS = 2_000;
const WORKTREE_INCLUDE_TRANSCRIPT_PATH_LIMIT = 20;

type ConcurrentRemoteRefUpdateErrorKind = "stale-value" | "lock-file-exists";

function signalOptions(
  signal: AbortSignal | undefined,
): GitProcessOptions & { signal?: AbortSignal } {
  return signal !== undefined ? { signal } : {};
}

function classifyConcurrentRemoteRefUpdateError(
  error: unknown,
  remoteRef: string,
): ConcurrentRemoteRefUpdateErrorKind | null {
  if (
    !(error instanceof WorkspaceError) ||
    error.code !== "git_command_failed"
  ) {
    return null;
  }

  if (
    error.message.endsWith(
      `error: fetching ref ${remoteRef} failed: reference already exists`,
    )
  ) {
    return "lock-file-exists";
  }

  const lockFailurePrefix = `cannot lock ref '${remoteRef}': `;
  const lockFailureDetail = error.message.split(lockFailurePrefix)[1];
  if (lockFailureDetail === undefined) {
    return null;
  }

  if (
    /^is at [0-9a-f]+ but expected [0-9a-f]+(?:\n|$)/u.test(lockFailureDetail)
  ) {
    return "stale-value";
  }
  if (
    /^Unable to create '.+\.lock': File exists\.(?:\n|$)/u.test(
      lockFailureDetail,
    )
  ) {
    return "lock-file-exists";
  }
  return null;
}

async function ensureExistingWorkspaceMatches(
  targetPath: string,
  branchName: string,
  signal: AbortSignal | undefined,
): Promise<boolean> {
  try {
    await fs.access(targetPath);
  } catch {
    return false;
  }

  try {
    const currentBranch = await getCurrentBranch(targetPath);
    throwIfProvisionAborted(signal);
    return currentBranch === branchName;
  } catch (error) {
    if (signal?.aborted) throw error;
    return false;
  }
}

async function realpathOrResolved(target: string): Promise<string> {
  try {
    return await fs.realpath(target);
  } catch {
    return path.resolve(target);
  }
}

async function isPathInside(root: string, target: string): Promise<boolean> {
  const relative = path.relative(
    await realpathOrResolved(root),
    await realpathOrResolved(target),
  );
  return (
    relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)
  );
}

async function removeAbandonedAttemptWorktree(args: {
  sourcePath: string;
  ownWorktreesRoot: string;
  branchName: string;
  onProgress: ProgressCallback | undefined;
  signal: AbortSignal | undefined;
}): Promise<void> {
  const holder = await findWorktreeForBranch(args.sourcePath, args.branchName);
  if (holder === null || !(await isPathInside(args.ownWorktreesRoot, holder))) {
    return;
  }
  throwIfProvisionAborted(args.signal);
  const status = await runGit(["status", "--porcelain"], {
    cwd: holder,
    ...(args.signal !== undefined ? { signal: args.signal } : {}),
  });
  if (status.stdout.trim() !== "") {
    throw new WorkspaceError(
      "abandoned_worktree_dirty",
      `Branch ${args.branchName} is still checked out at ${holder} by an earlier attempt, and that worktree has uncommitted changes, so it was left alone. Remove it to retry.`,
    );
  }
  const startedAt = Date.now();
  emitStep({
    onProgress: args.onProgress,
    key: "abandoned-worktree-started",
    text: "Removing the worktree an earlier attempt left behind",
    status: "started",
    startedAt,
  });
  await removeWorktree({
    path: holder,
    ...(args.signal !== undefined ? { signal: args.signal } : {}),
  });
  emitStep({
    onProgress: args.onProgress,
    key: "abandoned-worktree-completed",
    text: "Removed the worktree an earlier attempt left behind",
    status: "completed",
    startedAt,
    metadata: { durationMs: Date.now() - startedAt },
  });
}

async function ensureWorkspaceParentDirectory(
  targetPath: string,
): Promise<void> {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
}

async function waitForProvisionRetry(
  delayMs: number,
  signal: AbortSignal | undefined,
): Promise<void> {
  try {
    await delay(
      delayMs,
      undefined,
      signal !== undefined ? { signal } : undefined,
    );
  } catch (error) {
    if (signal?.aborted) {
      throw createProvisionCancelledError(error);
    }
    throw error;
  }
}

async function resolveRemoteBaseBranch(
  sourcePath: string,
  baseBranch: string,
  signal: AbortSignal | undefined,
): Promise<{ remote: string; branch: string } | null> {
  if (!baseBranch.includes("/")) {
    return null;
  }

  const remotes = (
    await runGit(["remote"], {
      cwd: sourcePath,
      ...(signal !== undefined ? { signal } : {}),
    })
  ).stdout
    .split("\n")
    .map((remote) => remote.trim())
    .filter(Boolean);
  const matchingRemotes = remotes
    .filter(
      (remote) =>
        baseBranch.startsWith(`${remote}/`) &&
        baseBranch.length > remote.length + 1,
    )
    .sort((left, right) => right.length - left.length);
  const remote = matchingRemotes[0];
  if (!remote) {
    return null;
  }

  return {
    remote,
    branch: baseBranch.slice(remote.length + 1),
  };
}

function isFetchFailureWithFallback(error: unknown): boolean {
  return (
    error instanceof WorkspaceError &&
    (error.code === "git_command_failed" ||
      error.code === "git_command_timeout")
  );
}

async function readShortCommit(
  sourcePath: string,
  ref: string,
  signal: AbortSignal | undefined,
): Promise<string | null> {
  const result = await runGit(
    ["rev-parse", "--verify", "--quiet", "--short", `${ref}^{commit}`],
    { cwd: sourcePath, ...signalOptions(signal), allowFailure: true },
  );
  const commit = result.stdout.trim();
  return result.exitCode === 0 && commit !== "" ? commit : null;
}

export async function fetchRemoteBaseBranch(args: {
  sourcePath: string;
  baseBranch: string;
  fetchFailureFallback: boolean;
  onProgress: ProgressCallback | undefined;
  signal: AbortSignal | undefined;
}): Promise<void> {
  const remoteBase = await resolveRemoteBaseBranch(
    args.sourcePath,
    args.baseBranch,
    args.signal,
  );
  if (!remoteBase) {
    return;
  }

  const startedAt = Date.now();
  emitStep({
    onProgress: args.onProgress,
    key: "git-fetch-started",
    text: `Fetching ${args.baseBranch}`,
    status: "started",
    startedAt,
  });

  const remoteRef = `refs/remotes/${remoteBase.remote}/${remoteBase.branch}`;
  const refspec = `+refs/heads/${remoteBase.branch}:${remoteRef}`;
  const gitProcessOptions = signalOptions(args.signal);
  try {
    throwIfProvisionAborted(args.signal);
    const commonDir = await getGitCommonDir(args.sourcePath, gitProcessOptions);
    const fetchBaseBranch = async (): Promise<void> => {
      try {
        await withGitRefMutationLock(
          commonDir,
          () =>
            runGit(["fetch", "--quiet", remoteBase.remote, refspec], {
              cwd: args.sourcePath,
              ...gitProcessOptions,
              env: { GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" },
              timeoutMs: REMOTE_BASE_FETCH_TIMEOUT_MS,
            }),
          args.signal !== undefined ? { signal: args.signal } : {},
        );
      } catch (error) {
        if (args.signal?.aborted && !isProvisionAbortError(error)) {
          throw createProvisionCancelledError(error);
        }
        if (error instanceof ProcessLocalQueuedLockTimeoutError) {
          throw new WorkspaceError(
            "git_command_timeout",
            `Timed out waiting to fetch ${args.baseBranch} because another Git ref update is still running`,
            { cause: error },
          );
        }
        throw error;
      }
    };
    let staleValueRetried = false;
    let lockFileRetryDeadline: number | undefined;
    while (true) {
      try {
        await fetchBaseBranch();
        break;
      } catch (error) {
        const errorKind = classifyConcurrentRemoteRefUpdateError(
          error,
          remoteRef,
        );
        if (errorKind === null) {
          throw error;
        }
        if (errorKind === "stale-value") {
          if (staleValueRetried) {
            throw error;
          }
          staleValueRetried = true;
          throwIfProvisionAborted(args.signal);
          continue;
        }

        lockFileRetryDeadline ??= Date.now() + REMOTE_REF_LOCK_RETRY_TIMEOUT_MS;
        const remainingRetryMs = lockFileRetryDeadline - Date.now();
        if (remainingRetryMs <= 0) {
          throw error;
        }
        throwIfProvisionAborted(args.signal);
        await waitForProvisionRetry(
          Math.min(REMOTE_REF_LOCK_RETRY_INTERVAL_MS, remainingRetryMs),
          args.signal,
        );
      }
    }
    emitStep({
      onProgress: args.onProgress,
      key: "git-fetch-completed",
      text: `Fetched ${args.baseBranch}`,
      status: "completed",
      startedAt,
      metadata: { durationMs: Date.now() - startedAt },
    });
  } catch (error) {
    emitStep({
      onProgress: args.onProgress,
      key: "git-fetch-failed",
      text: `Failed to fetch ${args.baseBranch}`,
      status: "failed",
      startedAt,
      metadata: { durationMs: Date.now() - startedAt },
    });
    if (
      !args.fetchFailureFallback ||
      args.signal?.aborted ||
      !isFetchFailureWithFallback(error)
    ) {
      throw error;
    }
    const fallbackCommit = await readShortCommit(
      args.sourcePath,
      remoteRef,
      args.signal,
    );
    if (fallbackCommit === null) {
      throw error;
    }
    emitOutput(
      args.onProgress,
      "git-fetch",
      error instanceof Error ? error.message : String(error),
    );
    emitStep({
      onProgress: args.onProgress,
      key: "git-fetch-fallback",
      text: `Using the last fetched ${args.baseBranch} (${fallbackCommit}); it may be out of date`,
      status: "completed",
    });
  }
}

function summarizePaths(paths: readonly string[]): string {
  const shown = paths.slice(0, WORKTREE_INCLUDE_TRANSCRIPT_PATH_LIMIT);
  const hiddenCount = paths.length - shown.length;
  const suffix = hiddenCount > 0 ? `, and ${hiddenCount} more` : "";
  return `${shown.join(", ")}${suffix}`;
}

async function copyIncludedFiles(args: {
  sourcePath: string;
  targetPath: string;
  onProgress: ProgressCallback | undefined;
  signal: AbortSignal | undefined;
}): Promise<void> {
  throwIfProvisionAborted(args.signal);
  const startedAt = Date.now();
  let result: CopyWorktreeIncludeFilesResult;
  try {
    result = await copyWorktreeIncludeFiles({
      sourcePath: args.sourcePath,
      targetPath: args.targetPath,
      signal: args.signal,
    });
  } catch (error) {
    if (isProvisionAbortError(error)) {
      throw error;
    }
    emitOutput(
      args.onProgress,
      "worktree-include",
      `Skipped ${WORKTREE_INCLUDE_FILE_NAME}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return;
  }
  if (!result.ran) {
    return;
  }

  for (const skipped of result.skipped.slice(
    0,
    WORKTREE_INCLUDE_TRANSCRIPT_PATH_LIMIT,
  )) {
    emitOutput(args.onProgress, "worktree-include", `Skipped ${skipped}`);
  }
  const hiddenSkipCount =
    result.skipped.length - WORKTREE_INCLUDE_TRANSCRIPT_PATH_LIMIT;
  if (hiddenSkipCount > 0) {
    emitOutput(
      args.onProgress,
      "worktree-include",
      `Skipped ${hiddenSkipCount} more file(s)`,
    );
  }
  if (result.copied.length > 0) {
    emitOutput(
      args.onProgress,
      "worktree-include",
      `Copied ${result.copied.length} file(s): ${summarizePaths(result.copied)}`,
    );
  }
  emitStep({
    onProgress: args.onProgress,
    key: "worktree-include-completed",
    text: `Copied ${result.copied.length} file(s) from ${WORKTREE_INCLUDE_FILE_NAME}`,
    status: "completed",
    startedAt,
    metadata: { durationMs: Date.now() - startedAt },
  });
}

async function readCompletedBranch(
  completionPath: string,
): Promise<string | null> {
  try {
    return (await fs.readFile(completionPath, "utf8")).trim() || null;
  } catch {
    return null;
  }
}

async function finishWorktreeSetup(args: CreateWorktreeArgs): Promise<void> {
  emitCwd({
    onProgress: args.onProgress,
    keySuffix: "target",
    cwd: args.targetPath,
  });
  await copyIncludedFiles({
    sourcePath: args.sourcePath,
    targetPath: args.targetPath,
    onProgress: args.onProgress,
    signal: args.signal,
  });
  await fs.writeFile(args.completionPath, `${args.branchName}\n`, "utf8");
}

async function removeCreateTarget(args: CreateWorktreeArgs): Promise<void> {
  await fs.rm(args.completionPath, { force: true });
  await removeWorktree({
    path: args.targetPath,
    ...(args.signal !== undefined ? { signal: args.signal } : {}),
  });
}

async function abandonCreateTarget(
  args: CreateWorktreeArgs,
  ownsBranch: boolean,
): Promise<void> {
  await removeCreateTarget(args);
  if (!ownsBranch) return;
  try {
    await deleteOwnedBranch({
      repositoryPath: args.sourcePath,
      branchName: args.branchName,
      baseBranch: args.baseBranch?.ref ?? null,
      onProgress: args.onProgress,
      signal: args.signal,
    });
  } catch {
    return;
  }
}

export async function createWorktree(
  args: CreateWorktreeArgs,
): Promise<{ path: string; ownsBranch: boolean }> {
  throwIfProvisionAborted(args.signal);
  const existingWorkspaceMatches = await ensureExistingWorkspaceMatches(
    args.targetPath,
    args.branchName,
    args.signal,
  );
  if (existingWorkspaceMatches) {
    const existing = {
      path: args.targetPath,
      ownsBranch:
        args.branchMode === "reset" ||
        (await isKeptOwnedBranch(args.sourcePath, args.branchName)),
    };
    if ((await readCompletedBranch(args.completionPath)) === args.branchName) {
      return existing;
    }
    try {
      await finishWorktreeSetup(args);
      return existing;
    } catch (error) {
      await abandonCreateTarget(args, existing.ownsBranch);
      throw error;
    }
  }

  await removeCreateTarget(args);

  throwIfProvisionAborted(args.signal);
  switch (
    await readGitRepositoryState(args.sourcePath, signalOptions(args.signal))
  ) {
    case "not_git":
      throw new WorkspaceError(
        "not_git_repo",
        `Cannot create a worktree because the source is not a Git repository: ${args.sourcePath}. Initialize it and create at least one commit, then try again.`,
      );
    case "no_commits":
      throw new WorkspaceError(
        "unborn_head",
        `Cannot create a worktree because the repository has no commits: ${args.sourcePath}. Create an initial commit, then try again.`,
      );
    case "has_commits":
      break;
  }

  throwIfProvisionAborted(args.signal);
  await removeAbandonedAttemptWorktree({
    sourcePath: args.sourcePath,
    ownWorktreesRoot: args.ownWorktreesRoot,
    branchName: args.branchName,
    onProgress: args.onProgress,
    signal: args.signal,
  });

  throwIfProvisionAborted(args.signal);
  await ensureWorkspaceParentDirectory(args.targetPath);

  throwIfProvisionAborted(args.signal);
  const reuseExistingBranch =
    args.branchMode === "reuse-existing" &&
    (await hasRef(args.sourcePath, `refs/heads/${args.branchName}`));
  const ownsBranch =
    !reuseExistingBranch ||
    (await isKeptOwnedBranch(args.sourcePath, args.branchName));
  const remoteTrackingBranch =
    args.branchMode === "reuse-existing" && !reuseExistingBranch
      ? await findRemoteTrackingBranch(
          args.sourcePath,
          args.branchName,
          args.signal,
        )
      : null;

  let gitArgs: string[];
  if (reuseExistingBranch) {
    gitArgs = ["worktree", "add", args.targetPath, args.branchName];
  } else if (remoteTrackingBranch !== null) {
    gitArgs = [
      "worktree",
      "add",
      "--track",
      "-b",
      args.branchName,
      args.targetPath,
      remoteTrackingBranch,
    ];
  } else {
    const baseBranch = args.baseBranch;
    if (!baseBranch) {
      throw new WorkspaceError(
        "missing_default_branch",
        `Cannot resolve default branch for source: ${args.sourcePath}`,
      );
    }
    throwIfProvisionAborted(args.signal);
    await fetchRemoteBaseBranch({
      sourcePath: args.sourcePath,
      baseBranch: baseBranch.ref,
      fetchFailureFallback: baseBranch.fetchFailureFallback,
      onProgress: args.onProgress,
      signal: args.signal,
    });
    gitArgs = [
      "worktree",
      "add",
      "--no-track",
      "-B",
      args.branchName,
      args.targetPath,
      baseBranch.ref,
    ];
  }

  const worktreeStartedAt = Date.now();
  emitStep({
    onProgress: args.onProgress,
    key: "git-worktree-started",
    text: "Creating worktree",
    status: "started",
    startedAt: worktreeStartedAt,
  });
  let worktreeCreated = false;
  try {
    const result = await runGitWithWorktreeMetadataLock(gitArgs, {
      cwd: args.sourcePath,
      ...(args.signal !== undefined ? { signal: args.signal } : {}),
    });
    emitGitOutput(args.onProgress, "git-worktree", result);
    emitStep({
      onProgress: args.onProgress,
      key: "git-worktree-completed",
      text: "Created worktree",
      status: "completed",
      startedAt: worktreeStartedAt,
      metadata: { durationMs: Date.now() - worktreeStartedAt },
    });
    worktreeCreated = true;
    await finishWorktreeSetup(args);
    return { path: args.targetPath, ownsBranch };
  } catch (error) {
    if (!worktreeCreated) {
      emitStep({
        onProgress: args.onProgress,
        key: "git-worktree-failed",
        text: "Worktree setup failed",
        status: "failed",
        startedAt: worktreeStartedAt,
        metadata: { durationMs: Date.now() - worktreeStartedAt },
      });
    }
    await abandonCreateTarget(args, ownsBranch);
    throw error;
  }
}

async function removeDirectoryIfEmpty(pathToRemove: string): Promise<void> {
  try {
    await fs.rmdir(pathToRemove);
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      typeof error.code === "string" &&
      ["ENOENT", "ENOTEMPTY", "EEXIST"].includes(error.code)
    ) {
      return;
    }

    throw error;
  }
}

async function assertNoWorktreeLocalState(
  workspacePath: string,
  signal: AbortSignal | undefined,
): Promise<void> {
  const options = { cwd: workspacePath, ...signalOptions(signal) };
  const localRefs = await runGit(
    [
      "for-each-ref",
      "--format=%(refname)",
      "refs/worktree/",
      "refs/bisect/",
      "refs/rewritten/",
    ],
    options,
  );
  if (localRefs.stdout.trim()) {
    throw new WorkspaceError(
      "worktree_local_refs",
      `Cannot remove ${workspacePath}: preserve or delete its worktree-local Git refs first.`,
    );
  }
  const gitDir = await runGit(["rev-parse", "--absolute-git-dir"], options);
  const entries = new Set(await fs.readdir(gitDir.stdout.trim()));
  const operation = [
    "MERGE_HEAD",
    "CHERRY_PICK_HEAD",
    "REVERT_HEAD",
    "REBASE_HEAD",
    "BISECT_START",
    "rebase-merge",
    "rebase-apply",
    "sequencer",
  ].find((entry) => entries.has(entry));
  if (operation) {
    throw new WorkspaceError(
      "worktree_git_operation",
      `Cannot remove ${workspacePath}: finish or abort the Git operation (${operation}) first.`,
    );
  }
}

export async function removeWorktree(args: RemoveWorktreeArgs): Promise<void> {
  throwIfProvisionAborted(args.signal);
  const workspacePath = path.resolve(args.path);
  const parentPath = path.dirname(workspacePath);
  try {
    await fs.access(workspacePath);
  } catch {
    await removeDirectoryIfEmpty(parentPath);
    return;
  }

  await experimental_killProcessesWithCwdUnder({
    directories: [workspacePath],
  });
  throwIfProvisionAborted(args.signal);

  const commonDirResult = await runGit(["rev-parse", "--git-common-dir"], {
    cwd: workspacePath,
    ...(args.signal !== undefined ? { signal: args.signal } : {}),
    allowFailure: true,
  });

  if (commonDirResult.exitCode === 0) {
    const commonDir = path.resolve(
      workspacePath,
      commonDirResult.stdout.trim(),
    );
    const removal = await tryWithCheckoutMutationLock(
      workspacePath,
      () =>
        withWorktreeMetadataLock(commonDir, async () => {
          await assertNoWorktreeLocalState(workspacePath, args.signal);
          return runGit(
            [
              "--git-dir",
              commonDir,
              "worktree",
              "remove",
              workspacePath,
              "--force",
            ],
            {
              cwd: path.dirname(workspacePath),
              ...(args.signal !== undefined ? { signal: args.signal } : {}),
              allowFailure: true,
            },
          );
        }),
      args.signal,
      signalOptions(args.signal),
    );
    if (removal === null) {
      throw new WorkspaceError(
        "worktree_git_unavailable",
        `Cannot inspect Git state for ${workspacePath}; refusing removal.`,
      );
    }
  }

  throwIfProvisionAborted(args.signal);
  await fs.rm(workspacePath, { recursive: true, force: true });
  await removeDirectoryIfEmpty(parentPath);
}

function keptOwnedBranchConfigKey(branchName: string): string {
  return `branch.${branchName}.bbOwned`;
}

async function isKeptOwnedBranch(
  sourcePath: string,
  branchName: string,
): Promise<boolean> {
  const result = await runGit(
    ["config", "--type=bool", "--get", keptOwnedBranchConfigKey(branchName)],
    { cwd: sourcePath, allowFailure: true },
  );
  return result.exitCode === 0 && result.stdout.trim() === "true";
}

async function markKeptOwnedBranch(
  branchName: string,
  gitOptions: RunGitOptions,
): Promise<void> {
  await runGit(["config", keptOwnedBranchConfigKey(branchName), "true"], {
    ...gitOptions,
    allowFailure: true,
  });
}

async function findRemoteTrackingBranch(
  sourcePath: string,
  branchName: string,
  signal: AbortSignal | undefined,
): Promise<string | null> {
  const remotes = (
    await runGit(["remote"], { cwd: sourcePath, ...signalOptions(signal) })
  ).stdout
    .split("\n")
    .map((remote) => remote.trim())
    .filter(Boolean);
  if (remotes.length === 0) return null;
  const candidates = remotes.map(
    (remote) => `refs/remotes/${remote}/${branchName}`,
  );
  const found = new Set(
    (
      await runGit(["for-each-ref", "--format=%(refname)", ...candidates], {
        cwd: sourcePath,
        ...signalOptions(signal),
      })
    ).stdout
      .split("\n")
      .map((ref) => ref.trim()),
  );
  const matches = candidates.filter((ref) => found.has(ref));
  return matches.length === 1 ? (matches[0] ?? null) : null;
}

const SQUASH_SEARCH_COMMIT_LIMIT = 2_000;
const SQUASH_SEARCH_PATH_LIMIT = 200;

async function readPatchId(
  patch: string,
  gitOptions: RunGitOptions,
): Promise<string[]> {
  if (patch.trim() === "") return [];
  const result = await runGit(["patch-id", "--stable"], {
    ...gitOptions,
    input: patch,
  });
  return result.stdout
    .split("\n")
    .map((line) => line.split(" ")[0] ?? "")
    .filter(Boolean);
}

async function isSquashMergedInto(args: {
  tipOid: string;
  baseOid: string;
  gitOptions: RunGitOptions;
}): Promise<boolean> {
  const { baseOid, gitOptions } = args;
  const mergeBase = await runGit(["merge-base", args.tipOid, baseOid], {
    ...gitOptions,
    allowFailure: true,
  });
  const mergeBaseOid = mergeBase.stdout.trim();
  if (mergeBase.exitCode !== 0 || mergeBaseOid === "") return false;
  const sinceBranch = Number(
    (
      await runGit(
        ["rev-list", "--count", `${mergeBaseOid}..${baseOid}`],
        gitOptions,
      )
    ).stdout.trim(),
  );
  if (sinceBranch === 0 || sinceBranch > SQUASH_SEARCH_COMMIT_LIMIT) {
    return false;
  }
  const paths = (
    await runGit(
      ["diff-tree", "-r", "-z", "--name-only", mergeBaseOid, args.tipOid],
      gitOptions,
    )
  ).stdout
    .split("\0")
    .filter(Boolean);
  if (paths.length === 0 || paths.length > SQUASH_SEARCH_PATH_LIMIT) {
    return false;
  }
  const diffArgs = ["diff-tree", "-p", "--no-color", "--no-ext-diff"];
  const [branchPatchId] = await readPatchId(
    (await runGit([...diffArgs, mergeBaseOid, args.tipOid], gitOptions)).stdout,
    gitOptions,
  );
  if (branchPatchId === undefined) return false;
  const literalPathOptions = {
    ...gitOptions,
    env: { GIT_LITERAL_PATHSPECS: "1" },
  };
  const candidates = (
    await runGit(
      [
        "rev-list",
        "--no-merges",
        `${mergeBaseOid}..${baseOid}`,
        "--",
        ...paths,
      ],
      literalPathOptions,
    )
  ).stdout.trim();
  if (candidates === "") return false;
  const candidatePatchIds = await readPatchId(
    (
      await runGit([...diffArgs, "--stdin", "--", ...paths], {
        ...literalPathOptions,
        input: `${candidates}\n`,
      })
    ).stdout,
    gitOptions,
  );
  return candidatePatchIds.includes(branchPatchId);
}

export type OwnedBranchCleanup =
  | "deleted"
  | "missing"
  | "checked-out"
  | "unpushed-commits"
  | "repository-missing";

async function hasCommitsOnlyOnBranch(args: {
  tipOid: string;
  baseBranch: string | null;
  gitOptions: RunGitOptions;
}): Promise<boolean> {
  const base =
    args.baseBranch === null
      ? null
      : await runGit(
          ["rev-parse", "--verify", "--quiet", `${args.baseBranch}^{commit}`],
          { ...args.gitOptions, allowFailure: true },
        );
  const baseOid =
    base !== null && base.exitCode === 0 && base.stdout.trim() !== ""
      ? base.stdout.trim()
      : null;
  const unique = await runGit(
    [
      "rev-list",
      "--count",
      args.tipOid,
      "--not",
      "--tags",
      "--remotes",
      ...(baseOid === null ? [] : [baseOid]),
    ],
    args.gitOptions,
  );
  if (Number(unique.stdout.trim()) === 0) return false;
  return (
    baseOid === null ||
    !(await isSquashMergedInto({
      tipOid: args.tipOid,
      baseOid,
      gitOptions: args.gitOptions,
    }))
  );
}

function ownedBranchCleanupMessage(
  outcome: OwnedBranchCleanup,
  branchName: string,
): string | null {
  switch (outcome) {
    case "deleted":
      return `Deleted branch ${branchName}`;
    case "checked-out":
      return `Kept branch ${branchName} because another worktree has it checked out`;
    case "unpushed-commits":
      return `Kept branch ${branchName} because it has commits that are on no remote or tag, not in its base, and not squash-merged into its base`;
    case "missing":
    case "repository-missing":
      return null;
  }
}

export async function deleteOwnedBranch(args: {
  repositoryPath: string;
  branchName: string;
  baseBranch: string | null;
  onProgress?: ProgressCallback | undefined;
  signal?: AbortSignal | undefined;
}): Promise<OwnedBranchCleanup> {
  const outcome = await cleanUpOwnedBranch(args);
  const message = ownedBranchCleanupMessage(outcome, args.branchName);
  if (message !== null) emitOutput(args.onProgress, "branch-cleanup", message);
  return outcome;
}

async function cleanUpOwnedBranch(args: {
  repositoryPath: string;
  branchName: string;
  baseBranch: string | null;
  signal?: AbortSignal | undefined;
}): Promise<OwnedBranchCleanup> {
  throwIfProvisionAborted(args.signal);
  const gitOptions: RunGitOptions = {
    cwd: args.repositoryPath,
    ...signalOptions(args.signal),
  };
  try {
    await fs.access(args.repositoryPath);
  } catch {
    return "repository-missing";
  }
  const commonDirResult = await runGit(["rev-parse", "--git-common-dir"], {
    ...gitOptions,
    allowFailure: true,
  });
  if (commonDirResult.exitCode !== 0) return "repository-missing";
  const commonDir = path.resolve(
    args.repositoryPath,
    commonDirResult.stdout.trim(),
  );
  const ref = `refs/heads/${args.branchName}`;
  const tip = await runGit(
    ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`],
    { ...gitOptions, allowFailure: true },
  );
  const tipOid = tip.stdout.trim();
  if (tip.exitCode !== 0 || tipOid === "") return "missing";
  if (
    await hasCommitsOnlyOnBranch({
      tipOid,
      baseBranch: args.baseBranch,
      gitOptions,
    })
  ) {
    await markKeptOwnedBranch(args.branchName, gitOptions);
    return "unpushed-commits";
  }
  return withWorktreeMetadataLock(
    commonDir,
    async (): Promise<OwnedBranchCleanup> => {
      if (
        (await findWorktreeForBranch(
          args.repositoryPath,
          args.branchName,
          signalOptions(args.signal),
        )) !== null
      ) {
        await markKeptOwnedBranch(args.branchName, gitOptions);
        return "checked-out";
      }
      throwIfProvisionAborted(args.signal);
      const deleted = await runGit(["update-ref", "-d", ref, tipOid], {
        ...gitOptions,
        allowFailure: true,
      });
      if (deleted.exitCode !== 0) {
        throw new WorkspaceError(
          "git_command_failed",
          `Branch ${args.branchName} changed while bb was checking it: ${deleted.stderr.trim()}`,
        );
      }
      await runGit(
        ["config", "--remove-section", `branch.${args.branchName}`],
        { ...gitOptions, allowFailure: true },
      );
      return "deleted";
    },
    args.signal,
  );
}

export async function listGitWorktrees(args: {
  sourcePath: string;
  signal?: AbortSignal;
}): Promise<GitWorktreeEntry[]> {
  const result = await runGit(["worktree", "list", "--porcelain", "-z"], {
    cwd: args.sourcePath,
    ...(args.signal !== undefined ? { signal: args.signal } : {}),
  });
  return parseWorktreeListPorcelain(result.stdout);
}

export async function listAdoptableWorktrees(args: {
  sourcePath: string;
  managedRoot: string;
  signal?: AbortSignal;
}): Promise<GitWorktreeEntry[]> {
  const entries = await listGitWorktrees(args);
  return selectAdoptableWorktrees({
    entries,
    managedRoot: await realpathOrResolved(args.managedRoot),
  });
}

export async function resolveAdoptableWorktree(args: {
  sourcePath: string;
  path: string;
  managedRoot: string;
  signal?: AbortSignal;
}): Promise<
  | { status: "resolved"; path: string; branch: string | null }
  | { status: "failed"; message: string }
> {
  const adoptable = await listAdoptableWorktrees(args);
  const entry = findWorktreeEntry(
    adoptable,
    await realpathOrResolved(args.path),
  );
  if (entry === null) {
    return {
      status: "failed",
      message: `${args.path} is not a worktree of this repository that bb can adopt.`,
    };
  }
  if (entry.prunable) {
    return {
      status: "failed",
      message: `${args.path} is a prunable worktree; run \`git worktree prune\` or repair it first.`,
    };
  }
  return { status: "resolved", path: entry.path, branch: entry.branch };
}
