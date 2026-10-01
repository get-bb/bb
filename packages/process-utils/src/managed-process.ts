import type { ChildProcess } from "node:child_process";
import { spawnPortablePipedProcess } from "./spawn.js";
import {
  stopProcessGroupLeaderFirst,
  supportsProcessGroups,
  type ProcessStopResult,
} from "./process-group.js";

interface ManagedProcessRequest {
  command: string;
  args: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

export interface ManagedProcess {
  child: ReturnType<typeof spawnPortablePipedProcess>;
  stop(options?: { gracePeriodMs: number }): Promise<ProcessStopResult>;
}

export function spawnManagedProcess(
  request: ManagedProcessRequest,
): ManagedProcess {
  const child = spawnPortablePipedProcess({
    ...request,
    detached: supportsProcessGroups(),
  });
  return { child, stop: createProcessStop(child) };
}

export function createProcessStop(child: ChildProcess): ManagedProcess["stop"] {
  let stopping: Promise<ProcessStopResult> | undefined;
  return function stop({ gracePeriodMs } = { gracePeriodMs: 1_000 }) {
    stopping ??= (async () => {
      if (child.pid === undefined) {
        return { treeTermination: "confirmed" };
      }
      const result = await stopProcessGroupLeaderFirst({
        child,
        timeoutMs: gracePeriodMs,
        killGraceMs: 1_000,
      });
      if (child.exitCode === null && child.signalCode === null) {
        throw new Error(`Process did not exit after termination: ${child.pid}`);
      }
      return result;
    })();
    return stopping;
  };
}

export function isClosedProcessStdinError(error: Error): boolean {
  return (
    "code" in error &&
    (error.code === "EPIPE" ||
      error.code === "EOF" ||
      error.code === "ERR_STREAM_DESTROYED")
  );
}
