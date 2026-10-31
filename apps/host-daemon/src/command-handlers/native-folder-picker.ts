import { homedir } from "node:os";
import {
  execHostFile,
  hostToolchain,
  sanitizeInheritedChildProcessEnv,
} from "@bb/process-utils";
import type {
  HostDaemonOnlineRpcResult,
  HostPlatform,
} from "@bb/host-daemon-contract";
import { ExpectedCommandDispatchError } from "../command-dispatch-support.js";
import { resolveHostPlatform } from "../host-platform.js";

const execFileAsync = execHostFile;

const PICKER_TITLE = "Choose a project folder";

const WINDOWS_PICKER_SCRIPT = [
  "Add-Type -AssemblyName System.Windows.Forms",
  "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
  "$owner = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true; ShowInTaskbar = $false }",
  "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
  `$dialog.Description = '${PICKER_TITLE}'`,
  "$dialog.ShowNewFolderButton = $true",
  "if ($dialog.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($dialog.SelectedPath) }",
  "$owner.Dispose()",
].join("; ");

interface FolderPickerCommand {
  command: string;
  args: string[];
  cancelExitCode: number | null;
}

interface ResolveFolderPickerArgs {
  platform?: HostPlatform;
  env?: NodeJS.ProcessEnv;
  home?: string;
  resolveCommand?: (command: string) => string | null;
}

export function resolveFolderPickerCommand({
  platform = resolveHostPlatform(),
  env = process.env,
  home = homedir(),
  resolveCommand = (command) => hostToolchain.resolve(command),
}: ResolveFolderPickerArgs = {}): FolderPickerCommand | null {
  switch (platform) {
    case "darwin":
      return {
        command: "osascript",
        args: [
          "-e",
          `try\nPOSIX path of (choose folder with prompt "${PICKER_TITLE}")\non error number -128\nreturn ""\nend try`,
        ],
        cancelExitCode: null,
      };
    case "win32":
      return {
        command: "powershell.exe",
        args: [
          "-NoProfile",
          "-NonInteractive",
          "-STA",
          "-Command",
          WINDOWS_PICKER_SCRIPT,
        ],
        cancelExitCode: null,
      };
    case "linux": {
      if (!env.DISPLAY && !env.WAYLAND_DISPLAY) return null;
      const zenity = resolveCommand("zenity");
      if (zenity !== null) {
        return {
          command: zenity,
          args: ["--file-selection", "--directory", `--title=${PICKER_TITLE}`],
          cancelExitCode: 1,
        };
      }
      const kdialog = resolveCommand("kdialog");
      if (kdialog !== null) {
        return {
          command: kdialog,
          args: ["--getexistingdirectory", home, "--title", PICKER_TITLE],
          cancelExitCode: 1,
        };
      }
      return null;
    }
    case "wsl":
    case "unknown":
      return null;
  }
}

function exitCode(error: unknown): unknown {
  return typeof error === "object" && error !== null && "code" in error
    ? error.code
    : undefined;
}

function trimTrailingSeparator(path: string): string {
  if (/^[A-Za-z]:\\$/u.test(path) || path === "/") return path;
  return path.replace(/[\\/]$/u, "");
}

export async function pickHostFolder(): Promise<
  HostDaemonOnlineRpcResult<"host.pick_folder">
> {
  const picker = resolveFolderPickerCommand();
  if (picker === null) {
    throw new ExpectedCommandDispatchError(
      "unsupported_platform",
      "No native folder picker is available on this machine",
    );
  }

  let stdout: string;
  try {
    const result = await execFileAsync(picker.command, picker.args, {
      env: sanitizeInheritedChildProcessEnv({ env: process.env }),
      windowsHide: true,
    });
    stdout = result.stdout;
  } catch (error) {
    if (
      picker.cancelExitCode !== null &&
      exitCode(error) === picker.cancelExitCode
    ) {
      return { path: null };
    }
    throw new ExpectedCommandDispatchError(
      "folder_picker_failed",
      `Folder picker failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const selectedPath = stdout.trim();
  return {
    path: selectedPath === "" ? null : trimTrailingSeparator(selectedPath),
  };
}
