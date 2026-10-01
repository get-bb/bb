import type { ChildProcess } from "node:child_process";
import { stopWindowsProcessTree } from "./windows-process-tree.js";

interface KillProcessGroupArgs {
  child: {
    pid?: number | undefined;
    kill: (signal: NodeJS.Signals) => unknown;
  };
  signal: NodeJS.Signals;
}

interface StopProcessGroupLeaderFirstArgs {
  child: ChildProcess;
  timeoutMs: number;
  killGraceMs: number;
}

export function supportsProcessGroups(): boolean {
  return process.platform !== "win32";
}

export function killProcessGroup(args: KillProcessGroupArgs): void {
  if (supportsProcessGroups() && args.child.pid !== undefined) {
    try {
      process.kill(-args.child.pid, args.signal);
      return;
    } catch {}
  }
  args.child.kill(args.signal);
}

export function isProcessGroupAlive(child: {
  pid?: number | undefined;
}): boolean {
  if (!supportsProcessGroups() || child.pid === undefined) {
    return false;
  }
  try {
    process.kill(-child.pid, 0);
    return true;
  } catch {
    return false;
  }
}

function hasChildExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

const PROCESS_GROUP_EXIT_POLL_MS = 100;

export function stopProcessGroupLeaderFirst(
  args: StopProcessGroupLeaderFirstArgs,
): Promise<void> {
  const { child, timeoutMs, killGraceMs } = args;
  if (process.platform === "win32") return stopWindowsProcessTree(child);
  if (hasChildExited(child) && !isProcessGroupAlive(child)) {
    return Promise.resolve();
  }
  return new Promise<void>((resolveStop) => {
    let settled = false;
    let hardTimer: NodeJS.Timeout | undefined;
    let poll: NodeJS.Timeout | undefined;
    const finish = (): void => {
      if (settled) {
        return;
      }
      settled = true;
      child.off("exit", stopSurvivingMembers);
      clearTimeout(softTimer);
      if (hardTimer !== undefined) {
        clearTimeout(hardTimer);
      }
      if (poll !== undefined) {
        clearInterval(poll);
      }
      resolveStop();
    };
    const groupGone = (): boolean =>
      hasChildExited(child) && !isProcessGroupAlive(child);
    const softTimer = setTimeout(() => {
      if (groupGone()) {
        finish();
        return;
      }
      killProcessGroup({ child, signal: "SIGKILL" });
      if (killGraceMs <= 0) {
        finish();
        return;
      }
      hardTimer = setTimeout(finish, killGraceMs);
    }, timeoutMs);

    const stopSurvivingMembers = (): void => {
      if (!isProcessGroupAlive(child)) {
        finish();
        return;
      }
      killProcessGroup({ child, signal: "SIGTERM" });
      poll = setInterval(() => {
        if (!isProcessGroupAlive(child)) {
          finish();
        }
      }, PROCESS_GROUP_EXIT_POLL_MS);
    };

    if (hasChildExited(child)) {
      stopSurvivingMembers();
      return;
    }
    child.once("exit", stopSurvivingMembers);
    child.kill("SIGTERM");
  });
}
