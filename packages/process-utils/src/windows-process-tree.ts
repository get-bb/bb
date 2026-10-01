import { execFile, type ChildProcess } from "node:child_process";
import path from "node:path";
import type { ProcessStopResult } from "./process-group.js";

function hasExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

function terminateTree(pid: number): Promise<boolean> {
  return new Promise((resolve) => {
    let timer: NodeJS.Timeout | undefined;
    let killer: ChildProcess | undefined;
    let settled = false;
    const finish = (terminated: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(terminated);
    };
    try {
      killer = execFile(
        path.join(
          process.env.SystemRoot ?? "C:\\Windows",
          "System32",
          "taskkill.exe",
        ),
        ["/pid", String(pid), "/T", "/F"],
        { windowsHide: true },
        (error) => finish(error === null),
      );
      timer = setTimeout(() => {
        finish(false);
        try {
          killer?.kill("SIGKILL");
        } catch {}
      }, 2_000);
    } catch {
      finish(false);
    }
  });
}

function waitForRootExit(child: ChildProcess): Promise<void> {
  if (hasExited(child)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const onExit = (): void => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      child.off("exit", onExit);
      reject(new Error(`Process did not exit after termination: ${child.pid}`));
    }, 1_000);
    child.once("exit", onExit);
  });
}

export async function stopWindowsProcessTree(
  child: ChildProcess,
): Promise<ProcessStopResult> {
  if (child.pid === undefined || hasExited(child)) {
    return { treeTermination: "unverified" };
  }
  const terminated = await terminateTree(child.pid);
  if (!hasExited(child)) child.kill("SIGKILL");
  await waitForRootExit(child);
  return { treeTermination: terminated ? "confirmed" : "unverified" };
}
