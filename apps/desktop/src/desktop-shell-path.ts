import { spawnSync } from "node:child_process";

const MACOS_LOGIN_SHELL = "/bin/zsh";
const SHELL_PATH_COMMAND = 'printf "%s" "$PATH"';
const SHELL_PATH_TIMEOUT_MS = 2_000;

export interface DesktopShellPathLogger {
  warn(message: string): void;
}

export interface SpawnLoginShellPathArgs {
  command: string;
  args: string[];
  timeoutMs: number;
}

export interface ShellPathSpawnResult {
  error?: Error;
  signal: NodeJS.Signals | null;
  status: number | null;
  stderr: string;
  stdout: string;
}

export type SpawnLoginShellPath = (
  args: SpawnLoginShellPathArgs,
) => ShellPathSpawnResult;

export type EnsurePackagedMacOsUserShellPathResult =
  | ShellPathSkippedResult
  | ShellPathUpdatedResult
  | ShellPathUnchangedResult;

export interface EnsurePackagedMacOsUserShellPathArgs {
  env: NodeJS.ProcessEnv;
  isPackaged: boolean;
  logger: DesktopShellPathLogger;
  platform: NodeJS.Platform;
  spawnLoginShellPath?: SpawnLoginShellPath;
}

export interface ShellPathSkippedResult {
  kind: "skipped";
  reason: "non-darwin" | "not-packaged";
}

export interface ShellPathUnchangedResult {
  kind: "unchanged";
  reason: "empty-output" | "non-zero-status" | "shell-error" | "signal";
}

export interface ShellPathUpdatedResult {
  kind: "updated";
  path: string;
}

function defaultSpawnLoginShellPath(
  args: SpawnLoginShellPathArgs,
): ShellPathSpawnResult {
  const result = spawnSync(args.command, args.args, {
    encoding: "utf8",
    timeout: args.timeoutMs,
  });

  return {
    ...(result.error === undefined ? {} : { error: result.error }),
    signal: result.signal,
    status: result.status,
    stderr: result.stderr,
    stdout: result.stdout,
  };
}

function warnShellPathFallback(
  args: EnsurePackagedMacOsUserShellPathArgs,
  message: string,
): void {
  args.logger.warn(
    `Could not load the user shell PATH for the packaged desktop app: ${message}. Continuing with the inherited PATH.`,
  );
}

export function ensurePackagedMacOsUserShellPath(
  args: EnsurePackagedMacOsUserShellPathArgs,
): EnsurePackagedMacOsUserShellPathResult {
  if (args.platform !== "darwin") {
    return { kind: "skipped", reason: "non-darwin" };
  }
  if (!args.isPackaged) {
    return { kind: "skipped", reason: "not-packaged" };
  }

  const spawnLoginShellPath =
    args.spawnLoginShellPath ?? defaultSpawnLoginShellPath;
  const result = spawnLoginShellPath({
    args: ["-ilc", SHELL_PATH_COMMAND],
    command: MACOS_LOGIN_SHELL,
    timeoutMs: SHELL_PATH_TIMEOUT_MS,
  });

  if (result.error !== undefined) {
    warnShellPathFallback(args, result.error.message);
    return { kind: "unchanged", reason: "shell-error" };
  }

  if (result.signal !== null) {
    warnShellPathFallback(args, `shell exited from signal ${result.signal}`);
    return { kind: "unchanged", reason: "signal" };
  }

  if (result.status !== 0) {
    const stderr = result.stderr.trim();
    warnShellPathFallback(
      args,
      stderr.length > 0
        ? `shell exited with status ${result.status}: ${stderr}`
        : `shell exited with status ${result.status}`,
    );
    return { kind: "unchanged", reason: "non-zero-status" };
  }

  const shellPath = result.stdout.trim();
  if (shellPath.length === 0) {
    warnShellPathFallback(args, "shell returned an empty PATH");
    return { kind: "unchanged", reason: "empty-output" };
  }

  args.env.PATH = shellPath;
  return { kind: "updated", path: shellPath };
}
