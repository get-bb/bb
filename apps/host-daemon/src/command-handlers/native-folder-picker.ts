import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { HostDaemonOnlineRpcResult } from "@bb/host-daemon-contract";
import { sanitizeInheritedChildProcessEnv } from "@bb/process-utils";
import { ExpectedCommandDispatchError } from "../command-dispatch-support.js";

const execFileAsync = promisify(execFile);

export interface NativeFolderPickerDialog {
  showOpenDialog(options: {
    properties: Array<"openDirectory">;
    title?: string;
  }): Promise<{ canceled: boolean; filePaths: string[] }>;
}

export type NativeFolderPickerExecFile = (
  file: string,
  args: string[],
  options?: { env?: NodeJS.ProcessEnv },
) => Promise<{ stdout: string }>;

export interface NativeFolderPickerDeps {
  dialog?: NativeFolderPickerDialog | undefined;
  execFile?: NativeFolderPickerExecFile | undefined;
  platform?: NodeJS.Platform | undefined;
}

type PickFolderResult = HostDaemonOnlineRpcResult<"host.pick_folder">;

const WINDOWS_FOLDER_PICKER_TITLE = "Choose a project folder";
const WINDOWS_POWERSHELL_FOLDER_PICKER_SCRIPT = [
  "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
  "Add-Type -AssemblyName System.Windows.Forms",
  "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
  `$dialog.Description = '${WINDOWS_FOLDER_PICKER_TITLE}'`,
  "$dialog.ShowNewFolderButton = $true",
  "if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { $dialog.SelectedPath }",
].join("; ");

let dialogProvider: NativeFolderPickerDialog | undefined;

export function setNativeFolderPickerDialogProvider(
  provider: NativeFolderPickerDialog | undefined,
): void {
  dialogProvider = provider;
}

async function defaultExecFile(
  file: string,
  args: string[],
  options?: { env?: NodeJS.ProcessEnv },
): Promise<{ stdout: string }> {
  const result = await execFileAsync(file, args, {
    env: sanitizeInheritedChildProcessEnv({ env: options?.env ?? process.env }),
  });
  return { stdout: result.stdout };
}

function toPickFolderResult(selectedPath: string): PickFolderResult {
  const trimmedPath = selectedPath.trim();
  return {
    path:
      trimmedPath === "" ? null : trimmedPath.replace(/[/\\]$/, ""),
  };
}

async function pickMacOsFolder(
  execFileImpl: NativeFolderPickerExecFile,
): Promise<PickFolderResult> {
  let stdout: string;
  try {
    const result = await execFileImpl(
      "osascript",
      [
        "-e",
        'try\nPOSIX path of (choose folder with prompt "Choose a project folder")\non error number -128\nreturn ""\nend try',
      ],
      {
        env: sanitizeInheritedChildProcessEnv({ env: process.env }),
      },
    );
    stdout = result.stdout;
  } catch (error) {
    throw new ExpectedCommandDispatchError(
      "folder_picker_failed",
      `Folder picker failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return toPickFolderResult(stdout);
}

async function pickWindowsFolderWithDialog(
  dialog: NativeFolderPickerDialog,
): Promise<PickFolderResult> {
  let result: { canceled: boolean; filePaths: string[] };
  try {
    result = await dialog.showOpenDialog({
      properties: ["openDirectory"],
      title: WINDOWS_FOLDER_PICKER_TITLE,
    });
  } catch (error) {
    throw new ExpectedCommandDispatchError(
      "folder_picker_failed",
      `Folder picker failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (result.canceled || result.filePaths.length === 0) {
    return { path: null };
  }
  return { path: result.filePaths[0] ?? null };
}

async function pickWindowsFolderWithPowerShell(
  execFileImpl: NativeFolderPickerExecFile,
): Promise<PickFolderResult> {
  let stdout: string;
  try {
    const result = await execFileImpl(
      "powershell.exe",
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        WINDOWS_POWERSHELL_FOLDER_PICKER_SCRIPT,
      ],
      {
        env: sanitizeInheritedChildProcessEnv({ env: process.env }),
      },
    );
    stdout = result.stdout;
  } catch (error) {
    throw new ExpectedCommandDispatchError(
      "folder_picker_failed",
      `Folder picker failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return toPickFolderResult(stdout);
}

export async function pickHostFolderWithDeps(
  deps: NativeFolderPickerDeps = {},
): Promise<PickFolderResult> {
  const platform = deps.platform ?? process.platform;
  if (platform === "darwin") {
    return pickMacOsFolder(deps.execFile ?? defaultExecFile);
  }
  if (platform === "win32") {
    const dialog = deps.dialog ?? dialogProvider;
    if (dialog !== undefined) {
      return pickWindowsFolderWithDialog(dialog);
    }
    return pickWindowsFolderWithPowerShell(deps.execFile ?? defaultExecFile);
  }
  throw new ExpectedCommandDispatchError(
    "unsupported_platform",
    "Folder picker is only supported on macOS and Windows",
  );
}

export async function pickHostFolder(): Promise<PickFolderResult> {
  return pickHostFolderWithDeps();
}
