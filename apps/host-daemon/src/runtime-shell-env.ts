import { spawnHostProcess as spawn } from "@bb/process-utils";
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import { delimiter, resolve, win32 } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentRuntimeOptions } from "@bb/agent-runtime";
import { assignIfDefined } from "@bb/config/objects";

interface ResolveLocalBbExecutablePathOptions {
  cliExecutablePath?: string;
  cliRuntimePath?: string;
}

interface PrepareRuntimeShellEnvOptions {
  bbExecutableDirectory: string;
  bbExecutablePath?: string;
  hostDaemonPort?: number;
  serverUrl: string;
  inheritedPath?: string;
  powershellExecutionPolicy?: string | null;
}

interface ResolveUserShellPathOptions {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  spawnUserShellEnv?: SpawnUserShellEnv;
  timeoutMs?: number;
}

interface ResolvePowerShellExecutionPolicyOptions extends ResolveUserShellPathOptions {
  readTextFile?: (filePath: string) => Promise<string | null>;
}

export interface SpawnUserShellEnvArgs {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
}

export interface UserShellEnvSpawnResult {
  error?: Error;
  signal: NodeJS.Signals | null;
  status: number | null;
  stderr: string;
  stdout: string;
}

export type SpawnUserShellEnv = (
  args: SpawnUserShellEnvArgs,
) => Promise<UserShellEnvSpawnResult>;

const USER_SHELL_ENV_TIMEOUT_MS = 3_000;
const POWERSHELL_EXECUTION_POLICY_VARIABLE = "PSExecutionPolicyPreference";
const WINDOWS_POWERSHELL_POLICY_KEYS = [
  "HKCU\\Software\\Microsoft\\PowerShell\\1\\ShellIds\\Microsoft.PowerShell",
  "HKLM\\SOFTWARE\\Microsoft\\PowerShell\\1\\ShellIds\\Microsoft.PowerShell",
];
const POWERSHELL_CONFIG_FILE_NAME = "powershell.config.json";
const POWERSHELL_CONFIG_POLICY_PATTERN = /ExecutionPolicy"\s*:/u;
const DEFAULT_POWERSHELL_EXECUTION_POLICY = "RemoteSigned";
const USER_SHELL_ENV_FORCE_KILL_AFTER_MS = 1_000;

function getDefaultCliExecutablePath(): string {
  return fileURLToPath(new URL("../../cli/bin/bb", import.meta.url));
}

function getDefaultCliRuntimePath(): string {
  return fileURLToPath(new URL("../../cli/dist/index.js", import.meta.url));
}

function getErrorCode(error: unknown): string | undefined {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code;
  }
  return undefined;
}

async function resolveCliEntryPath(cliExecutablePath: string): Promise<string> {
  const cliEntryPath = resolve(cliExecutablePath);

  try {
    const stats = await fs.stat(cliEntryPath);
    if (!stats.isFile()) {
      throw new Error(`Resolved bb CLI entry is not a file: ${cliEntryPath}`);
    }
    if (process.platform !== "win32") {
      try {
        await fs.access(cliEntryPath, fsConstants.X_OK);
      } catch (error) {
        if (getErrorCode(error) === "EACCES") {
          throw new Error(
            `Resolved bb CLI entry is not executable: ${cliEntryPath}. Build @bb/cli before starting the host daemon.`,
          );
        }
        throw error;
      }
    }
  } catch (error) {
    if (getErrorCode(error) === "ENOENT") {
      throw new Error(
        `Missing built bb CLI entry at ${cliEntryPath}. Build @bb/cli before starting the host daemon.`,
      );
    }
    throw error;
  }

  return cliEntryPath;
}

async function requireCliRuntimePath(cliRuntimePath: string): Promise<void> {
  const resolvedCliRuntimePath = resolve(cliRuntimePath);

  try {
    const stats = await fs.stat(resolvedCliRuntimePath);
    if (!stats.isFile()) {
      throw new Error(
        `Resolved bb CLI runtime is not a file: ${resolvedCliRuntimePath}`,
      );
    }
  } catch (error) {
    if (getErrorCode(error) === "ENOENT") {
      throw new Error(
        `Missing built bb CLI runtime at ${resolvedCliRuntimePath}. Build @bb/cli before starting the host daemon.`,
      );
    }
    throw error;
  }
}

function prependPath(
  executableDirectoryPath: string,
  inheritedPath?: string,
): string {
  return inheritedPath
    ? `${executableDirectoryPath}${delimiter}${inheritedPath}`
    : executableDirectoryPath;
}

function defaultSpawnUserShellEnv(
  args: SpawnUserShellEnvArgs,
): Promise<UserShellEnvSpawnResult> {
  return new Promise<UserShellEnvSpawnResult>((resolveSpawn) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let forceKillTimeout: ReturnType<typeof setTimeout> | undefined;
    let child: ReturnType<typeof spawn>;

    function clearTimeouts(args?: { keepForceKillTimeout?: boolean }): void {
      if (timeout) {
        clearTimeout(timeout);
        timeout = undefined;
      }
      if (!args?.keepForceKillTimeout && forceKillTimeout) {
        clearTimeout(forceKillTimeout);
        forceKillTimeout = undefined;
      }
    }

    function settle(
      result: UserShellEnvSpawnResult,
      args?: { keepForceKillTimeout?: boolean },
    ): void {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeouts(args);
      resolveSpawn(result);
    }

    function forceKillChildAfterDelay(): void {
      if (forceKillTimeout) {
        return;
      }
      forceKillTimeout = setTimeout(() => {
        child.kill("SIGKILL");
      }, USER_SHELL_ENV_FORCE_KILL_AFTER_MS);
      forceKillTimeout.unref();
    }

    function terminateChild(): void {
      child.kill("SIGTERM");
      forceKillChildAfterDelay();
    }

    try {
      child = spawn(args.command, args.args, {
        env: args.env,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      settle({
        error: error instanceof Error ? error : new Error(String(error)),
        signal: null,
        status: null,
        stderr,
        stdout,
      });
      return;
    }

    timeout = setTimeout(() => {
      terminateChild();
      settle(
        {
          error: new Error(
            `Shell env probe timed out after ${args.timeoutMs}ms`,
          ),
          signal: "SIGTERM",
          status: null,
          stderr,
          stdout,
        },
        { keepForceKillTimeout: true },
      );
    }, args.timeoutMs);
    timeout.unref();

    if (!child.stdout || !child.stderr) {
      terminateChild();
      settle(
        {
          error: new Error("Shell env probe did not attach stdout and stderr"),
          signal: null,
          status: null,
          stderr,
          stdout,
        },
        { keepForceKillTimeout: true },
      );
      return;
    }

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      if (settled) {
        clearTimeouts();
        return;
      }
      settle({
        error,
        signal: null,
        status: null,
        stderr,
        stdout,
      });
    });
    child.on("close", (status, signal) => {
      if (settled) {
        clearTimeouts();
        return;
      }
      settle({
        signal,
        status,
        stderr,
        stdout,
      });
    });
  });
}

function windowsEnvironmentValue(
  env: NodeJS.ProcessEnv,
  name: string,
): string | undefined {
  const key = Object.keys(env).find(
    (candidate) => candidate.toUpperCase() === name.toUpperCase(),
  );
  return key === undefined ? undefined : env[key];
}

function windowsRegistryCommand(env: NodeJS.ProcessEnv): string {
  return win32.join(
    windowsEnvironmentValue(env, "SystemRoot") ?? "C:\\Windows",
    "System32",
    "reg.exe",
  );
}

async function readOptionalTextFile(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

function powershellConfigPaths(env: NodeJS.ProcessEnv): string[] {
  const paths: string[] = [];
  const userProfile = windowsEnvironmentValue(env, "USERPROFILE");
  if (userProfile !== undefined && userProfile.length > 0) {
    paths.push(
      win32.join(
        userProfile,
        "Documents",
        "PowerShell",
        POWERSHELL_CONFIG_FILE_NAME,
      ),
    );
  }
  for (const directory of (windowsEnvironmentValue(env, "PATH") ?? "").split(
    ";",
  )) {
    if (/[\\/]PowerShell[\\/]\d+[^\\/]*[\\/]?$/iu.test(directory.trim())) {
      paths.push(win32.join(directory.trim(), POWERSHELL_CONFIG_FILE_NAME));
    }
  }
  return paths;
}

export async function resolvePowerShellExecutionPolicyDefault(
  options: ResolvePowerShellExecutionPolicyOptions = {},
): Promise<string | null> {
  const env = options.env ?? process.env;
  if ((options.platform ?? process.platform) !== "win32") {
    return null;
  }
  if (
    windowsEnvironmentValue(env, POWERSHELL_EXECUTION_POLICY_VARIABLE) !==
    undefined
  ) {
    return null;
  }
  const spawnUserShellEnv =
    options.spawnUserShellEnv ?? defaultSpawnUserShellEnv;
  for (const key of WINDOWS_POWERSHELL_POLICY_KEYS) {
    const result = await spawnUserShellEnv({
      command: windowsRegistryCommand(env),
      args: ["query", key, "/v", "ExecutionPolicy"],
      env,
      timeoutMs: options.timeoutMs ?? USER_SHELL_ENV_TIMEOUT_MS,
    });
    if (result.error !== undefined || result.signal !== null) {
      return null;
    }
    if (result.status === 0) {
      return null;
    }
  }
  const readTextFile = options.readTextFile ?? readOptionalTextFile;
  for (const configPath of powershellConfigPaths(env)) {
    const config = await readTextFile(configPath);
    if (config !== null && POWERSHELL_CONFIG_POLICY_PATTERN.test(config)) {
      return null;
    }
  }
  return DEFAULT_POWERSHELL_EXECUTION_POLICY;
}

export async function resolveLocalBbExecutablePath(
  options: ResolveLocalBbExecutablePathOptions = {},
): Promise<string> {
  const resolvedCliExecutablePath =
    options.cliExecutablePath ?? getDefaultCliExecutablePath();
  const cliEntryPath = await resolveCliEntryPath(resolvedCliExecutablePath);
  const cliRuntimePath =
    options.cliRuntimePath ??
    (options.cliExecutablePath === undefined
      ? getDefaultCliRuntimePath()
      : undefined);
  if (cliRuntimePath !== undefined) {
    await requireCliRuntimePath(cliRuntimePath);
  }
  return cliEntryPath;
}

export function resolveBbExecutablePathInDirectory(
  bbExecutableDirectory: string,
): string {
  return resolve(bbExecutableDirectory, "bb");
}

export function prepareRuntimeShellEnv(
  options: PrepareRuntimeShellEnvOptions,
): NonNullable<AgentRuntimeOptions["shellEnv"]> {
  const bbExecutablePath =
    options.bbExecutablePath ??
    resolveBbExecutablePathInDirectory(options.bbExecutableDirectory);
  const shellEnv: NonNullable<AgentRuntimeOptions["shellEnv"]> = {
    PATH: prependPath(
      options.bbExecutableDirectory,
      options.inheritedPath ?? process.env.PATH,
    ),
    BB_CLI: bbExecutablePath,
    BB_SERVER_URL: options.serverUrl,
  };
  assignIfDefined({
    key: "BB_HOST_DAEMON_PORT",
    target: shellEnv,
    value:
      options.hostDaemonPort === undefined
        ? undefined
        : String(options.hostDaemonPort),
  });
  if (
    options.powershellExecutionPolicy !== undefined &&
    options.powershellExecutionPolicy !== null
  ) {
    shellEnv[POWERSHELL_EXECUTION_POLICY_VARIABLE] =
      options.powershellExecutionPolicy;
  }
  return shellEnv;
}
