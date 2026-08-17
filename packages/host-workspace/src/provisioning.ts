import fs from "node:fs/promises";
import path from "node:path";
import {
  DEFAULT_ENV_SETUP_SCRIPT_NAME,
  WORKTREE_INCLUDE_FILE_NAME,
  createTerminalOutputLineReader,
  readTerminalOutputLines,
  type ProvisioningTranscriptEntry,
} from "@bb/domain";
import {
  sanitizeInheritedChildProcessEnv,
  spawnPortableOutputProcess,
  type PortableOutputChildProcess,
} from "@bb/process-utils";
import { Workspace } from "./workspace.js";
import { tryWithCheckoutMutationLock } from "./checkout-mutation-lock.js";
import {
  pathExists,
  getGitCommonDir,
  readDefaultBranch,
  readGitRepositoryState,
  runGit,
  WorkspaceError,
  type GitCommandResult,
} from "./git.js";
import {
  runGitWithWorktreeMetadataLock,
  withWorktreeMetadataLock,
} from "./worktree-metadata-lock.js";
import {
  copyWorktreeIncludeFiles,
  type CopyWorktreeIncludeFilesResult,
} from "./worktree-include.js";

type ProgressCallback = (entry: ProvisioningTranscriptEntry) => void;
type EmitStepArgs = {
  onProgress: ProgressCallback | undefined;
  key: string;
  text: string;
  status: "started" | "completed" | "failed";
  startedAt?: number;
  metadata?: ProvisioningTranscriptEntry["metadata"];
};

export interface CreateWorkspaceArgs {
  /** Local repo path for worktrees */
  sourcePath: string;
  targetPath: string;
  /** Name of the new branch to create on the workspace. */
  branchName: string;
  /** Exact start point for the managed branch. */
  startPoint: WorktreeStartPoint;
  /** Setup script timeout in ms. Controlled by the server. */
  timeoutMs: number;
  /** Resolved user-shell PATH for the setup script. */
  setupPath?: string;
  onProgress?: ProgressCallback;
  pruneEmptyParent?: boolean;
  signal?: AbortSignal;
}

export type WorktreeStartPoint =
  | { kind: "branch"; baseBranch: string | null }
  | {
      kind: "revision";
      baseBranch: string | null;
      revision: string;
      allowExistingDescendant: boolean;
    };

export interface RunSetupScriptArgs {
  workspacePath: string;
  timeoutMs: number;
  /** Resolved user-shell PATH. Falls back to the daemon process PATH. */
  setupPath?: string;
  onProgress?: ProgressCallback;
  signal?: AbortSignal;
}

export interface RemoveWorktreeArgs {
  path: string;
  force?: boolean;
  pruneEmptyParent?: boolean;
}

interface SetupScriptCommand {
  command: string;
  args: string[];
  text: string;
}

interface BuildSetupScriptCommandArgs {
  platform: NodeJS.Platform;
  scriptPath: string;
}

interface KillSetupScriptProcessArgs {
  child: PortableOutputChildProcess;
  signal: NodeJS.Signals;
}

const SETUP_SCRIPT_ABORT_KILL_GRACE_MS = 2_000;

function emitProgress(
  onProgress: ProgressCallback | undefined,
  entry: ProvisioningTranscriptEntry,
): void {
  onProgress?.(entry);
}

function emitStep(args: EmitStepArgs): void {
  emitProgress(args.onProgress, {
    type: "step",
    key: args.key,
    text: args.text,
    status: args.status,
    startedAt: args.startedAt ?? Date.now(),
    metadata: args.metadata,
  });
}

function emitOutput(
  onProgress: ProgressCallback | undefined,
  key: string,
  text: string,
): void {
  emitProgress(onProgress, {
    type: "output",
    key,
    text,
    startedAt: Date.now(),
  });
}

function emitCwd(args: {
  onProgress: ProgressCallback | undefined;
  keySuffix: string;
  cwd: string;
}): void {
  emitStep({
    onProgress: args.onProgress,
    key: `workspace-${args.keySuffix}`,
    text: `Using workspace: ${args.cwd}`,
    status: "completed",
  });
}

function emitGitOutput(
  onProgress: ProgressCallback | undefined,
  key: string,
  result: GitCommandResult,
): void {
  const lines = readTerminalOutputLines(result.stdout + result.stderr);
  if (lines.length === 0) {
    return;
  }
  let index = 0;
  for (const line of lines) {
    index += 1;
    emitOutput(onProgress, `${key}-output-${index}`, line);
  }
}

async function ensureExistingWorkspaceMatches(
  sourcePath: string,
  targetPath: string,
  branchName: string,
  startPoint: WorktreeStartPoint,
): Promise<boolean> {
  if (!(await pathExists(targetPath))) {
    return false;
  }

  const workspace = new Workspace(targetPath);
  if (!(await workspace.isGitRepo)) {
    throw new WorkspaceError(
      "path_exists",
      `Target path exists but is not a git repo: ${targetPath}`,
    );
  }

  if ((await workspace.currentBranch) !== branchName) {
    throw new WorkspaceError(
      "path_exists",
      `Target path exists on the wrong branch: ${targetPath}`,
    );
  }

  if (startPoint.kind === "revision") {
    const [sourceCommonDir, targetCommonDir] = await Promise.all([
      getGitCommonDir(sourcePath).then((commonDir) => fs.realpath(commonDir)),
      getGitCommonDir(targetPath).then((commonDir) => fs.realpath(commonDir)),
    ]);
    if (sourceCommonDir !== targetCommonDir) {
      throw new WorkspaceError(
        "revision_mismatch",
        `Target path belongs to a different Git repository: ${targetPath}`,
      );
    }
    await requireWorkspaceRevision(targetPath, startPoint);
  }

  return true;
}

async function ensureWorkspaceParentDirectory(
  targetPath: string,
): Promise<void> {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
}

async function resolveSetupScriptPath(
  workspacePath: string,
): Promise<string | null> {
  const scriptPath = path.join(workspacePath, DEFAULT_ENV_SETUP_SCRIPT_NAME);
  return (await pathExists(scriptPath)) ? scriptPath : null;
}

export function buildSetupScriptCommand(
  args: BuildSetupScriptCommandArgs,
): SetupScriptCommand {
  if (args.platform === "win32") {
    throw new WorkspaceError(
      "setup_script_failed",
      `POSIX shell setup scripts are not supported on Windows: ${DEFAULT_ENV_SETUP_SCRIPT_NAME}`,
    );
  }

  return {
    command: "env",
    args: ["bash", args.scriptPath],
    text: `env bash ${DEFAULT_ENV_SETUP_SCRIPT_NAME}`,
  };
}

function shouldRunSetupScriptInProcessGroup(): boolean {
  return process.platform !== "win32";
}

function killSetupScriptProcess(args: KillSetupScriptProcessArgs): void {
  if (shouldRunSetupScriptInProcessGroup() && args.child.pid !== undefined) {
    try {
      process.kill(-args.child.pid, args.signal);
      return;
    } catch {
      // Fall back to killing the direct child if the process group is gone.
    }
  }

  args.child.kill(args.signal);
}

function createProvisionCancelledError(cause?: unknown): WorkspaceError {
  return new WorkspaceError(
    "provision_cancelled",
    "Workspace provisioning was cancelled",
    { cause },
  );
}

function throwIfProvisionAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw createProvisionCancelledError(signal.reason);
  }
}

function isProvisionAbortError(error: unknown): boolean {
  return (
    error instanceof WorkspaceError && error.code === "provision_cancelled"
  );
}

async function resolveRemoteBaseBranch(
  sourcePath: string,
  baseBranch: string,
  signal: AbortSignal | undefined,
): Promise<{ remote: string; branch: string } | null> {
  if (!baseBranch.includes("/")) {
    return null;
  }

  const remotes = (await runGit(["remote"], { cwd: sourcePath, signal })).stdout
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

async function fetchRemoteBaseBranch(args: {
  sourcePath: string;
  baseBranch: string;
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

  const refspec = `+refs/heads/${remoteBase.branch}:refs/remotes/${remoteBase.remote}/${remoteBase.branch}`;
  try {
    await runGit(["fetch", "--quiet", remoteBase.remote, refspec], {
      cwd: args.sourcePath,
      signal: args.signal,
    });
    emitStep({
      onProgress: args.onProgress,
      key: "git-fetch-completed",
      text: `Fetched ${args.baseBranch}`,
      status: "completed",
      startedAt,
      metadata: {
        durationMs: Date.now() - startedAt,
      },
    });
  } catch (error) {
    emitStep({
      onProgress: args.onProgress,
      key: "git-fetch-failed",
      text: `Failed to fetch ${args.baseBranch}`,
      status: "failed",
      startedAt,
      metadata: {
        durationMs: Date.now() - startedAt,
      },
    });
    throw error;
  }
}

async function resolveRevisionFetchTarget(args: {
  sourcePath: string;
  baseBranch: string | null;
  signal: AbortSignal | undefined;
}): Promise<{ remote: string; branch: string | null }> {
  if (args.baseBranch !== null) {
    const remoteBase = await resolveRemoteBaseBranch(
      args.sourcePath,
      args.baseBranch,
      args.signal,
    );
    if (remoteBase) {
      return remoteBase;
    }
  }

  const remotes = (
    await runGit(["remote"], {
      cwd: args.sourcePath,
      signal: args.signal,
    })
  ).stdout
    .split("\n")
    .map((remote) => remote.trim())
    .filter(Boolean);
  if (remotes.includes("origin")) {
    return { remote: "origin", branch: args.baseBranch };
  }
  if (remotes.length === 1 && remotes[0] !== undefined) {
    return { remote: remotes[0], branch: args.baseBranch };
  }
  throw new WorkspaceError(
    "revision_unavailable",
    `Cannot select a remote to fetch the requested revision from: ${args.sourcePath}`,
  );
}

async function requireCompatibleObjectFormat(args: {
  sourcePath: string;
  revision: string;
  signal: AbortSignal | undefined;
}): Promise<void> {
  const format = (
    await runGit(["rev-parse", "--show-object-format"], {
      cwd: args.sourcePath,
      signal: args.signal,
    })
  ).stdout.trim();
  const expectedLength = format === "sha1" ? 40 : format === "sha256" ? 64 : 0;
  if (args.revision.length !== expectedLength) {
    throw new WorkspaceError(
      "revision_unavailable",
      `Requested revision does not match repository object format: ${args.sourcePath}`,
    );
  }
}

async function hasCommit(args: {
  sourcePath: string;
  revision: string;
  signal: AbortSignal | undefined;
}): Promise<boolean> {
  const result = await runGit(["cat-file", "-e", `${args.revision}^{commit}`], {
    cwd: args.sourcePath,
    signal: args.signal,
    allowFailure: true,
  });
  return result.exitCode === 0;
}

async function fetchRevision(args: {
  sourcePath: string;
  baseBranch: string | null;
  revision: string;
  onProgress: ProgressCallback | undefined;
  signal: AbortSignal | undefined;
}): Promise<void> {
  if (await hasCommit(args)) {
    return;
  }
  let remote: string;
  let branch: string | null;
  try {
    await requireCompatibleObjectFormat(args);
    ({ remote, branch } = await resolveRevisionFetchTarget(args));
  } catch (error) {
    if (
      error instanceof WorkspaceError &&
      (error.code === "provision_cancelled" ||
        error.code === "git_command_timeout" ||
        error.code === "revision_unavailable")
    ) {
      throw error;
    }
    throw new WorkspaceError(
      "revision_unavailable",
      `Cannot prepare to fetch requested revision ${args.revision}`,
      { cause: error },
    );
  }
  const startedAt = Date.now();
  emitStep({
    onProgress: args.onProgress,
    key: "git-fetch-revision-started",
    text: `Fetching revision ${args.revision.slice(0, 12)}`,
    status: "started",
    startedAt,
  });
  try {
    const fetchResults: GitCommandResult[] = [];
    if (branch !== null) {
      fetchResults.push(
        await runGit(
          [
            "fetch",
            "--quiet",
            "--no-write-fetch-head",
            "--refmap=",
            remote,
            `refs/heads/${branch}`,
          ],
          { cwd: args.sourcePath, signal: args.signal, allowFailure: true },
        ),
      );
    }
    if (!(await hasCommit(args))) {
      fetchResults.push(
        await runGit(
          [
            "fetch",
            "--quiet",
            "--no-write-fetch-head",
            "--refmap=",
            remote,
            args.revision,
          ],
          { cwd: args.sourcePath, signal: args.signal, allowFailure: true },
        ),
      );
    }
    if (!(await hasCommit(args))) {
      const completedFetch = fetchResults.some(
        (result) => result.exitCode === 0,
      );
      throw new WorkspaceError(
        completedFetch
          ? "revision_missing_after_fetch"
          : "revision_unavailable",
        `Fetched object is not a commit: ${args.revision}`,
      );
    }
  } catch (error) {
    emitStep({
      onProgress: args.onProgress,
      key: "git-fetch-revision-failed",
      text: `Failed to fetch revision ${args.revision.slice(0, 12)}`,
      status: "failed",
      startedAt,
      metadata: { durationMs: Date.now() - startedAt },
    });
    if (
      error instanceof WorkspaceError &&
      (error.code === "provision_cancelled" ||
        error.code === "git_command_timeout" ||
        error.code === "revision_missing_after_fetch" ||
        error.code === "revision_unavailable")
    ) {
      throw error;
    }
    throw new WorkspaceError(
      "revision_unavailable",
      `Cannot fetch requested revision ${args.revision}`,
      { cause: error },
    );
  }
  emitStep({
    onProgress: args.onProgress,
    key: "git-fetch-revision-completed",
    text: `Fetched revision ${args.revision.slice(0, 12)}`,
    status: "completed",
    startedAt,
    metadata: { durationMs: Date.now() - startedAt },
  });
}

async function requireWorkspaceRevision(
  targetPath: string,
  startPoint: Extract<WorktreeStartPoint, { kind: "revision" }>,
): Promise<string> {
  const workspace = new Workspace(targetPath);
  const head = await workspace.getHeadSha();
  if (head === startPoint.revision) {
    return head;
  }
  if (head !== null && startPoint.allowExistingDescendant) {
    const relation = await runGit(
      ["merge-base", "--is-ancestor", startPoint.revision, head],
      { cwd: targetPath, allowFailure: true },
    );
    if (relation.exitCode === 0) {
      return head;
    }
  }
  throw new WorkspaceError(
    "revision_mismatch",
    `Target path exists at the wrong revision: ${targetPath}`,
  );
}

async function buildRevisionWorktreeArgs(args: {
  sourcePath: string;
  targetPath: string;
  branchName: string;
  revision: string;
  allowExistingDescendant: boolean;
  signal: AbortSignal | undefined;
}): Promise<string[]> {
  const branchRef = `refs/heads/${args.branchName}`;
  const existing = await runGit(["show-ref", "--verify", branchRef], {
    cwd: args.sourcePath,
    signal: args.signal,
    allowFailure: true,
  });
  if (existing.exitCode !== 0) {
    return [
      "worktree",
      "add",
      "-b",
      args.branchName,
      args.targetPath,
      args.revision,
    ];
  }

  const branchRevision = existing.stdout.trim().split(/\s+/u)[0];
  const exact = branchRevision === args.revision;
  const descendant =
    !exact && args.allowExistingDescendant
      ? await runGit(
          ["merge-base", "--is-ancestor", args.revision, branchRef],
          { cwd: args.sourcePath, signal: args.signal, allowFailure: true },
        )
      : null;
  if (!exact && descendant?.exitCode !== 0) {
    throw new WorkspaceError(
      "revision_mismatch",
      `Managed branch exists at the wrong revision: ${args.branchName}`,
    );
  }
  return ["worktree", "add", args.targetPath, args.branchName];
}

export async function createWorktree(
  args: CreateWorkspaceArgs,
): Promise<{ path: string }> {
  throwIfProvisionAborted(args.signal);
  if (
    await ensureExistingWorkspaceMatches(
      args.sourcePath,
      args.targetPath,
      args.branchName,
      args.startPoint,
    )
  ) {
    return { path: args.targetPath };
  }

  throwIfProvisionAborted(args.signal);
  switch (await readGitRepositoryState(args.sourcePath)) {
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
  await ensureWorkspaceParentDirectory(args.targetPath);

  throwIfProvisionAborted(args.signal);
  let gitArgs: string[];
  if (args.startPoint.kind === "branch") {
    const baseBranch =
      args.startPoint.baseBranch ?? (await readDefaultBranch(args.sourcePath));
    if (!baseBranch) {
      throw new WorkspaceError(
        "missing_default_branch",
        `Cannot resolve default branch for source: ${args.sourcePath}`,
      );
    }
    throwIfProvisionAborted(args.signal);
    await fetchRemoteBaseBranch({
      sourcePath: args.sourcePath,
      baseBranch,
      onProgress: args.onProgress,
      signal: args.signal,
    });
    gitArgs = [
      "worktree",
      "add",
      "-B",
      args.branchName,
      args.targetPath,
      baseBranch,
    ];
  } else {
    await fetchRevision({
      sourcePath: args.sourcePath,
      baseBranch: args.startPoint.baseBranch,
      revision: args.startPoint.revision,
      onProgress: args.onProgress,
      signal: args.signal,
    });
    gitArgs = await buildRevisionWorktreeArgs({
      sourcePath: args.sourcePath,
      targetPath: args.targetPath,
      branchName: args.branchName,
      revision: args.startPoint.revision,
      allowExistingDescendant: args.startPoint.allowExistingDescendant,
      signal: args.signal,
    });
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
      signal: args.signal,
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
    if (args.startPoint.kind === "revision") {
      await requireWorkspaceRevision(args.targetPath, args.startPoint);
    }
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
    await runSetupScript({
      workspacePath: args.targetPath,
      timeoutMs: args.timeoutMs,
      setupPath: args.setupPath,
      onProgress: args.onProgress,
      signal: args.signal,
    });
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
    await removeWorktree({
      path: args.targetPath,
      force: true,
      pruneEmptyParent: args.pruneEmptyParent,
    });
    throw error;
  }
}

/**
 * Cap on paths named in one transcript entry. A broad pattern can match
 * thousands of files, and the daemon keeps and forwards the whole transcript.
 */
const WORKTREE_INCLUDE_TRANSCRIPT_PATH_LIMIT = 20;

function summarizePaths(paths: readonly string[]): string {
  const shown = paths.slice(0, WORKTREE_INCLUDE_TRANSCRIPT_PATH_LIMIT);
  const hiddenCount = paths.length - shown.length;
  const suffix = hiddenCount > 0 ? `, and ${hiddenCount} more` : "";
  return `${shown.join(", ")}${suffix}`;
}

/**
 * Copy the untracked files listed in `.worktreeinclude` into the new worktree
 * and report the result in the provisioning transcript. This runs before the
 * setup script so the script can read a copied `.env`.
 *
 * A failure here never fails provisioning: the transcript reports what bb
 * skipped and the thread still starts. Only cancellation propagates.
 */
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
      `Copied ${result.copied.length} file(s): ${summarizePaths(
        result.copied,
      )}`,
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

export async function runSetupScript(
  args: RunSetupScriptArgs,
): Promise<{ ran: boolean; exitCode?: number; output?: string }> {
  throwIfProvisionAborted(args.signal);
  const scriptPath = await resolveSetupScriptPath(args.workspacePath);
  if (!scriptPath) {
    return { ran: false };
  }

  throwIfProvisionAborted(args.signal);
  const command = buildSetupScriptCommand({
    platform: process.platform,
    scriptPath,
  });
  const startedAt = Date.now();
  emitStep({
    onProgress: args.onProgress,
    key: "setup-started",
    text: "Running .bb-env-setup.sh",
    status: "started",
    startedAt,
  });

  const { timeoutMs } = args;
  const env = sanitizeInheritedChildProcessEnv({ env: process.env });
  if (args.setupPath !== undefined) {
    env.PATH = args.setupPath;
  }
  const child = spawnPortableOutputProcess({
    command: command.command,
    args: command.args,
    cwd: args.workspacePath,
    detached: shouldRunSetupScriptInProcessGroup(),
    env,
  });

  const outputChunks: string[] = [];
  const outputLineReader = createTerminalOutputLineReader();
  let outputIndex = 0;
  let abortKillTimeout: ReturnType<typeof setTimeout> | undefined;
  let abortRequested = false;
  let timedOut = false;

  const emitSetupOutputLines = (lines: string[]): void => {
    for (const line of lines) {
      outputIndex += 1;
      emitOutput(args.onProgress, `setup-output-${outputIndex}`, line);
    }
  };

  const handleChunk = (chunk: Buffer) => {
    const text = chunk.toString("utf8");
    outputChunks.push(text);
    emitSetupOutputLines(outputLineReader.push(text));
  };

  child.stdout.on("data", handleChunk);
  child.stderr.on("data", handleChunk);

  const timeout = setTimeout(() => {
    timedOut = true;
    killSetupScriptProcess({
      child,
      signal: "SIGKILL",
    });
  }, timeoutMs);
  const abortSetupScript = () => {
    if (abortRequested) {
      return;
    }
    abortRequested = true;
    killSetupScriptProcess({
      child,
      signal: "SIGTERM",
    });
    abortKillTimeout = setTimeout(() => {
      killSetupScriptProcess({
        child,
        signal: "SIGKILL",
      });
    }, SETUP_SCRIPT_ABORT_KILL_GRACE_MS);
  };
  args.signal?.addEventListener("abort", abortSetupScript, { once: true });
  if (args.signal?.aborted) {
    abortSetupScript();
  }

  try {
    const result = await new Promise<{
      exitCode: number | null;
      signal: NodeJS.Signals | null;
    }>((resolve, reject) => {
      child.on("error", reject);
      child.on("close", (exitCode, signal) => resolve({ exitCode, signal }));
    });

    const output = outputChunks.join("");
    emitSetupOutputLines(outputLineReader.flush());
    const durationMs = Date.now() - startedAt;
    if (abortRequested || args.signal?.aborted) {
      emitStep({
        onProgress: args.onProgress,
        key: "setup-cancelled",
        text: ".bb-env-setup.sh cancelled",
        status: "failed",
        startedAt,
        metadata: { durationMs },
      });
      throw createProvisionCancelledError(args.signal?.reason);
    }

    if (timedOut) {
      emitStep({
        onProgress: args.onProgress,
        key: "setup-failed",
        text: ".bb-env-setup.sh failed",
        status: "failed",
        startedAt,
        metadata: { durationMs },
      });
      throw new WorkspaceError(
        "setup_script_failed",
        `Setup script timed out after ${timeoutMs}ms: ${scriptPath}`,
      );
    }

    if (result.signal) {
      emitStep({
        onProgress: args.onProgress,
        key: "setup-failed",
        text: ".bb-env-setup.sh failed",
        status: "failed",
        startedAt,
        metadata: { durationMs },
      });
      throw new WorkspaceError(
        "setup_script_failed",
        `Setup script exited via signal ${result.signal}: ${scriptPath}`,
      );
    }

    if ((result.exitCode ?? 0) !== 0) {
      emitStep({
        onProgress: args.onProgress,
        key: "setup-failed",
        text: ".bb-env-setup.sh failed",
        status: "failed",
        startedAt,
        metadata: { durationMs },
      });
      throw new WorkspaceError(
        "setup_script_failed",
        `Setup script failed with exit code ${result.exitCode}: ${scriptPath}`,
      );
    }

    emitStep({
      onProgress: args.onProgress,
      key: "setup-completed",
      text: ".bb-env-setup.sh finished",
      status: "completed",
      startedAt,
      metadata: { durationMs },
    });
    return { ran: true, exitCode: result.exitCode ?? 0, output };
  } finally {
    clearTimeout(timeout);
    if (abortKillTimeout) {
      clearTimeout(abortKillTimeout);
    }
    args.signal?.removeEventListener("abort", abortSetupScript);
  }
}

export async function removeWorktree(args: RemoveWorktreeArgs): Promise<void> {
  const force = args.force !== false;
  const workspacePath = path.resolve(args.path);
  const parentPath = path.dirname(workspacePath);
  if (!(await pathExists(workspacePath))) {
    if (args.pruneEmptyParent) {
      await removeDirectoryIfEmpty(parentPath);
    }
    return;
  }

  const commonDirResult = await runGit(["rev-parse", "--git-common-dir"], {
    cwd: workspacePath,
    allowFailure: true,
  });

  if (commonDirResult.exitCode === 0) {
    const commonDir = path.resolve(
      workspacePath,
      commonDirResult.stdout.trim(),
    );
    // Lock order is checkout mutation first, worktree metadata second. Keep
    // every path that needs both locks in this order so two callers cannot each
    // hold one git lock domain while waiting for the other.
    await tryWithCheckoutMutationLock(workspacePath, () =>
      withWorktreeMetadataLock(commonDir, () =>
        runGit(
          [
            "--git-dir",
            commonDir,
            "worktree",
            "remove",
            workspacePath,
            ...(force ? ["--force"] : []),
          ],
          {
            cwd: path.dirname(workspacePath),
            allowFailure: true,
          },
        ),
      ),
    );
  }

  // Git metadata cleanup is best-effort because broken teardown states often
  // leave a directory that no longer resolves as a worktree. The managed
  // workspace directory itself is the authoritative cleanup target.
  await fs.rm(workspacePath, { recursive: true, force: true });
  if (args.pruneEmptyParent) {
    await removeDirectoryIfEmpty(parentPath);
  }
}

export async function removeDirectory(args: { path: string }): Promise<void> {
  await fs.rm(args.path, { recursive: true, force: true });
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
