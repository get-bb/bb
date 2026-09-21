// bb-fork(windows): start payload for the shell picked beside Start terminal.
import type { CreateTerminalRequest } from "@bb/server-contract";

export function terminalShellStart(shellIdForLaunch: string | null): {
  start?: CreateTerminalRequest["start"];
} {
  return shellIdForLaunch === null
    ? {}
    : { start: { mode: "shell", shellId: shellIdForLaunch } };
}
