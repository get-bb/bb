import { spawn, type ChildProcess } from "node:child_process";
import {
  accessSync,
  closeSync,
  constants,
  mkdirSync,
  openSync,
  renameSync,
  statSync,
} from "node:fs";
import { join } from "node:path";

const MAX_STDIO_LOG_BYTES_AT_SPAWN = 10 * 1024 * 1024;
const MACOS_TASKPOLICY_PATH = "/usr/sbin/taskpolicy";

interface SpawnLoggedProcessArgs {
  args: string[];
  command: string;
  env: NodeJS.ProcessEnv;
  ipc?: boolean;
  logDir: string;
  logName: "server" | "host-daemon";
}

interface ProcessLaunch {
  args: string[];
  command: string;
}

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveLoggedProcessLaunch(launch: ProcessLaunch): ProcessLaunch {
  if (
    process.platform !== "darwin" ||
    !isExecutable(MACOS_TASKPOLICY_PATH) ||
    !isExecutable(launch.command)
  ) {
    return launch;
  }
  return {
    command: MACOS_TASKPOLICY_PATH,
    args: ["-a", launch.command, ...launch.args],
  };
}

export function spawnLoggedProcess(args: SpawnLoggedProcessArgs): ChildProcess {
  mkdirSync(args.logDir, { recursive: true });
  const logPath = join(args.logDir, `${args.logName}-stdio.log`);
  if (
    (statSync(logPath, { throwIfNoEntry: false })?.size ?? 0) >
    MAX_STDIO_LOG_BYTES_AT_SPAWN
  ) {
    renameSync(logPath, join(args.logDir, `${args.logName}-stdio.1.log`));
  }
  const launch = resolveLoggedProcessLaunch(args);
  const fd = openSync(logPath, "a", 0o600);
  try {
    return spawn(launch.command, launch.args, {
      cwd: process.cwd(),
      env: args.env,
      stdio: args.ipc === true ? ["ignore", fd, fd, "ipc"] : ["ignore", fd, fd],
    });
  } finally {
    closeSync(fd);
  }
}
