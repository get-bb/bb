import { access } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import {
  AUTOMATIC_TERMINAL_SHELL_ID,
  type TerminalShellOption,
} from "@bb/domain";
import type { HostDaemonServerTerminalMessage } from "../server-connection-support.js";

type TerminalOpenStart = Extract<
  HostDaemonServerTerminalMessage,
  { type: "terminal.open" }
>["start"];

const WINDOWS_TERMINAL_SHELL_IDS = {
  gitBash: "git-bash",
  powershell: "powershell",
  pwsh: "pwsh",
} as const;

const WINDOWS_TERMINAL_SHELL_LABELS = {
  [WINDOWS_TERMINAL_SHELL_IDS.gitBash]: "Git Bash",
  [WINDOWS_TERMINAL_SHELL_IDS.powershell]: "Windows PowerShell",
  [WINDOWS_TERMINAL_SHELL_IDS.pwsh]: "PowerShell 7",
} as const;

const POWERSHELL_SHELL_NAMES = ["pwsh.exe", "powershell.exe"] as const;

const GIT_BASH_RELATIVE_PATHS = [
  ["bin", "bash.exe"],
  ["usr", "bin", "bash.exe"],
] as const;

const GIT_FOR_WINDOWS_DIRECTORY_UP_LEVELS = [
  "..",
  path.join("..", ".."),
  path.join("..", "..", ".."),
] as const;

const NO_SHELL_FOUND_MESSAGE =
  "No shell was found on this machine. Install PowerShell 7 (pwsh), Windows PowerShell, or Git for Windows.";

async function pathIsExecutable(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function isNonEmptyString(value: string | undefined): value is string {
  return value !== undefined && value.length > 0;
}

function windowsPathDirectories(): string[] {
  const pathValue = process.env.PATH ?? process.env.Path ?? "";
  return pathValue
    .split(";")
    .map((entry) => entry.trim())
    .filter(isNonEmptyString);
}

async function firstExecutable(
  candidates: readonly string[],
): Promise<string | null> {
  for (const candidate of candidates) {
    if (await pathIsExecutable(candidate)) {
      return candidate;
    }
  }
  return null;
}

async function firstExecutableOnPath(
  shellName: (typeof POWERSHELL_SHELL_NAMES)[number],
  pathDirectories: readonly string[],
): Promise<string | null> {
  return firstExecutable(
    pathDirectories.map((directory) => path.join(directory, shellName)),
  );
}

async function resolvePwshPath(
  pathDirectories: readonly string[],
): Promise<string | null> {
  const pwshOnPath = await firstExecutableOnPath("pwsh.exe", pathDirectories);
  if (pwshOnPath !== null) {
    return pwshOnPath;
  }

  const programFiles = process.env.ProgramFiles ?? "C:\\Program Files";
  const localAppData = process.env.LOCALAPPDATA;
  return firstExecutable([
    path.join(programFiles, "PowerShell", "7", "pwsh.exe"),
    ...(localAppData === undefined
      ? []
      : [path.join(localAppData, "Microsoft", "WindowsApps", "pwsh.exe")]),
  ]);
}

async function resolveWindowsPowershellPath(
  pathDirectories: readonly string[],
): Promise<string | null> {
  const powershellOnPath = await firstExecutableOnPath(
    "powershell.exe",
    pathDirectories,
  );
  if (powershellOnPath !== null) {
    return powershellOnPath;
  }

  const systemRoot = process.env.SystemRoot ?? "C:\\Windows";
  return firstExecutable([
    path.join(
      systemRoot,
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    ),
  ]);
}

function standardGitForWindowsBashCandidates(): string[] {
  const programFiles = process.env.ProgramFiles ?? "C:\\Program Files";
  const programFilesX86 = process.env["ProgramFiles(x86)"];
  const localAppData = process.env.LOCALAPPDATA;
  const installRoots = [
    path.join(programFiles, "Git"),
    ...(isNonEmptyString(programFilesX86)
      ? [path.join(programFilesX86, "Git")]
      : []),
    ...(isNonEmptyString(localAppData)
      ? [path.join(localAppData, "Programs", "Git")]
      : []),
  ];
  return installRoots.flatMap((root) =>
    GIT_BASH_RELATIVE_PATHS.map((relativePath) =>
      path.join(root, ...relativePath),
    ),
  );
}

async function resolveGitBashPath(
  pathDirectories: readonly string[],
): Promise<string | null> {
  for (const directory of pathDirectories) {
    if (!(await pathIsExecutable(path.join(directory, "git.exe")))) {
      continue;
    }
    // git.exe ships in <root>\cmd, <root>\bin, or <root>\mingw64\bin.
    for (const upLevel of GIT_FOR_WINDOWS_DIRECTORY_UP_LEVELS) {
      const bashPath = await firstExecutable(
        GIT_BASH_RELATIVE_PATHS.map((relativePath) =>
          path.join(directory, upLevel, ...relativePath),
        ),
      );
      if (bashPath !== null) {
        return bashPath;
      }
    }
  }
  return firstExecutable(standardGitForWindowsBashCandidates());
}

interface WindowsTerminalShellCandidate {
  id: string;
  label: string;
  resolve: (pathDirectories: readonly string[]) => Promise<string | null>;
}

const WINDOWS_TERMINAL_SHELL_CANDIDATES: readonly WindowsTerminalShellCandidate[] =
  [
    {
      id: WINDOWS_TERMINAL_SHELL_IDS.pwsh,
      label: WINDOWS_TERMINAL_SHELL_LABELS[WINDOWS_TERMINAL_SHELL_IDS.pwsh],
      resolve: resolvePwshPath,
    },
    {
      id: WINDOWS_TERMINAL_SHELL_IDS.powershell,
      label:
        WINDOWS_TERMINAL_SHELL_LABELS[WINDOWS_TERMINAL_SHELL_IDS.powershell],
      resolve: resolveWindowsPowershellPath,
    },
    {
      id: WINDOWS_TERMINAL_SHELL_IDS.gitBash,
      label: WINDOWS_TERMINAL_SHELL_LABELS[WINDOWS_TERMINAL_SHELL_IDS.gitBash],
      resolve: resolveGitBashPath,
    },
  ];

interface DetectedWindowsTerminalShell {
  id: string;
  label: string;
  path: string;
}

async function detectWindowsTerminalShells(): Promise<
  DetectedWindowsTerminalShell[]
> {
  const pathDirectories = windowsPathDirectories();
  const detected = await Promise.all(
    WINDOWS_TERMINAL_SHELL_CANDIDATES.map(async (candidate) => ({
      id: candidate.id,
      label: candidate.label,
      path: await candidate.resolve(pathDirectories),
    })),
  );
  return detected.flatMap((shell) =>
    shell.path === null
      ? []
      : [{ id: shell.id, label: shell.label, path: shell.path }],
  );
}

export async function listWindowsTerminalShells(): Promise<
  TerminalShellOption[]
> {
  const shells = await detectWindowsTerminalShells();
  return shells.map((shell, index) => ({
    id: shell.id,
    isDefault: index === 0,
    label: shell.label,
    path: shell.path,
  }));
}

export async function resolveWindowsTerminalShell(
  shellId?: string,
): Promise<string> {
  const shells = await listWindowsTerminalShells();
  if (shells.length === 0) {
    throw new Error(NO_SHELL_FOUND_MESSAGE);
  }

  if (shellId !== undefined && shellId !== AUTOMATIC_TERMINAL_SHELL_ID) {
    const requested = shells.find((shell) => shell.id === shellId);
    if (requested !== undefined) {
      return requested.path;
    }
  }

  const defaultShell = shells.find((shell) => shell.isDefault) ?? shells[0];
  if (defaultShell === undefined) {
    throw new Error(NO_SHELL_FOUND_MESSAGE);
  }
  return defaultShell.path;
}

export type TerminalShellFamily = "posix" | "powershell";

export function terminalShellFamily(shell: string): TerminalShellFamily {
  const name = shell.split(/[\\/]/).at(-1)?.toLowerCase() ?? "";
  return name === "pwsh.exe" || name === "powershell.exe" || name === "pwsh"
    ? "powershell"
    : "posix";
}

function isWindowsBashShell(shell: string): boolean {
  return (shell.split(/[\\/]/).at(-1)?.toLowerCase() ?? "") === "bash.exe";
}

export function windowsTerminalSpawnArgs(
  start: TerminalOpenStart,
  shell: string,
): string[] | null {
  if (terminalShellFamily(shell) === "posix") {
    // bb-fork(windows): Git Bash starts like its own launcher; command mode
    // keeps the generic posix "-lc" arguments.
    if (start.mode !== "shell" || !isWindowsBashShell(shell)) {
      return null;
    }
    return ["--login", "-i"];
  }
  switch (start.mode) {
    case "shell":
      return ["-NoLogo"];
    case "command":
      return ["-NoLogo", "-Command", start.command];
  }
}
