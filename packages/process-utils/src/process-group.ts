import type { ChildProcess } from "node:child_process";
import { stopWindowsProcessTree } from "./windows-process-tree.js";

interface KillProcessGroupArgs {
  child: {
    pid?: number | undefined;
    kill: (signal: NodeJS.Signals) => unknown;
  };
  signal: NodeJS.Signals;
}

export interface ProcessStopResult {
  treeTermination: "confirmed" | "unverified";
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

export function killPortableProcess(
  child: ChildProcess,
  signal: NodeJS.Signals,
): void {
  if (process.platform === "win32") {
    stopWindowsProcessTree(child).catch(() => undefined);
    return;
  }
  child.kill(signal);
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
  } catch (error) {
    return !(
      error instanceof Error &&
      "code" in error &&
      error.code === "ESRCH"
    );
  }
}
