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
  completionPath?: string | undefined;
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
  await removeWorktree({
    path: args.targetPath,
    completionPath: args.completionPath,
    ...(args.signal !== undefined ? { signal: args.signal } : {}),
  });
}

async function hasTaskBranch(args: CreateWorktreeArgs): Promise<boolean> {
  const result = await runGit(
    ["show-ref", "--verify", "--quiet", `refs/heads/${args.branchName}`],
    { cwd: args.sourcePath, ...signalOptions(args.signal), allowFailure: true },
  );
  if (result.exitCode === 0) return true;
  if (result.exitCode === 1) return false;
  throw new WorkspaceError(
    "worktree_branch_unverified",
    "Cannot verify the task branch. Existing work has been preserved.",
  );
}

async function assertResetBranchSafe(args: CreateWorktreeArgs): Promise<void> {
  if (args.branchMode !== "reset" || !(await hasTaskBranch(args))) return;
  const base = args.baseBranch;
  if (!base) {
    throw new WorkspaceError(
      "worktree_reset_unverified",
      "Cannot verify the existing task branch against its base. It has been preserved.",
    );
  }
  const relation = await runGit(
    ["merge-base", "--is-ancestor", `refs/heads/${args.branchName}`, base.ref],
    { cwd: args.sourcePath, ...signalOptions(args.signal), allowFailure: true },
  );
  if (relation.exitCode !== 0) {
    throw new WorkspaceError(
      "worktree_reset_unverified",
      "The existing task branch cannot be safely reset to its base. Preserve its commits or reuse the branch.",
    );
  }
}

export async function createWorktree(
  args: CreateWorktreeArgs,
): Promise<{ path: string }> {
  throwIfProvisionAborted(args.signal);
  const existingWorkspaceMatches = await ensureExistingWorkspaceMatches(
    args.targetPath,
    args.branchName,
    args.signal,
  );
  if (existingWorkspaceMatches) {
    if ((await readCompletedBranch(args.completionPath)) === args.branchName) {
      return { path: args.targetPath };
    }
    try {
      await finishWorktreeSetup(args);
      return { path: args.targetPath };
    } catch (error) {
      await removeCreateTarget(args);
      throw error;
    }
  }

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

  await assertResetBranchSafe(args);
  await removeCreateTarget(args);

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
    args.branchMode === "reuse-existing" && (await hasTaskBranch(args));

  let gitArgs: string[];
  if (reuseExistingBranch) {
    gitArgs = ["worktree", "add", args.targetPath, args.branchName];
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
    await assertResetBranchSafe(args);
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
    return { path: args.targetPath };
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
    await removeCreateTarget(args);
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

async function inspectRemovableWorktree(
  workspacePath: string,
  signal: AbortSignal | undefined,
): Promise<{ commonDir: string; head: string }> {
  const inspect = async (args: string[]): Promise<string> => {
    const result = await runGit(args, {
      cwd: workspacePath,
      ...signalOptions(signal),
      allowFailure: true,
    }).catch((error: unknown) => {
      if (signal?.aborted) throw createProvisionCancelledError(error);
      throw new WorkspaceError(
        "worktree_inspection_failed",
        "Cannot inspect the worktree for cleanup. It has been preserved.",
      );
    });
    if (result.exitCode !== 0) {
      throw new WorkspaceError(
        "worktree_inspection_failed",
        "Cannot verify the worktree for cleanup. It has been preserved.",
      );
    }
    return result.stdout.trim();
  };
  const root = await inspect(["rev-parse", "--show-toplevel"]);
  const commonDir = path.resolve(
    workspacePath,
    await inspect(["rev-parse", "--git-common-dir"]),
  );
  if (
    (await realpathOrResolved(root)) !==
      (await realpathOrResolved(workspacePath)) ||
    commonDir === workspacePath ||
    (await isPathInside(workspacePath, commonDir))
  ) {
    throw new WorkspaceError(
      "worktree_scope_unknown",
      "Cannot verify an independent linked worktree. It has been preserved.",
    );
  }
  const head = await inspect(["rev-parse", "--verify", "HEAD"]);
  const gitDir = await inspect(["rev-parse", "--absolute-git-dir"]);
  for (const marker of [
    "MERGE_HEAD",
    "CHERRY_PICK_HEAD",
    "REVERT_HEAD",
    "REBASE_HEAD",
    "rebase-merge",
    "rebase-apply",
    "sequencer",
    "BISECT_START",
  ]) {
    const entry = await fs
      .lstat(path.join(gitDir, marker))
      .catch((error: unknown) => {
        if (
          error instanceof Error &&
          "code" in error &&
          error.code === "ENOENT"
        )
          return null;
        throw new WorkspaceError(
          "worktree_inspection_failed",
          "Cannot verify Git operation state. The worktree has been preserved.",
        );
      });
    if (entry !== null) {
      throw new WorkspaceError(
        "worktree_operation_in_progress",
        "A Git operation is in progress. Complete or preserve it before cleanup.",
      );
    }
  }
  const privateRefs = await inspect([
    "for-each-ref",
    "--format=%(refname)",
    "refs/worktree/",
    "refs/bisect/",
    "refs/rewritten/",
  ]);
  if (privateRefs !== "") {
    throw new WorkspaceError(
      "worktree_private_refs",
      "The worktree has private recovery references. Preserve them before cleanup.",
    );
  }
  const retainedRefs = await inspect([
    "for-each-ref",
    "--format=%(refname)",
    "--contains=HEAD",
    "refs/heads/",
  ]);
  if (retainedRefs === "") {
    throw new WorkspaceError(
      "worktree_unreferenced_head",
      "The worktree has commits without a retained local branch. Preserve them before cleanup.",
    );
  }
  const status = await inspect([
    "status",
    "--porcelain=v1",
    "--untracked-files=normal",
    "--ignored=matching",
    "--ignore-submodules=none",
    "-z",
  ]);
  if (status !== "") {
    throw new WorkspaceError(
      "worktree_preservation_required",
      "The worktree has uncommitted or ignored files. Preserve them before retrying cleanup.",
    );
  }
  const indexFlags = await inspect(["ls-files", "-v", "-z"]);
  if (indexFlags.split("\0").some((entry) => /^[a-zS] /u.test(entry))) {
    throw new WorkspaceError(
      "worktree_inspection_incomplete",
      "The worktree index suppresses file inspection. It has been preserved.",
    );
  }
  return { commonDir, head };
}

export async function removeWorktree(args: RemoveWorktreeArgs): Promise<void> {
  throwIfProvisionAborted(args.signal);
  const workspacePath = path.resolve(args.path);
  const parentPath = path.dirname(workspacePath);
  try {
    await fs.access(workspacePath);
  } catch (error) {
    if (
      !(error instanceof Error && "code" in error && error.code === "ENOENT")
    ) {
      throw new WorkspaceError(
        "worktree_inspection_failed",
        "Cannot access the worktree for cleanup. It has been preserved.",
      );
    }
    if (args.completionPath) await fs.rm(args.completionPath, { force: true });
    await removeDirectoryIfEmpty(parentPath);
    return;
  }
  if ((await fs.readdir(workspacePath)).length === 0) {
    await fs.rmdir(workspacePath);
    if (args.completionPath) await fs.rm(args.completionPath, { force: true });
    await removeDirectoryIfEmpty(parentPath);
    return;
  }
  const before = await inspectRemovableWorktree(workspacePath, args.signal);
  const removed = await tryWithCheckoutMutationLock(
    workspacePath,
    () =>
      withWorktreeMetadataLock(before.commonDir, async () => {
        await experimental_killProcessesWithCwdUnder({
          directories: [workspacePath],
        });
        throwIfProvisionAborted(args.signal);
        const current = await inspectRemovableWorktree(
          workspacePath,
          args.signal,
        );
        if (
          current.commonDir !== before.commonDir ||
          current.head !== before.head
        ) {
          throw new WorkspaceError(
            "worktree_changed",
            "The worktree changed during cleanup. It has been preserved.",
          );
        }
        const result = await runGit(
          ["--git-dir", before.commonDir, "worktree", "remove", workspacePath],
          {
            cwd: path.dirname(workspacePath),
            ...(args.signal !== undefined ? { signal: args.signal } : {}),
            allowFailure: true,
          },
        );
        if (result.exitCode !== 0) {
          throw new WorkspaceError(
            "worktree_removal_failed",
            "Git refused worktree removal. It has been preserved; inspect it before retrying.",
          );
        }
        return true;
      }),
    args.signal,
    signalOptions(args.signal),
  );
  if (removed !== true) {
    throw new WorkspaceError(
      "worktree_inspection_failed",
      "Cannot lock the worktree for cleanup. It has been preserved.",
    );
  }
  if (args.completionPath) await fs.rm(args.completionPath, { force: true });
  await removeDirectoryIfEmpty(parentPath);
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
