import { spawn } from "node:child_process";
import type { HostDaemonOnlineRpcResult } from "@bb/host-daemon-contract";

type CaffeinateResult = HostDaemonOnlineRpcResult<"host.caffeinate">;

export interface CaffeinateChildProcess {
  kill(signal?: NodeJS.Signals): boolean;
  on(
    event: "exit",
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): this;
  unref(): void;
}

export interface CaffeinateProcessSpawner {
  spawn(command: string, args: readonly string[]): CaffeinateChildProcess;
}

export interface CaffeinateManager {
  setEnabled(enabled: boolean): CaffeinateResult;
  shutdown(): void;
}

export interface CreateCaffeinateManagerOptions {
  pid?: number;
  platform?: NodeJS.Platform;
  spawner?: CaffeinateProcessSpawner;
}

const CAFFEINATE_COMMAND = "/usr/bin/caffeinate";

const defaultSpawner: CaffeinateProcessSpawner = {
  spawn(command, args) {
    const child = spawn(command, [...args], { stdio: "ignore" });
    child.unref();
    return child;
  },
};

export function createCaffeinateManager(
  options: CreateCaffeinateManagerOptions = {},
): CaffeinateManager {
  const platform = options.platform ?? process.platform;
  const pid = options.pid ?? process.pid;
  const spawner = options.spawner ?? defaultSpawner;
  let child: CaffeinateChildProcess | null = null;

  function stopCurrent(): void {
    const activeChild = child;
    if (activeChild === null) {
      return;
    }
    child = null;
    activeChild.kill("SIGTERM");
  }

  function start(): void {
    if (child !== null) {
      return;
    }
    const nextChild = spawner.spawn(CAFFEINATE_COMMAND, [
      "-i",
      "-w",
      String(pid),
    ]);
    child = nextChild;
    nextChild.on("exit", () => {
      if (child === nextChild) {
        child = null;
      }
    });
  }

  return {
    setEnabled(enabled) {
      if (platform !== "darwin") {
        stopCurrent();
        return { enabled: false, supported: false };
      }

      if (enabled) {
        start();
      } else {
        stopCurrent();
      }
      return { enabled: child !== null, supported: true };
    },
    shutdown() {
      stopCurrent();
    },
  };
}
