import type { ChildProcess } from "node:child_process";
import { spawnPortablePipedProcess } from "./spawn.js";
import {
  isProcessGroupAlive,
  supportsProcessGroups,
  type ProcessStopResult,
} from "./process-group.js";
import {
  processTerminated,
  stopWindowsProcessTree,
} from "./windows-process-tree.js";
import { snapshotChildTree, stopProcessTree } from "./recorded-process.js";

interface ManagedProcessRequest {
  command: string;
  args: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

export interface ManagedProcess {
  child: ReturnType<typeof spawnPortablePipedProcess>;
  processGroup: boolean;
  stop(options?: { gracePeriodMs: number }): Promise<ProcessStopResult>;
}

export function spawnManagedProcess(
  request: ManagedProcessRequest,
): ManagedProcess {
  const processGroup = supportsProcessGroups();
  const child = spawnPortablePipedProcess({
    ...request,
    detached: processGroup,
  });
  return { child, processGroup, stop: createProcessStop(child) };
}

const KILL_GRACE_MS = 1_000;

export function createProcessStop(child: ChildProcess): ManagedProcess["stop"] {
  let stopping: Promise<ProcessStopResult> | undefined;
  return function stop({ gracePeriodMs } = { gracePeriodMs: 1_000 }) {
    stopping ??= stopChild(child, gracePeriodMs);
    return stopping;
  };
}

function hasExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<void> {
  if (hasExited(child)) return Promise.resolve();
  return new Promise((resolve) => {
    const done = (): void => {
      clearTimeout(timer);
      child.off("exit", done);
      resolve();
    };
    const timer = setTimeout(done, timeoutMs);
    child.once("exit", done);
  });
}

async function stopChild(
  child: ChildProcess,
  gracePeriodMs: number,
): Promise<ProcessStopResult> {
  if (child.pid === undefined) return { treeTermination: "confirmed" };
  if (process.platform === "win32") return stopWindowsProcessTree(child);
  const exitedBeforeStop = hasExited(child);
  const tree = await snapshotChildTree(child).catch(() => null);
  if (!hasExited(child)) child.kill("SIGTERM");
  await waitForExit(child, gracePeriodMs);
  let treeTermination: ProcessStopResult["treeTermination"];
  if (tree !== null) {
    const result = await stopProcessTree(tree, { graceMs: KILL_GRACE_MS });
    treeTermination = result === "unverified" ? "unverified" : "confirmed";
  } else {
    if (!hasExited(child)) {
      child.kill("SIGKILL");
      await waitForExit(child, KILL_GRACE_MS);
    }
    treeTermination =
      exitedBeforeStop && !isProcessGroupAlive(child)
        ? "confirmed"
        : "unverified";
  }
  if (!processTerminated(child)) {
    throw new Error(`Process did not exit after termination: ${child.pid}`);
  }
  return { treeTermination };
}

export function isClosedProcessStdinError(error: Error): boolean {
  return (
    "code" in error &&
    (error.code === "EPIPE" ||
      error.code === "EOF" ||
      error.code === "ERR_STREAM_DESTROYED")
  );
}
