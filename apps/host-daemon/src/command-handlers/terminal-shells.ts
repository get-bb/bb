// bb-fork(windows): shell enumeration for the Start terminal picker.
import type { TerminalShellOption } from "@bb/domain";
import type { HostDaemonOnlineRpcResult } from "@bb/host-daemon-contract";
import type { CommandOf } from "../command-dispatch-support.js";
import { listWindowsTerminalShells } from "../terminals/terminal-windows-shell.js";

export async function listTerminalShellsForPlatform(
  platform: NodeJS.Platform,
): Promise<TerminalShellOption[]> {
  if (platform !== "win32") {
    return [];
  }
  return listWindowsTerminalShells();
}

export async function listHostTerminalShells(
  _command: CommandOf<"host.list_terminal_shells">,
): Promise<HostDaemonOnlineRpcResult<"host.list_terminal_shells">> {
  return { shells: await listTerminalShellsForPlatform(process.platform) };
}
