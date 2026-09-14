import { spawn as spawnRaw, type ChildProcess } from "node:child_process";
import type {
  KillProcessGroupArgs,
  StopProcessGroupLeaderFirstArgs,
} from "./index.js";

function hasChildExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

function terminateWindowsProcessTree(pid: number): boolean {
  try {
    const killer = spawnRaw("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
    killer.once("error", () => undefined);
    return true;
  } catch {
    return false;
  }
}

export function killProcessGroupOnWindows(args: KillProcessGroupArgs): boolean {
  if (process.platform !== "win32") {
    return false;
  }
  if (
    args.child.pid === undefined ||
    !terminateWindowsProcessTree(args.child.pid)
  ) {
    args.child.kill(args.signal);
  }
  return true;
}

export async function stopWindowsProcessTree(
  args: StopProcessGroupLeaderFirstArgs,
): Promise<void> {
  const { child, timeoutMs } = args;
  if (child.stdin && !child.stdin.destroyed) {
    child.stdin.end();
  }
  if (!hasChildExited(child)) {
    await new Promise<void>((resolveWait) => {
      const giveUp = setTimeout(resolveWait, Math.min(timeoutMs, 250));
      giveUp.unref?.();
      child.once("exit", () => {
        clearTimeout(giveUp);
        resolveWait();
      });
    });
  }
  if (hasChildExited(child)) return;
  const pid = child.pid;
  if (pid === undefined) return;
  await new Promise<void>((resolveKill) => {
    const killer = spawnRaw("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
    killer.once("exit", () => resolveKill());
    killer.once("error", () => resolveKill());
  });
  if (!hasChildExited(child)) {
    await new Promise<void>((resolveWait) => {
      const giveUp = setTimeout(resolveWait, 500);
      giveUp.unref?.();
      child.once("exit", () => {
        clearTimeout(giveUp);
        resolveWait();
      });
    });
  }
}
