import fs from "node:fs/promises";
import path from "node:path";
import {
  DEFAULT_ENV_SETUP_SCRIPT_NAME,
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
  readDefaultBranch,
  runGit,
  WorkspaceError,
  type GitCommandResult,
} from "./git.js";
import {
  runGitWithWorktreeMetadataLock,
  withWorktreeMetadataLock,
} from "./worktree-metadata-lock.js";

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
  environmentId?: string;
  /** Local repo path for worktrees */
  sourcePath: string;
  targetPath: string;
  /** Name of the new branch to create on the workspace. */
  branchName: string;
  /**
   * Branch to base the new branch on (start point for git worktree add / git
   * checkout). Pass `null` to use the source's default branch (resolved by
   * the daemon).
   */
  baseBranch: string | null;
  /** Setup script timeout in ms. Controlled by the server. */
  timeoutMs: number;
  worktreeInitScript?: string | null;
  onProgress?: ProgressCallback;
  pruneEmptyParent?: boolean;
  signal?: AbortSignal;
}

export interface RunSetupScriptArgs {
  workspacePath: string;
  environmentId?: string;
  branchName?: string;
  script?: string | null;
  sourcePath?: string;
  timeoutMs: number;
  onProgress?: ProgressCallback;
  signal?: AbortSignal;
}

export interface RunTeardownScriptArgs {
  workspacePath: string;
  environmentId?: string;
  script: string | null;
  timeoutMs: number;
}

export interface RemoveWorktreeArgs {
  path: string;
  environmentId?: string;
  force?: boolean;
  pruneEmptyParent?: boolean;
  worktreeTeardownScript?: string | null;
}

interface SetupScriptCommand {
  command: string;
  args: string[];
  text: string;
}

type LifecycleScriptPhase = "init" | "teardown";

interface LifecycleScriptLabels {
  cancelledText: string;
  completedText: string;
  errorPrefix: string;
  failedText: string;
  outputKeyPrefix: string;
  scriptDescription: string;
  startedKey: string;
  startedText: string;
}

interface RunLifecycleScriptArgs {
  branchName?: string;
  environmentId?: string;
  labels: LifecycleScriptLabels;
  phase: LifecycleScriptPhase;
  script: SetupScriptCommand;
  sourcePath?: string;
  signal?: AbortSignal;
  timeoutMs: number;
  workspacePath: string;
  onProgress?: ProgressCallback;
}

interface BuildSetupScriptCommandArgs {
  platform: NodeJS.Platform;
  scriptPath: string;
}

interface BuildInlineScriptCommandArgs {
  platform: NodeJS.Platform;
  script: string;
  scriptDescription: string;
}

interface KillSetupScriptProcessArgs {
  child: PortableOutputChildProcess;
  signal: NodeJS.Signals;
}

const SETUP_SCRIPT_ABORT_KILL_GRACE_MS = 2_000;
const TEARDOWN_SCRIPT_TIMEOUT_MS = 15 * 60 * 1000;

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
  targetPath: string,
  branchName: string,
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

export function buildInlineScriptCommand(
  args: BuildInlineScriptCommandArgs,
): SetupScriptCommand {
  if (args.platform === "win32") {
    throw new WorkspaceError(
      "setup_script_failed",
      `POSIX shell lifecycle scripts are not supported on Windows: ${args.scriptDescription}`,
    );
  }

  return {
    command: "env",
    args: ["bash", "-lc", args.script],
    text: `env bash -lc ${args.scriptDescription}`,
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

function buildLifecycleScriptEnv(args: {
  branchName?: string;
  environmentId?: string;
  phase: LifecycleScriptPhase;
  sourcePath?: string;
  workspacePath: string;
}): NodeJS.ProcessEnv {
  return {
    ...sanitizeInheritedChildProcessEnv({ env: process.env }),
    BB_WORKTREE_PATH: args.workspacePath,
    BB_WORKTREE_PHASE: args.phase,
    ...(args.branchName ? { BB_WORKTREE_BRANCH: args.branchName } : {}),
    ...(args.environmentId ? { BB_ENVIRONMENT_ID: args.environmentId } : {}),
    ...(args.sourcePath ? { BB_SOURCE_PATH: args.sourcePath } : {}),
  };
}

function throwIfProvisionAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw createProvisionCancelledError(signal.reason);
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
    await runGit(["remote"], { cwd: sourcePath, signal })
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

export async function createWorktree(
  args: CreateWorkspaceArgs,
): Promise<{ path: string }> {
  throwIfProvisionAborted(args.signal);
  if (await ensureExistingWorkspaceMatches(args.targetPath, args.branchName)) {
    return { path: args.targetPath };
  }

  throwIfProvisionAborted(args.signal);
  await ensureWorkspaceParentDirectory(args.targetPath);

  throwIfProvisionAborted(args.signal);
  const baseBranch =
    args.baseBranch ?? (await readDefaultBranch(args.sourcePath));
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

  const gitArgs = [
    "worktree",
    "add",
    "-B",
    args.branchName,
    args.targetPath,
    baseBranch,
  ];
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
    emitCwd({
      onProgress: args.onProgress,
      keySuffix: "target",
      cwd: args.targetPath,
    });
    await runSetupScript({
      workspacePath: args.targetPath,
      branchName: args.branchName,
      environmentId: args.environmentId,
      script: args.worktreeInitScript,
      sourcePath: args.sourcePath,
      timeoutMs: args.timeoutMs,
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

export async function runSetupScript(
  args: RunSetupScriptArgs,
): Promise<{ ran: boolean; exitCode?: number; output?: string }> {
  throwIfProvisionAborted(args.signal);
  const inlineScript =
    args.script && args.script.trim().length > 0 ? args.script : null;
  if (inlineScript) {
    const command = buildInlineScriptCommand({
      platform: process.platform,
      script: inlineScript,
      scriptDescription: "worktree init script",
    });
    return runLifecycleScript({
      branchName: args.branchName,
      environmentId: args.environmentId,
      labels: {
        cancelledText: "Worktree init script cancelled",
        completedText: "Worktree init script finished",
        errorPrefix: "Worktree init script",
        failedText: "Worktree init script failed",
        outputKeyPrefix: "worktree-init",
        scriptDescription: "worktree init script",
        startedKey: "worktree-init-started",
        startedText: "Running worktree init script",
      },
      phase: "init",
      script: command,
      sourcePath: args.sourcePath,
      signal: args.signal,
      timeoutMs: args.timeoutMs,
      workspacePath: args.workspacePath,
      onProgress: args.onProgress,
    });
  }

  const scriptPath = await resolveSetupScriptPath(args.workspacePath);
  if (!scriptPath) {
    return { ran: false };
  }

  throwIfProvisionAborted(args.signal);
  const command = buildSetupScriptCommand({
    platform: process.platform,
    scriptPath,
  });
  return runLifecycleScript({
    branchName: args.branchName,
    environmentId: args.environmentId,
    labels: {
      cancelledText: ".bb-env-setup.sh cancelled",
      completedText: ".bb-env-setup.sh finished",
      errorPrefix: "Setup script",
      failedText: ".bb-env-setup.sh failed",
      outputKeyPrefix: "setup",
      scriptDescription: scriptPath,
      startedKey: "setup-started",
      startedText: "Running .bb-env-setup.sh",
    },
    phase: "init",
    script: command,
    sourcePath: args.sourcePath,
    signal: args.signal,
    timeoutMs: args.timeoutMs,
    workspacePath: args.workspacePath,
    onProgress: args.onProgress,
  });
}

async function runLifecycleScript(
  args: RunLifecycleScriptArgs,
): Promise<{ ran: boolean; exitCode?: number; output?: string }> {
  const startedAt = Date.now();
  emitStep({
    onProgress: args.onProgress,
    key: args.labels.startedKey,
    text: args.labels.startedText,
    status: "started",
    startedAt,
  });

  const { timeoutMs } = args;
  const child = spawnPortableOutputProcess({
    command: args.script.command,
    args: args.script.args,
    cwd: args.workspacePath,
    detached: shouldRunSetupScriptInProcessGroup(),
    env: buildLifecycleScriptEnv({
      branchName: args.branchName,
      environmentId: args.environmentId,
      phase: args.phase,
      sourcePath: args.sourcePath,
      workspacePath: args.workspacePath,
    }),
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
      emitOutput(
        args.onProgress,
        `${args.labels.outputKeyPrefix}-output-${outputIndex}`,
        line,
      );
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
        key: `${args.labels.outputKeyPrefix}-cancelled`,
        text: args.labels.cancelledText,
        status: "failed",
        startedAt,
        metadata: { durationMs },
      });
      throw createProvisionCancelledError(args.signal?.reason);
    }

    if (timedOut) {
      emitStep({
        onProgress: args.onProgress,
        key: `${args.labels.outputKeyPrefix}-failed`,
        text: args.labels.failedText,
        status: "failed",
        startedAt,
        metadata: { durationMs },
      });
      throw new WorkspaceError(
        "setup_script_failed",
        `${args.labels.errorPrefix} timed out after ${timeoutMs}ms: ${args.labels.scriptDescription}`,
      );
    }

    if (result.signal) {
      emitStep({
        onProgress: args.onProgress,
        key: `${args.labels.outputKeyPrefix}-failed`,
        text: args.labels.failedText,
        status: "failed",
        startedAt,
        metadata: { durationMs },
      });
      throw new WorkspaceError(
        "setup_script_failed",
        `${args.labels.errorPrefix} exited via signal ${result.signal}: ${args.labels.scriptDescription}`,
      );
    }

    if ((result.exitCode ?? 0) !== 0) {
      emitStep({
        onProgress: args.onProgress,
        key: `${args.labels.outputKeyPrefix}-failed`,
        text: args.labels.failedText,
        status: "failed",
        startedAt,
        metadata: { durationMs },
      });
      throw new WorkspaceError(
        "setup_script_failed",
        `${args.labels.errorPrefix} failed with exit code ${result.exitCode}: ${args.labels.scriptDescription}`,
      );
    }

    emitStep({
      onProgress: args.onProgress,
      key: `${args.labels.outputKeyPrefix}-completed`,
      text: args.labels.completedText,
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

export async function runTeardownScript(
  args: RunTeardownScriptArgs,
): Promise<{ ran: boolean; exitCode?: number; output?: string }> {
  const inlineScript =
    args.script && args.script.trim().length > 0 ? args.script : null;
  if (!inlineScript) {
    return { ran: false };
  }
  const command = buildInlineScriptCommand({
    platform: process.platform,
    script: inlineScript,
    scriptDescription: "worktree teardown script",
  });
  return runLifecycleScript({
    environmentId: args.environmentId,
    labels: {
      cancelledText: "Worktree teardown script cancelled",
      completedText: "Worktree teardown script finished",
      errorPrefix: "Worktree teardown script",
      failedText: "Worktree teardown script failed",
      outputKeyPrefix: "worktree-teardown",
      scriptDescription: "worktree teardown script",
      startedKey: "worktree-teardown-started",
      startedText: "Running worktree teardown script",
    },
    phase: "teardown",
    script: command,
    timeoutMs: args.timeoutMs,
    workspacePath: args.workspacePath,
  });
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

  await runTeardownScript({
    workspacePath,
    environmentId: args.environmentId,
    script: args.worktreeTeardownScript ?? null,
    timeoutMs: TEARDOWN_SCRIPT_TIMEOUT_MS,
  });

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
