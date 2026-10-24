import { spawnHostProcess as spawn } from "@bb/process-utils";
import { constants as fsConstants } from "node:fs";
import {
  access,
  lstat,
  mkdir,
  readFile,
  readlink,
  realpath,
  rm,
  stat,
  symlink,
} from "node:fs/promises";
import { dirname, join, resolve, win32 } from "node:path";
import { CLI_LAUNCHER_MARKER } from "@bb/config/cli-command";
import type {
  SystemCliCommandShadow,
  SystemCliCommandStatus,
} from "@bb/server-contract";
import { z } from "zod";
import { ApiError } from "../../errors.js";

export const MACHINE_CLI_SHIM_MARKER =
  "No installed bb machine CLI is available.";
const CLI_LAUNCHER_MAX_BYTES = 16_384;
const CLI_COMMAND_NAME = "bb";
const WINDOWS_USER_PATH_SCRIPT = `
$ErrorActionPreference = 'Stop'
if ($env:BB_CLI_COMMAND_SET -eq '1') {
  $key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Environment')
  $kind = [Microsoft.Win32.RegistryValueKind]::ExpandString
  if ($key.GetValueNames() -contains 'Path' -and $key.GetValueKind('Path') -eq 'String') {
    $kind = [Microsoft.Win32.RegistryValueKind]::String
  }
  $key.SetValue('Path', $env:BB_CLI_COMMAND_PATH, $kind)
  Add-Type -Namespace BbCliCommand -Name Env -MemberDefinition '[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern System.IntPtr SendMessageTimeout(System.IntPtr hWnd, uint Msg, System.UIntPtr wParam, string lParam, uint fuFlags, uint uTimeout, out System.UIntPtr lpdwResult);'
  $result = [System.UIntPtr]::Zero
  [void][BbCliCommand.Env]::SendMessageTimeout([System.IntPtr]0xffff, 0x1A, [System.UIntPtr]::Zero, 'Environment', 2, 5000, [ref]$result)
} else {
  $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment')
  $value = if ($key) { $key.GetValue('Path', '', 'DoNotExpandEnvironmentNames') } else { '' }
  [Console]::Out.Write([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes([string]$value)))
}
`;
const UNSUPPORTED_STATUS: SystemCliCommandStatus = {
  installedPath: null,
  onPath: false,
  shadowedBy: null,
  supported: false,
};

export interface WindowsUserPath {
  read(): Promise<string>;
  write(value: string): Promise<void>;
}

export interface CliCommandService {
  getStatus(): Promise<SystemCliCommandStatus>;
  install(): Promise<SystemCliCommandStatus>;
  remove(): Promise<SystemCliCommandStatus>;
}

interface CreateCliCommandServiceArgs {
  env: NodeJS.ProcessEnv;
  homeDir: string;
  launcherPath: string | null;
  platform: NodeJS.Platform;
  windowsUserPath: WindowsUserPath;
}

interface CliCommandContext {
  env: NodeJS.ProcessEnv;
  homeDir: string;
  launcherPath: string;
  platform: NodeJS.Platform;
  windowsUserPath: WindowsUserPath;
}

function blocked(message: string): ApiError {
  return new ApiError(409, "cli_command_blocked", message);
}

function unixLinkDirectories(
  homeDir: string,
  platform: NodeJS.Platform,
): string[] {
  const userDirectories = [
    join(homeDir, ".local", "bin"),
    join(homeDir, "bin"),
  ];
  return platform === "darwin"
    ? ["/opt/homebrew/bin", "/usr/local/bin", ...userDirectories]
    : userDirectories;
}

function pathEntries(value: string | undefined, separator: string): string[] {
  return (value ?? "").split(separator).filter((entry) => entry.length > 0);
}

function newTerminalPathEntries(env: NodeJS.ProcessEnv): string[] {
  return pathEntries(env.PATH, ":").filter(
    (entry) => !/(?:^|\/)node_modules\/\.bin\/?$/u.test(entry),
  );
}

function sameWindowsPath(left: string, right: string): boolean {
  return (
    left.replace(/[\\/]+$/u, "").toLowerCase() ===
    right.replace(/[\\/]+$/u, "").toLowerCase()
  );
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

async function isWritableDirectory(directory: string): Promise<boolean> {
  try {
    await access(directory, fsConstants.W_OK | fsConstants.X_OK);
    return (await stat(directory)).isDirectory();
  } catch {
    return false;
  }
}

async function readSmallFile(path: string): Promise<string | null> {
  try {
    const target = await stat(path);
    if (!target.isFile() || target.size > CLI_LAUNCHER_MAX_BYTES) {
      return null;
    }
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

async function isBbLauncher(path: string): Promise<boolean> {
  return (await readSmallFile(path))?.includes(CLI_LAUNCHER_MARKER) === true;
}

async function isBbLauncherLink(link: string): Promise<boolean> {
  try {
    if (!(await lstat(link)).isSymbolicLink()) {
      return false;
    }
  } catch {
    return false;
  }
  return isBbLauncher(link);
}

async function isBbAppPackageCommand(command: string): Promise<boolean> {
  try {
    const entryPath = await realpath(command);
    const packageJsonPath = resolve(entryPath, "..", "..", "package.json");
    if (resolve(packageJsonPath, "..", "dist", "bb.js") !== entryPath) {
      return false;
    }
    const parsed = z
      .object({ name: z.string() })
      .safeParse(JSON.parse(await readFile(packageJsonPath, "utf8")));
    return parsed.success && parsed.data.name === "bb-app";
  } catch {
    return false;
  }
}

async function firstCommandOnPath(
  context: CliCommandContext,
): Promise<string | null> {
  for (const directory of newTerminalPathEntries(context.env)) {
    const candidate = join(directory, CLI_COMMAND_NAME);
    if (await pathExists(candidate)) {
      return candidate;
    }
  }
  return null;
}

async function shadowingCommand(
  context: CliCommandContext,
): Promise<SystemCliCommandShadow | null> {
  const first = await firstCommandOnPath(context);
  if (first === null || (await isBbLauncherLink(first))) {
    return null;
  }
  if (await isBbAppPackageCommand(first)) {
    return { path: first, source: "npm" };
  }
  const isMachineShim =
    (await readSmallFile(first))?.includes(MACHINE_CLI_SHIM_MARKER) === true;
  return { path: first, source: isMachineShim ? "machine" : "other" };
}

async function findInstalledLink(
  context: CliCommandContext,
): Promise<string | null> {
  for (const directory of unixLinkDirectories(
    context.homeDir,
    context.platform,
  )) {
    const link = join(directory, CLI_COMMAND_NAME);
    if (await isBbLauncherLink(link)) {
      return link;
    }
  }
  return null;
}

async function readLinkTarget(link: string): Promise<string | null> {
  try {
    return resolve(dirname(link), await readlink(link));
  } catch {
    return null;
  }
}

async function readWindowsPathEntries(
  context: CliCommandContext,
): Promise<string[]> {
  try {
    return pathEntries(await context.windowsUserPath.read(), ";");
  } catch {
    throw blocked("Could not read your PATH, so it was left unchanged.");
  }
}

async function readWindowsStatus(
  context: CliCommandContext,
): Promise<SystemCliCommandStatus> {
  const binDirectory = win32.dirname(context.launcherPath);
  const installed = await readWindowsPathEntries(context).then(
    (entries) => entries.some((entry) => sameWindowsPath(entry, binDirectory)),
    () => false,
  );
  return {
    installedPath: installed ? context.launcherPath : null,
    onPath: installed,
    shadowedBy: null,
    supported: true,
  };
}

async function readUnixStatus(
  context: CliCommandContext,
): Promise<SystemCliCommandStatus> {
  const installedPath = await findInstalledLink(context);
  const shadowedBy = await shadowingCommand(context);
  return {
    installedPath,
    onPath:
      installedPath !== null &&
      shadowedBy === null &&
      (await firstCommandOnPath(context)) !== null,
    shadowedBy,
    supported: true,
  };
}

function describeShadow(
  context: CliCommandContext,
  shadow: SystemCliCommandShadow,
): string {
  if (shadow.source === "npm") {
    return `bb is already on your PATH at ${shadow.path}, installed by npm.`;
  }
  if (shadow.source === "machine") {
    return `bb is already on your PATH at ${shadow.path}, installed with the bb machine on this computer.`;
  }
  return `Another bb at ${shadow.path} comes first on your PATH. Remove it, or run bb's command directly at ${context.launcherPath}.`;
}

async function installWindows(context: CliCommandContext): Promise<void> {
  const binDirectory = win32.dirname(context.launcherPath);
  const entries = await readWindowsPathEntries(context);
  if (entries.some((entry) => sameWindowsPath(entry, binDirectory))) {
    return;
  }
  try {
    await context.windowsUserPath.write([...entries, binDirectory].join(";"));
  } catch {
    throw blocked("Could not update your PATH.");
  }
}

async function installUnix(context: CliCommandContext): Promise<void> {
  const existing = await findInstalledLink(context);
  if (existing !== null) {
    if ((await readLinkTarget(existing)) === context.launcherPath) {
      return;
    }
    try {
      await rm(existing);
    } catch {
      throw blocked(`Could not replace ${existing}.`);
    }
  }
  const shadow = await shadowingCommand(context);
  if (shadow !== null) {
    throw blocked(describeShadow(context, shadow));
  }
  const onPath = newTerminalPathEntries(context.env);
  const candidates = unixLinkDirectories(context.homeDir, context.platform);
  for (const directory of [
    ...candidates.filter((candidate) => onPath.includes(candidate)),
    ...candidates.filter((candidate) => !onPath.includes(candidate)),
  ]) {
    const usable = (await pathExists(directory))
      ? await isWritableDirectory(directory)
      : await mkdir(directory, { recursive: true }).then(
          () => true,
          () => false,
        );
    if (!usable) {
      continue;
    }
    const linked = await symlink(
      context.launcherPath,
      join(directory, CLI_COMMAND_NAME),
    ).then(
      () => true,
      () => false,
    );
    if (linked) {
      return;
    }
  }
  throw blocked(
    `Another bb command is already installed, or no folder on your PATH is writable. Run bb's command directly at ${context.launcherPath}.`,
  );
}

async function removeWindows(context: CliCommandContext): Promise<void> {
  const binDirectory = win32.dirname(context.launcherPath);
  const entries = await readWindowsPathEntries(context);
  const kept = entries.filter((entry) => !sameWindowsPath(entry, binDirectory));
  if (kept.length === entries.length) {
    return;
  }
  try {
    await context.windowsUserPath.write(kept.join(";"));
  } catch {
    throw blocked("Could not update your PATH.");
  }
}

async function removeUnix(context: CliCommandContext): Promise<void> {
  for (const directory of unixLinkDirectories(
    context.homeDir,
    context.platform,
  )) {
    const link = join(directory, CLI_COMMAND_NAME);
    if (await isBbLauncherLink(link)) {
      try {
        await rm(link);
      } catch {
        throw blocked(`Could not remove ${link}.`);
      }
    }
  }
}

export function createCliCommandService(
  args: CreateCliCommandServiceArgs,
): CliCommandService {
  const { launcherPath } = args;
  if (launcherPath === null) {
    const unsupported = (): never => {
      throw new ApiError(
        409,
        "cli_command_unsupported",
        "The bb command needs an installed bb. Start bb with npx bb-app or the desktop app.",
      );
    };
    return {
      getStatus: () => Promise.resolve(UNSUPPORTED_STATUS),
      install: () => Promise.resolve().then(unsupported),
      remove: () => Promise.resolve().then(unsupported),
    };
  }
  const context: CliCommandContext = { ...args, launcherPath };
  const windows = args.platform === "win32";
  const getStatus = (): Promise<SystemCliCommandStatus> =>
    windows ? readWindowsStatus(context) : readUnixStatus(context);
  return {
    getStatus,
    async install() {
      if (!(await isBbLauncher(launcherPath))) {
        throw blocked(
          `The bb command launcher at ${launcherPath} is missing. Restart bb, then try again.`,
        );
      }
      await (windows ? installWindows(context) : installUnix(context));
      return getStatus();
    },
    async remove() {
      await (windows ? removeWindows(context) : removeUnix(context));
      return getStatus();
    },
  };
}

function runWindowsUserPathScript(
  env: NodeJS.ProcessEnv,
  extraEnv: Record<string, string>,
): Promise<string> {
  return new Promise((resolveRun, rejectRun) => {
    const systemRoot = env.SystemRoot ?? env.WINDIR;
    const child = spawn(
      systemRoot === undefined
        ? "powershell.exe"
        : `${systemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`,
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        WINDOWS_USER_PATH_SCRIPT,
      ],
      {
        env: { ...env, ...extraEnv },
        stdio: ["ignore", "pipe", "ignore"],
        windowsHide: true,
      },
    );
    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.once("error", rejectRun);
    child.once("close", (code) => {
      if (code === 0) {
        resolveRun(stdout);
      } else {
        rejectRun(new Error(`powershell exited with ${String(code)}`));
      }
    });
  });
}

export function createWindowsUserPath(env: NodeJS.ProcessEnv): WindowsUserPath {
  return {
    async read() {
      const encoded = await runWindowsUserPathScript(env, {});
      return Buffer.from(encoded.trim(), "base64").toString("utf8");
    },
    async write(value) {
      await runWindowsUserPathScript(env, {
        BB_CLI_COMMAND_PATH: value,
        BB_CLI_COMMAND_SET: "1",
      });
    },
  };
}
