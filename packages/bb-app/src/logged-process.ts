import { spawn, type ChildProcess } from "node:child_process";
import { closeSync, mkdirSync, openSync } from "node:fs";
import { join } from "node:path";

interface SpawnLoggedProcessArgs {
  args: string[];
  command: string;
  env: NodeJS.ProcessEnv;
  logDir: string;
  logName: "server" | "host-daemon";
}

export function spawnLoggedProcess(args: SpawnLoggedProcessArgs): ChildProcess {
  mkdirSync(args.logDir, { recursive: true });
  const fd = openSync(
    join(args.logDir, `${args.logName}-stdio.log`),
    "a",
    0o600,
  );
  try {
    return spawn(args.command, args.args, {
      cwd: process.cwd(),
      env: args.env,
      stdio: ["ignore", fd, fd],
    });
  } finally {
    closeSync(fd);
  }
}
