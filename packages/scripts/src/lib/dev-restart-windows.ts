// bb-fork(windows): `process.kill(pid, "SIGUSR1")` throws ERR_UNKNOWN_SIGNAL on Windows,
// bb-fork(windows): so dev restarts travel through a request file the supervisor polls.
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { resolveDevDataDir } from "./dev-restart-utils.js";

const DEV_RESTART_FILE_SUFFIX = ".restart";
const DEV_RESTART_POLL_INTERVAL_MS = 250;

interface DevRestartPathArgs {
  restartPath?: string;
  serviceName: string;
}

export function resolveDevRestartPath(args: DevRestartPathArgs): string {
  return (
    args.restartPath ??
    join(
      resolveDevDataDir(),
      "dev-supervisors",
      `${args.serviceName}${DEV_RESTART_FILE_SUFFIX}`,
    )
  );
}

export function requestDevSupervisorRestart(args: {
  pid: number;
  platform?: NodeJS.Platform;
  restartPath?: string;
  serviceName: string;
}): "file" | "signal" {
  if ((args.platform ?? process.platform) !== "win32") {
    process.kill(args.pid, "SIGUSR1");
    return "signal";
  }

  const restartPath = resolveDevRestartPath(args);
  mkdirSync(dirname(restartPath), { recursive: true });
  writeFileSync(restartPath, "restart", "utf8");
  return "file";
}

export function takeDevSupervisorRestartRequest(
  args: DevRestartPathArgs,
): boolean {
  const restartPath = resolveDevRestartPath(args);
  if (!existsSync(restartPath)) {
    return false;
  }

  rmSync(restartPath, { force: true });
  return true;
}

export function installDevRestartWatcher(args: {
  onRestart: () => void;
  platform?: NodeJS.Platform;
  pollIntervalMs?: number;
  restartPath?: string;
  serviceName: string;
}): () => void {
  if ((args.platform ?? process.platform) !== "win32") {
    return () => {};
  }

  if (args.serviceName.length === 0) {
    return () => {};
  }

  takeDevSupervisorRestartRequest(args);
  const timer = setInterval(() => {
    if (takeDevSupervisorRestartRequest(args)) {
      args.onRestart();
    }
  }, args.pollIntervalMs ?? DEV_RESTART_POLL_INTERVAL_MS);
  timer.unref();
  return () => clearInterval(timer);
}
