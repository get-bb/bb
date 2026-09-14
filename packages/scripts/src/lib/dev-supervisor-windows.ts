// bb-fork(windows): Windows has no SIGUSR1 and cannot deliver SIGTERM to another
// bb-fork(windows): process, so dev supervisors are controlled through request files.
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { resolveDevDataDir } from "./dev-restart-utils.js";

const DEV_SUPERVISOR_DIRECTORY = "dev-supervisors";
const DEV_RESTART_FILE_SUFFIX = ".restart";
const DEV_STOP_FILE_SUFFIX = ".stop";
const DEV_REQUEST_POLL_INTERVAL_MS = 250;

interface DevSupervisorPathArgs {
  path?: string;
  serviceName: string;
}

interface DevSupervisorRequestArgs {
  path: string;
  platform?: NodeJS.Platform;
  pollIntervalMs?: number;
}

function resolveDevSupervisorPath(
  args: DevSupervisorPathArgs & { suffix: string },
): string {
  return (
    args.path ??
    join(
      resolveDevDataDir(),
      DEV_SUPERVISOR_DIRECTORY,
      `${args.serviceName}${args.suffix}`,
    )
  );
}

export function resolveDevRestartPath(args: DevSupervisorPathArgs): string {
  return resolveDevSupervisorPath({
    ...args,
    suffix: DEV_RESTART_FILE_SUFFIX,
  });
}

export function resolveDevStopPath(args: DevSupervisorPathArgs): string {
  return resolveDevSupervisorPath({ ...args, suffix: DEV_STOP_FILE_SUFFIX });
}

function writeDevSupervisorRequest(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, "request", "utf8");
}

export function consumeDevSupervisorRequest(path: string): boolean {
  if (!existsSync(path)) {
    return false;
  }

  rmSync(path, { force: true });
  return true;
}

function installDevSupervisorRequestWatcher(
  args: DevSupervisorRequestArgs & { onRequest: () => void },
): () => void {
  if ((args.platform ?? process.platform) !== "win32") {
    return () => {};
  }

  consumeDevSupervisorRequest(args.path);
  const timer = setInterval(() => {
    if (consumeDevSupervisorRequest(args.path)) {
      args.onRequest();
    }
  }, args.pollIntervalMs ?? DEV_REQUEST_POLL_INTERVAL_MS);
  timer.unref();
  return () => clearInterval(timer);
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

  writeDevSupervisorRequest(
    resolveDevRestartPath({
      path: args.restartPath,
      serviceName: args.serviceName,
    }),
  );
  return "file";
}

export function requestDevSupervisorStop(args: {
  serviceName: string;
  stopPath?: string;
}): void {
  writeDevSupervisorRequest(
    resolveDevStopPath({ path: args.stopPath, serviceName: args.serviceName }),
  );
}

export function installDevRestartWatcher(args: {
  onRestart: () => void;
  platform?: NodeJS.Platform;
  pollIntervalMs?: number;
  restartPath?: string;
  serviceName: string;
}): () => void {
  if (args.serviceName.length === 0) {
    return () => {};
  }

  return installDevSupervisorRequestWatcher({
    onRequest: args.onRestart,
    path: resolveDevRestartPath({
      path: args.restartPath,
      serviceName: args.serviceName,
    }),
    platform: args.platform,
    pollIntervalMs: args.pollIntervalMs,
  });
}

export function installDevStopWatcher(args: {
  onStop: () => void;
  platform?: NodeJS.Platform;
  pollIntervalMs?: number;
  serviceName: string;
  stopPath?: string;
}): () => void {
  if (args.serviceName.length === 0) {
    return () => {};
  }

  return installDevSupervisorRequestWatcher({
    onRequest: args.onStop,
    path: resolveDevStopPath({
      path: args.stopPath,
      serviceName: args.serviceName,
    }),
    platform: args.platform,
    pollIntervalMs: args.pollIntervalMs,
  });
}
