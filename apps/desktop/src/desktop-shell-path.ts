import { spawnSync } from "node:child_process";
import { win32 as pathWin32 } from "node:path";

const MACOS_LOGIN_SHELL = "/bin/zsh";
const SHELL_PATH_COMMAND = 'printf "%s" "$PATH"';
const SHELL_PATH_TIMEOUT_MS = 2_000;
const WINDOWS_PATH_DELIMITER = ";";
const WINDOWS_SYSTEM_ENVIRONMENT_KEY =
  "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment";
const WINDOWS_USER_ENVIRONMENT_KEY = "HKCU\\Environment";
const WINDOWS_REG_QUERY_TIMEOUT_MS = 2_000;
const WINDOWS_PATH_EXPAND_PASSES = 5;
const WINDOWS_REG_PATH_LINE =
  /^\s+Path\s+REG_(?:EXPAND_)?SZ\s+(.*)$/imu;

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

export type EnsurePackagedUserShellPathResult =
  | ShellPathSkippedResult
  | ShellPathUpdatedResult
  | ShellPathUnchangedResult;

export interface ReadWindowsEnvironmentPathArgs {
  env: NodeJS.ProcessEnv;
}

export type ReadWindowsEnvironmentPathResult =
  | {
      kind: "ok";
      systemPath: string;
      userPath: string;
    }
  | {
      kind: "error";
      message: string;
    };

export type ReadWindowsEnvironmentPath = (
  args: ReadWindowsEnvironmentPathArgs,
) => ReadWindowsEnvironmentPathResult;

export interface EnsurePackagedUserShellPathArgs {
  env: NodeJS.ProcessEnv;
  isPackaged: boolean;
  logger: DesktopShellPathLogger;
  platform: NodeJS.Platform;
  readWindowsEnvironmentPath?: ReadWindowsEnvironmentPath;
  spawnLoginShellPath?: SpawnLoginShellPath;
}

export interface ShellPathSkippedResult {
  kind: "skipped";
  reason: "not-packaged" | "unsupported-platform";
}

export interface ShellPathUnchangedResult {
  kind: "unchanged";
  reason:
    | "empty-output"
    | "non-zero-status"
    | "registry-error"
    | "shell-error"
    | "signal";
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

function lookupEnv(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const direct = env[name];
  if (direct !== undefined) {
    return direct;
  }
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(env)) {
    if (key.toLowerCase() === target) {
      return value;
    }
  }
  return undefined;
}

/** Expand `%VAR%` in a Windows registry Path using the process environment. */
export function expandWindowsEnvironmentString(
  value: string,
  env: NodeJS.ProcessEnv,
): string {
  let current = value;
  for (let pass = 0; pass < WINDOWS_PATH_EXPAND_PASSES; pass++) {
    const next = current.replace(/%([^%]+)%/gu, (match, name: string) => {
      if (name.toLowerCase() === "path") {
        return match;
      }
      const resolved = lookupEnv(env, name);
      return resolved !== undefined && resolved.length > 0 ? resolved : match;
    });
    if (next === current) {
      return current;
    }
    current = next;
  }
  return current;
}

/** Windows Explorer PATH: system Path, then user Path. */
export function joinWindowsRegistryPath(args: {
  systemPath: string;
  userPath: string;
}): string {
  return [args.systemPath, args.userPath]
    .map((part) => part.replace(/;+$/u, "").trim())
    .filter((part) => part.length > 0)
    .join(WINDOWS_PATH_DELIMITER);
}

function parseRegistryPathValue(stdout: string): string | null {
  const match = WINDOWS_REG_PATH_LINE.exec(stdout);
  if (match === null) {
    return null;
  }
  return match[1]?.trim() ?? "";
}

function queryWindowsRegistryPath(args: {
  env: NodeJS.ProcessEnv;
  key: string;
}): { kind: "ok"; value: string } | { kind: "missing" } | { kind: "error"; message: string } {
  const systemRoot =
    lookupEnv(args.env, "SystemRoot") ??
    lookupEnv(args.env, "windir") ??
    "C:\\Windows";
  const result = spawnSync(
    pathWin32.join(systemRoot, "System32", "reg.exe"),
    ["query", args.key, "/v", "Path"],
    {
      encoding: "utf8",
      timeout: WINDOWS_REG_QUERY_TIMEOUT_MS,
      windowsHide: true,
    },
  );

  if (result.error !== undefined) {
    return { kind: "error", message: result.error.message };
  }

  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  if (result.status !== 0) {
    const output = `${stdout}\n${stderr}`;
    if (/unable to find the specified registry key or value/iu.test(output)) {
      return { kind: "missing" };
    }
    const detail = stderr.trim() || stdout.trim() || `status ${result.status}`;
    return { kind: "error", message: detail };
  }

  const parsed = parseRegistryPathValue(stdout);
  if (parsed === null) {
    return { kind: "missing" };
  }
  return { kind: "ok", value: parsed };
}

function defaultReadWindowsEnvironmentPath(
  args: ReadWindowsEnvironmentPathArgs,
): ReadWindowsEnvironmentPathResult {
  const system = queryWindowsRegistryPath({
    env: args.env,
    key: WINDOWS_SYSTEM_ENVIRONMENT_KEY,
  });
  const user = queryWindowsRegistryPath({
    env: args.env,
    key: WINDOWS_USER_ENVIRONMENT_KEY,
  });

  if (system.kind === "error" && user.kind === "error") {
    return {
      kind: "error",
      message: `HKLM: ${system.message}; HKCU: ${user.message}`,
    };
  }
  if (system.kind === "error") {
    return { kind: "error", message: `HKLM: ${system.message}` };
  }

  return {
    kind: "ok",
    systemPath: system.kind === "ok" ? system.value : "",
    userPath: user.kind === "ok" ? user.value : "",
  };
}

function warnShellPathFallback(
  args: EnsurePackagedUserShellPathArgs,
  message: string,
): void {
  args.logger.warn(
    `Could not load the user shell PATH for the packaged desktop app: ${message}. Continuing with the inherited PATH.`,
  );
}

function applyPackagedPath(
  args: EnsurePackagedUserShellPathArgs,
  path: string,
): EnsurePackagedUserShellPathResult {
  if (path.length === 0) {
    warnShellPathFallback(args, "PATH source returned an empty PATH");
    return { kind: "unchanged", reason: "empty-output" };
  }
  args.env.PATH = path;
  return { kind: "updated", path };
}

function ensurePackagedWindowsRegistryPath(
  args: EnsurePackagedUserShellPathArgs,
): EnsurePackagedUserShellPathResult {
  const readWindowsEnvironmentPath =
    args.readWindowsEnvironmentPath ?? defaultReadWindowsEnvironmentPath;
  const result = readWindowsEnvironmentPath({ env: args.env });
  if (result.kind === "error") {
    warnShellPathFallback(args, `Windows registry PATH: ${result.message}`);
    return { kind: "unchanged", reason: "registry-error" };
  }

  return applyPackagedPath(
    args,
    joinWindowsRegistryPath({
      systemPath: expandWindowsEnvironmentString(result.systemPath, args.env),
      userPath: expandWindowsEnvironmentString(result.userPath, args.env),
    }),
  );
}

function ensurePackagedUnixLoginShellPath(
  args: EnsurePackagedUserShellPathArgs,
): EnsurePackagedUserShellPathResult {
  const spawnLoginShellPath =
    args.spawnLoginShellPath ?? defaultSpawnLoginShellPath;
  const result = spawnLoginShellPath({
    args: ["-ilc", SHELL_PATH_COMMAND],
    command:
      args.platform === "darwin"
        ? MACOS_LOGIN_SHELL
        : (args.env.SHELL ?? "/bin/bash"),
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

  return applyPackagedPath(args, result.stdout.trim());
}

/**
 * Replace the inherited PATH on a packaged desktop launch.
 *
 * Unix uses a login shell (`-ilc`). Windows reads HKLM then HKCU `Path`
 * (the registry environment block Explorer uses), not `pwsh -ilc`.
 */
export function ensurePackagedUserShellPath(
  args: EnsurePackagedUserShellPathArgs,
): EnsurePackagedUserShellPathResult {
  if (
    args.platform !== "darwin" &&
    args.platform !== "linux" &&
    args.platform !== "win32"
  ) {
    return { kind: "skipped", reason: "unsupported-platform" };
  }
  if (!args.isPackaged) {
    return { kind: "skipped", reason: "not-packaged" };
  }

  if (args.platform === "win32") {
    return ensurePackagedWindowsRegistryPath(args);
  }
  return ensurePackagedUnixLoginShellPath(args);
}
