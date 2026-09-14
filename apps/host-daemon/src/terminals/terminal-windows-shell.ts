import { access } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import type { HostDaemonServerTerminalMessage } from "../server-connection-support.js";

type TerminalOpenStart = Extract<
  HostDaemonServerTerminalMessage,
  { type: "terminal.open" }
>["start"];

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

const WINDOWS_SHELL_NAMES = ["pwsh.exe", "powershell.exe"] as const;

async function firstExecutableOnPath(
  shellName: (typeof WINDOWS_SHELL_NAMES)[number],
  pathDirectories: readonly string[],
): Promise<string | null> {
  for (const directory of pathDirectories) {
    const candidate = path.join(directory, shellName);
    if (await pathIsExecutable(candidate)) {
      return candidate;
    }
  }
  return null;
}

export async function resolveWindowsTerminalShell(): Promise<string> {
  const pathValue = process.env.PATH ?? process.env.Path ?? "";
  const pathDirectories = pathValue
    .split(";")
    .map((entry) => entry.trim())
    .filter(isNonEmptyString);

  const pwshOnPath = await firstExecutableOnPath("pwsh.exe", pathDirectories);
  if (pwshOnPath !== null) {
    return pwshOnPath;
  }

  const programFiles = process.env.ProgramFiles ?? "C:\\Program Files";
  const localAppData = process.env.LOCALAPPDATA;
  const pwshFallbacks = [
    path.join(programFiles, "PowerShell", "7", "pwsh.exe"),
    ...(localAppData === undefined
      ? []
      : [path.join(localAppData, "Microsoft", "WindowsApps", "pwsh.exe")]),
  ];
  for (const candidate of pwshFallbacks) {
    if (await pathIsExecutable(candidate)) {
      return candidate;
    }
  }

  const powershellOnPath = await firstExecutableOnPath(
    "powershell.exe",
    pathDirectories,
  );
  if (powershellOnPath !== null) {
    return powershellOnPath;
  }

  const systemRoot = process.env.SystemRoot ?? "C:\\Windows";
  const windowsPowerShell = path.join(
    systemRoot,
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
  if (await pathIsExecutable(windowsPowerShell)) {
    return windowsPowerShell;
  }

  throw new Error(
    "No PowerShell was found on this machine. Install PowerShell 7 (pwsh) or use the built-in Windows PowerShell.",
  );
}

export type TerminalShellFamily = "posix" | "powershell";

export function terminalShellFamily(shell: string): TerminalShellFamily {
  const name = shell.split(/[\\/]/).at(-1)?.toLowerCase() ?? "";
  return name === "pwsh.exe" || name === "powershell.exe" || name === "pwsh"
    ? "powershell"
    : "posix";
}

export function windowsTerminalSpawnArgs(
  start: TerminalOpenStart,
  shell: string,
): string[] | null {
  if (terminalShellFamily(shell) === "posix") {
    return null;
  }
  switch (start.mode) {
    case "shell":
      return ["-NoLogo"];
    case "command":
      return ["-NoLogo", "-Command", start.command];
  }
}
