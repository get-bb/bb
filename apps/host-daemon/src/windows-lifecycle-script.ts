import fs from "node:fs/promises";
import path from "node:path";
import {
  DEFAULT_ENV_SETUP_SCRIPT_NAME,
  DEFAULT_ENV_TEARDOWN_SCRIPT_NAME,
  WINDOWS_ENV_SETUP_SCRIPT_NAME,
  WINDOWS_ENV_TEARDOWN_SCRIPT_NAME,
} from "@bb/domain";
import {
  emitOutput,
  type ProgressCallback,
} from "bb-environment-provider-host/transcript";

export interface LifecycleScriptNames {
  scriptName: string;
  alternateScriptName?: string;
}

export function resolveLifecycleScriptNames(
  kind: "setup" | "teardown",
  platform: NodeJS.Platform,
): LifecycleScriptNames {
  if (platform !== "win32") {
    return {
      scriptName:
        kind === "setup"
          ? DEFAULT_ENV_SETUP_SCRIPT_NAME
          : DEFAULT_ENV_TEARDOWN_SCRIPT_NAME,
    };
  }
  return {
    scriptName:
      kind === "setup"
        ? WINDOWS_ENV_SETUP_SCRIPT_NAME
        : WINDOWS_ENV_TEARDOWN_SCRIPT_NAME,
    alternateScriptName:
      kind === "setup"
        ? DEFAULT_ENV_SETUP_SCRIPT_NAME
        : DEFAULT_ENV_TEARDOWN_SCRIPT_NAME,
  };
}

export interface WindowsLifecycleScriptCommand {
  command: string;
  args: string[];
  text: string;
}

export function buildWindowsLifecycleScriptCommand(args: {
  kind: "setup" | "teardown";
  scriptName: string;
  scriptPath: string;
}): WindowsLifecycleScriptCommand {
  return {
    command: "powershell.exe",
    args: [
      "-NoLogo",
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      args.scriptPath,
    ],
    text: `powershell.exe -NoProfile -ExecutionPolicy Bypass -File ${args.scriptName}`,
  };
}

export async function emitIgnoredAlternateLifecycleScript(args: {
  workspacePath: string;
  kind: "setup" | "teardown";
  scriptName: string;
  alternateScriptName?: string;
  onProgress?: ProgressCallback;
}): Promise<void> {
  if (args.alternateScriptName === undefined) {
    return;
  }
  const alternatePath = path.join(args.workspacePath, args.alternateScriptName);
  try {
    await fs.access(alternatePath);
  } catch {
    return;
  }
  emitOutput(
    args.onProgress,
    `${args.kind}-script-ignored`,
    `${args.alternateScriptName} is ignored on Windows; use ${args.scriptName} instead`,
  );
}
