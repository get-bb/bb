import { spawn } from "node:child_process";
import { constants as fsConstants, existsSync } from "node:fs";
import fs from "node:fs/promises";
import { basename, delimiter, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentRuntimeOptions } from "@bb/agent-runtime";
import { assignIfDefined } from "@bb/config/objects";

interface ResolveLocalBbExecutablePathOptions {
  cliExecutablePath?: string;
  cliRuntimePath?: string;
  platform?: NodeJS.Platform;
}

interface PrepareRuntimeShellEnvOptions {
  bbExecutableDirectory: string;
  bbExecutablePath?: string;
  hostDaemonPort?: number;
  serverUrl: string;
  inheritedPath?: string;
}

export interface ResolveUserShellPathOptions {
  env?: NodeJS.ProcessEnv;
  fileExists?: (filePath: string) => boolean;
  platform?: NodeJS.Platform;
  spawnUserShellEnv?: SpawnUserShellEnv;
  timeoutMs?: number;
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

const SHELL_ENV_START_MARKER = "__BB_SHELL_ENV_START__";
const SHELL_ENV_END_MARKER = "__BB_SHELL_ENV_END__";
const SHELL_ENV_COMMAND = [
  `printf '%s\\n' ${SHELL_ENV_START_MARKER}`,
  "env",
  `printf '%s\\n' ${SHELL_ENV_END_MARKER}`,
].join("; ");
const POWERSHELL_SHELL_ENV_COMMAND = [
  `Write-Output '${SHELL_ENV_START_MARKER}'`,
  "Get-ChildItem Env: | ForEach-Object { Write-Output ($_.Name + '=' + [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($_.Value))) }",
  `Write-Output '${SHELL_ENV_END_MARKER}'`,
].join("; ");
const BASE64_VALUE_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/u;
const USER_SHELL_ENV_TIMEOUT_MS = 3_000;
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

async function resolveCliEntryPath(
  cliExecutablePath: string,
  platform: NodeJS.Platform,
): Promise<string> {
  const cliEntryPath = resolve(cliExecutablePath);

  try {
    const stats = await fs.stat(cliEntryPath);
    if (!stats.isFile()) {
      throw new Error(`Resolved bb CLI entry is not a file: ${cliEntryPath}`);
    }
    if (platform !== "win32") {
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

function readWindowsEnvValue(
  env: NodeJS.ProcessEnv,
  name: string,
): string | undefined {
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined && key.toLowerCase() === target) {
      return value;
    }
  }
  return undefined;
}

function normalizeWindowsDir(directory: string): string {
  const stripped = directory.replace(/\\+$/u, "");
  return stripped.length > 0 ? stripped : "C:\\Windows";
}

export function isWindowsShLikeShell(shell: string): boolean {
  const baseName = shell.toLowerCase().replace(/\\/g, "/").split("/").pop() ?? "";
  const stem = baseName.endsWith(".exe")
    ? baseName.slice(0, -".exe".length)
    : baseName;
  return (
    stem === "sh" ||
    stem === "bash" ||
    stem === "dash" ||
    stem === "zsh" ||
    stem === "fish"
  );
}

function resolveWindowsShellCommand(
  env: NodeJS.ProcessEnv,
  fileExists: (filePath: string) => boolean,
): string {
  const pathValue = readWindowsEnvValue(env, "Path") ?? "";
  for (const directory of pathValue.split(";")) {
    const trimmed = directory.trim();
    if (trimmed.length === 0) {
      continue;
    }
    const candidate = `${normalizeWindowsDir(trimmed)}\\pwsh.exe`;
    if (fileExists(candidate)) {
      return candidate;
    }
  }
  const programFiles = readWindowsEnvValue(env, "ProgramFiles");
  if (programFiles !== undefined && programFiles.length > 0) {
    const candidate = `${normalizeWindowsDir(programFiles)}\\PowerShell\\7\\pwsh.exe`;
    if (fileExists(candidate)) {
      return candidate;
    }
  }
  const systemRoot = normalizeWindowsDir(
    readWindowsEnvValue(env, "SystemRoot") ?? "C:\\Windows",
  );
  const systemPowerShell = `${systemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
  if (fileExists(systemPowerShell)) {
    return systemPowerShell;
  }
  return "powershell.exe";
}

function resolveUserShellCommand(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  fileExists: (filePath: string) => boolean,
): string | null {
  const configuredShell = env.SHELL?.trim();
  if (platform === "win32") {
    if (
      configuredShell &&
      configuredShell.length > 0 &&
      isWindowsShLikeShell(configuredShell)
    ) {
      return configuredShell;
    }
    return resolveWindowsShellCommand(env, fileExists);
  }
  if (configuredShell && configuredShell.length > 0) {
    return configuredShell;
  }
  return platform === "darwin" ? "/bin/zsh" : "/bin/sh";
}

function userShellEnvArgSets(
  shell: string,
  platform: NodeJS.Platform,
): string[][] {
  if (platform === "win32" && !isWindowsShLikeShell(shell)) {
    return [["-NoLogo", "-Command", POWERSHELL_SHELL_ENV_COMMAND]];
  }
  const shellName = basename(shell);
  if (shellName === "sh" || shellName === "dash") {
    return [["-lc", SHELL_ENV_COMMAND]];
  }
  return [
    ["-ilc", SHELL_ENV_COMMAND],
    ["-lc", SHELL_ENV_COMMAND],
  ];
}

function findLastMarkerIndex(lines: string[], marker: string): number {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (lines[index]?.trim() === marker) {
      return index;
    }
  }
  return -1;
}

function parseWindowsPathFromUserShellEnv(stdout: string): string | null {
  const lines = stdout.split(/\r?\n/u);
  const startIndex = findLastMarkerIndex(lines, SHELL_ENV_START_MARKER);
  if (startIndex === -1) {
    return null;
  }
  const endIndex = lines.findIndex(
    (line, index) => index > startIndex && line.trim() === SHELL_ENV_END_MARKER,
  );
  if (endIndex === -1) {
    return null;
  }

  for (const line of lines.slice(startIndex + 1, endIndex)) {
    const separator = line.indexOf("=");
    if (separator === -1) {
      continue;
    }
    if (line.slice(0, separator).toLowerCase() !== "path") {
      continue;
    }
    const encoded = line.slice(separator + 1).trim();
    if (!BASE64_VALUE_PATTERN.test(encoded)) {
      continue;
    }
    const pathValue = Buffer.from(encoded, "base64").toString("utf8").trim();
    return pathValue.length > 0 ? pathValue : null;
  }
  return null;
}

function parsePathForUserShell(
  stdout: string,
  shell: string,
  platform: NodeJS.Platform,
): string | null {
  if (platform === "win32" && !isWindowsShLikeShell(shell)) {
    return parseWindowsPathFromUserShellEnv(stdout);
  }
  return parsePathFromUserShellEnv(stdout);
}

function parsePathFromUserShellEnv(stdout: string): string | null {
  const lines = stdout.split(/\r?\n/u);
  const startIndex = lines.findIndex(
    (line) => line.trim() === SHELL_ENV_START_MARKER,
  );
  if (startIndex === -1) {
    return null;
  }
  const endIndex = lines.findIndex(
    (line, index) => index > startIndex && line.trim() === SHELL_ENV_END_MARKER,
  );
  if (endIndex === -1) {
    return null;
  }

  for (const line of lines.slice(startIndex + 1, endIndex)) {
    if (!line.startsWith("PATH=")) {
      continue;
    }
    const pathValue = line.slice("PATH=".length).trim();
    return pathValue.length > 0 ? pathValue : null;
  }
  return null;
}

export async function resolveUserShellPath(
  options: ResolveUserShellPathOptions = {},
): Promise<string | null> {
  return resolveUserShellPathWithPrevious(options, null);
}

async function resolveUserShellPathWithPrevious(
  options: ResolveUserShellPathOptions,
  previousPath: string | null,
): Promise<string | null> {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const fileExists = options.fileExists ?? existsSync;
  const shell = resolveUserShellCommand(env, platform, fileExists);
  if (!shell) {
    return null;
  }

  const spawnUserShellEnv =
    options.spawnUserShellEnv ?? defaultSpawnUserShellEnv;
  const shellArgSets = userShellEnvArgSets(shell, platform);
  for (const [index, shellArgs] of shellArgSets.entries()) {
    const result = await spawnUserShellEnv({
      command: shell,
      args: shellArgs,
      env,
      timeoutMs: options.timeoutMs ?? USER_SHELL_ENV_TIMEOUT_MS,
    });
    if (
      result.error !== undefined ||
      result.signal !== null ||
      result.status !== 0
    ) {
      if (index === 0 && previousPath !== null) {
        return previousPath;
      }
      continue;
    }
    const path = parsePathForUserShell(result.stdout, shell, platform);
    if (path !== null) {
      return path;
    }
    if (index === 0 && previousPath !== null) {
      return previousPath;
    }
  }

  return null;
}

export function createUserShellPathResolver(
  options: ResolveUserShellPathOptions = {},
): () => Promise<string | null> {
  let previousPath: string | null = null;
  return async () => {
    const path = await resolveUserShellPathWithPrevious(options, previousPath);
    if (path !== null) previousPath = path;
    return path;
  };
}

export async function resolveLocalBbExecutablePath(
  options: ResolveLocalBbExecutablePathOptions = {},
): Promise<string> {
  const platform = options.platform ?? process.platform;
  const resolvedCliExecutablePath =
    options.cliExecutablePath ?? getDefaultCliExecutablePath();
  const cliEntryPath = await resolveCliEntryPath(
    resolvedCliExecutablePath,
    platform,
  );
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

function bbExecutableFileName(): string {
  return "bb";
}

export function resolveBbExecutablePathInDirectory(
  bbExecutableDirectory: string,
): string {
  return resolve(bbExecutableDirectory, bbExecutableFileName());
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
  return shellEnv;
}
