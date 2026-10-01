import { spawnPortablePipedProcess } from "./spawn.js";
import {
  stopProcessGroupLeaderFirst,
  supportsProcessGroups,
} from "./process-group.js";

interface ManagedProcessRequest {
  command: string;
  args: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

export interface ManagedProcess {
  child: ReturnType<typeof spawnPortablePipedProcess>;
  stop(options?: { timeoutMs: number }): Promise<void>;
}

export function spawnManagedProcess(
  request: ManagedProcessRequest,
): ManagedProcess {
  const child = spawnPortablePipedProcess({
    ...request,
    detached: supportsProcessGroups(),
  });
  const exited = new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
    child.once("error", () => {
      if (child.pid === undefined) resolve();
    });
  });
  let stopping: Promise<void> | undefined;
  return {
    child,
    stop({ timeoutMs } = { timeoutMs: 1_000 }) {
      stopping ??= (async () => {
        if (child.pid !== undefined) {
          await stopProcessGroupLeaderFirst({
            child,
            timeoutMs,
            killGraceMs: 1_000,
          });
        }
        await exited;
      })();
      return stopping;
    },
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
