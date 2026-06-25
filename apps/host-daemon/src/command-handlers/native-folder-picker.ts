import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { HostDaemonOnlineRpcResult } from "@bb/host-daemon-contract";
import { sanitizeInheritedChildProcessEnv } from "@bb/process-utils";
import {
  ExpectedCommandDispatchError,
  type CommandOf,
} from "../command-dispatch-support.js";

const execFileAsync = promisify(execFile);

export async function pickHostFolder(
  command: CommandOf<"host.pick_folder">,
): Promise<HostDaemonOnlineRpcResult<"host.pick_folder">> {
  void command;
  if (process.platform !== "darwin") {
    throw new ExpectedCommandDispatchError(
      "unsupported_platform",
      "Folder picker is only supported on macOS",
    );
  }

  let stdout: string;
  try {
    const result = await execFileAsync(
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

  const selectedPath = stdout.trim();
  return { path: selectedPath === "" ? null : selectedPath.replace(/\/$/, "") };
}
