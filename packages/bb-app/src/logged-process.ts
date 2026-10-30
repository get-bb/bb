import { spawnHostProcess as spawn } from "@bb/process-utils";
import type { ChildProcess } from "node:child_process";
import { closeSync, mkdirSync, openSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";

const MAX_STDIO_LOG_BYTES_AT_SPAWN = 10 * 1024 * 1024;

interface SpawnLoggedProcessArgs {
  args: string[];
  command: string;
  env: NodeJS.ProcessEnv;
  ipc?: boolean;
  logDir: string;
  logName: "server" | "host-daemon";
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
  const fd = openSync(logPath, "a", 0o600);
  try {
    return spawn(args.command, args.args, {
      cwd: process.cwd(),
      env: args.env,
      stdio: args.ipc === true ? ["ignore", fd, fd, "ipc"] : ["ignore", fd, fd],
    });
  } finally {
    closeSync(fd);
  }
}
