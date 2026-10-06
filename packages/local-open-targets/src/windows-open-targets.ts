import path from "node:path";
import type { ExecFileInvocation, ExistingPath } from "./types.js";

export type WindowsTerminalProgram = "windows-terminal" | "powershell";

interface BuildWindowsOpenInvocationArgs {
  env: NodeJS.ProcessEnv | undefined;
  existingPath: ExistingPath;
}

interface BuildWindowsTerminalOpenInvocationArgs extends BuildWindowsOpenInvocationArgs {
  terminal: WindowsTerminalProgram;
}

const OPEN_PATH_VARIABLE = "WORKSPACE_OPEN_TARGET_PATH";
const OPEN_PATH = `$env:${OPEN_PATH_VARIABLE}`;

function environmentValue(
  env: NodeJS.ProcessEnv | undefined,
  name: string,
): string | undefined {
  if (env === undefined) {
    return undefined;
  }
  const key = Object.keys(env).find(
    (candidate) => candidate.toUpperCase() === name.toUpperCase(),
  );
  return key === undefined ? undefined : env[key];
}

export function resolveWindowsPowerShellPath(
  env: NodeJS.ProcessEnv | undefined,
): string {
  const systemRoot = environmentValue(env, "SystemRoot");
  return systemRoot === undefined || systemRoot.length === 0
    ? "powershell.exe"
    : path.win32.join(
        systemRoot,
        "System32",
        "WindowsPowerShell",
        "v1.0",
        "powershell.exe",
      );
}

function buildPowerShellInvocation(
  args: BuildWindowsOpenInvocationArgs,
  openPath: string,
  script: string,
): ExecFileInvocation {
  return {
    file: resolveWindowsPowerShellPath(args.env),
    args: ["-NoProfile", "-NonInteractive", "-Command", script],
    env: { ...args.env, [OPEN_PATH_VARIABLE]: openPath },
  };
}

export function buildWindowsDefaultOpenInvocation(
  args: BuildWindowsOpenInvocationArgs,
): ExecFileInvocation {
  return buildPowerShellInvocation(
    args,
    args.existingPath.path,
    `Invoke-Item -LiteralPath ${OPEN_PATH}`,
  );
}

export function buildWindowsFileManagerOpenInvocation(
  args: BuildWindowsOpenInvocationArgs,
): ExecFileInvocation {
  return buildPowerShellInvocation(
    args,
    args.existingPath.path,
    args.existingPath.type === "file"
      ? `Start-Process -FilePath explorer.exe -ArgumentList ('/select,"' + ${OPEN_PATH} + '"')`
      : `Invoke-Item -LiteralPath ${OPEN_PATH}`,
  );
}

export function buildWindowsTerminalOpenInvocation(
  args: BuildWindowsTerminalOpenInvocationArgs,
): ExecFileInvocation {
  const directory =
    args.existingPath.type === "file"
      ? path.win32.dirname(args.existingPath.path)
      : args.existingPath.path;
  return buildPowerShellInvocation(
    args,
    directory,
    args.terminal === "windows-terminal"
      ? `Start-Process -FilePath wt.exe -ArgumentList '-d','.' -WorkingDirectory ${OPEN_PATH}`
      : `Start-Process -FilePath powershell.exe -ArgumentList '-NoExit','-NoLogo' -WorkingDirectory ${OPEN_PATH}`,
  );
}
