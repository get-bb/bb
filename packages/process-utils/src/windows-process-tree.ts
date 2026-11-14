import { execHostFileCallback as execFile } from "./host-process.js";
import type { ChildProcess } from "node:child_process";
import path from "node:path";
import { appendFileSync } from "node:fs";
import type { ProcessStopResult } from "./process-group.js";

function hasExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

export function terminateWindowsProcessTrees(
  pids: readonly number[],
): Promise<boolean> {
  if (pids.length === 0) return Promise.resolve(true);
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
        [...pids.flatMap((pid) => ["/pid", String(pid)]), "/T", "/F"],
        { windowsHide: true },
        (error, stdout, stderr) => {
          const log = process.env.BB_DIAG_KILL_LOG;
          if (log) {
            try {
              appendFileSync(
                log,
                `${new Date().toISOString()} killer=${process.pid} argv1=${process.argv[1] ?? ""} taskkill ${pids.join(",")} -> ${String(stdout).replace(/\r?\n/g, " | ")} ${String(stderr).replace(/\r?\n/g, " | ")}\n`,
              );
            } catch {}
          }
          finish(error === null);
        },
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
  const terminated = await terminateWindowsProcessTrees([child.pid]);
  if (!hasExited(child)) child.kill("SIGKILL");
  await waitForRootExit(child);
  return { treeTermination: terminated ? "confirmed" : "unverified" };
}
