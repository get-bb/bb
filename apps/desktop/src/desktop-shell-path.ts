import { execFile } from "node:child_process";

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

type EnsurePackagedUserShellPathResult =
  | ShellPathSkippedResult
  | ShellPathUpdatedResult
  | ShellPathUnchangedResult;

interface EnsurePackagedUserShellPathArgs {
  env: NodeJS.ProcessEnv;
  isPackaged: boolean;
  logger: DesktopShellPathLogger;
  platform: NodeJS.Platform;
  spawnLoginShellPath?: SpawnLoginShellPath;
}

interface ShellPathSkippedResult {
  kind: "skipped";
  reason: "not-packaged" | "unsupported-platform";
}

interface ShellPathUnchangedResult {
  kind: "unchanged";
  reason: "empty-output" | "non-zero-status" | "shell-error" | "signal";
}

interface ShellPathUpdatedResult {
  kind: "updated";
  path: string;
}

function defaultSpawnLoginShellPath(
  args: SpawnLoginShellPathArgs,
): Promise<ShellPathSpawnResult> {
  return new Promise((resolve) => {
    execFile(
      args.command,
      args.args,
      { encoding: "utf8", timeout: args.timeoutMs },
      (error, stdout, stderr) => {
        const hasExitStatus = error !== null && Number.isInteger(error.code);
        const shellPathResult: ShellPathSpawnResult = {
          signal: error?.signal ?? null,
          status:
            error === null ? 0 : hasExitStatus ? Number(error.code) : null,
          stderr: stderr.toString(),
          stdout: stdout.toString(),
        };
        if (error !== null && !hasExitStatus) shellPathResult.error = error;
        resolve(shellPathResult);
      },
    );
  });
}

function warnShellPathFallback(
  args: EnsurePackagedUserShellPathArgs,
  message: string,
): void {
  args.logger.warn(
    `Could not load the user shell PATH for the packaged desktop app: ${message}. Continuing with the inherited PATH.`,
  );
}

export function ensurePackagedUserShellPath(
  args: EnsurePackagedUserShellPathArgs & {
    spawnLoginShellPath: SpawnLoginShellPath;
  },
): EnsurePackagedUserShellPathResult;
export function ensurePackagedUserShellPath(
  args: Omit<EnsurePackagedUserShellPathArgs, "spawnLoginShellPath">,
): Promise<EnsurePackagedUserShellPathResult>;
export function ensurePackagedUserShellPath(
  args: EnsurePackagedUserShellPathArgs,
):
  | EnsurePackagedUserShellPathResult
  | Promise<EnsurePackagedUserShellPathResult> {
  const hasInjectedSpawn = args.spawnLoginShellPath !== undefined;
  if (args.platform !== "darwin" && args.platform !== "linux") {
    const result: ShellPathSkippedResult = {
      kind: "skipped",
      reason: "unsupported-platform",
    };
    return hasInjectedSpawn ? result : Promise.resolve(result);
  }
  if (!args.isPackaged) {
    const result: ShellPathSkippedResult = {
      kind: "skipped",
      reason: "not-packaged",
    };
    return hasInjectedSpawn ? result : Promise.resolve(result);
  }

  const spawnArgs = {
    args: ["-ilc", SHELL_PATH_COMMAND],
    command:
      args.platform === "darwin"
        ? MACOS_LOGIN_SHELL
        : (args.env.SHELL ?? "/bin/bash"),
    timeoutMs: SHELL_PATH_TIMEOUT_MS,
  };
  if (args.spawnLoginShellPath !== undefined) {
    return finishShellPathUpdate(args, args.spawnLoginShellPath(spawnArgs));
  }
  return defaultSpawnLoginShellPath(spawnArgs).then((result) =>
    finishShellPathUpdate(args, result),
  );
}

function finishShellPathUpdate(
  args: EnsurePackagedUserShellPathArgs,
  result: ShellPathSpawnResult,
): EnsurePackagedUserShellPathResult {
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
