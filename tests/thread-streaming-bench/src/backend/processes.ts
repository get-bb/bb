import { spawn, type ChildProcess } from "node:child_process";
import { closeSync, openSync, readdirSync, readFileSync } from "node:fs";
import { createServer } from "node:net";

interface SpawnLoggedArgs {
  args: string[];
  command: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  logPath: string;
}

export function spawnLogged(args: SpawnLoggedArgs): ChildProcess {
  const logFd = openSync(args.logPath, "a");
  try {
    return spawn(args.command, args.args, {
      cwd: args.cwd,
      detached: true,
      env: args.env,
      stdio: ["ignore", logFd, logFd],
    });
  } finally {
    closeSync(logFd);
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function stopProcessGroup(
  pid: number | undefined,
  timeoutMs = 10_000,
): Promise<void> {
  if (pid === undefined || !isAlive(pid)) {
    return;
  }
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    process.kill(pid, "SIGTERM");
  }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && isAlive(pid)) {
    await sleep(100);
  }
  if (isAlive(pid)) {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      process.kill(pid, "SIGKILL");
    }
  }
}

export async function reservePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("Failed to reserve a port"));
        return;
      }
      const { port } = address;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

interface ProcStat {
  cpuTicks: number;
  ppid: number;
}

function readProcStat(pid: number): ProcStat | null {
  let raw: string;
  try {
    raw = readFileSync(`/proc/${pid}/stat`, "utf8");
  } catch {
    return null;
  }
  const commEnd = raw.lastIndexOf(")");
  const fields = raw.slice(commEnd + 2).split(" ");
  const ppid = Number(fields[1]);
  const utime = Number(fields[11]);
  const stime = Number(fields[12]);
  return { cpuTicks: utime + stime, ppid };
}

const CLOCK_TICKS_PER_SECOND = 100;

export function processTreeCpuMs(rootPid: number): number {
  const stats = new Map<number, ProcStat>();
  for (const entry of readdirSync("/proc")) {
    const pid = Number(entry);
    if (!Number.isInteger(pid)) {
      continue;
    }
    const stat = readProcStat(pid);
    if (stat !== null) {
      stats.set(pid, stat);
    }
  }
  const children = new Map<number, number[]>();
  for (const [pid, stat] of stats) {
    const list = children.get(stat.ppid) ?? [];
    list.push(pid);
    children.set(stat.ppid, list);
  }
  let ticks = 0;
  const queue = [rootPid];
  while (queue.length > 0) {
    const pid = queue.pop();
    if (pid === undefined) {
      continue;
    }
    ticks += stats.get(pid)?.cpuTicks ?? 0;
    queue.push(...(children.get(pid) ?? []));
  }
  return (ticks * 1000) / CLOCK_TICKS_PER_SECOND;
}

export function sanitizedParentEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith("BB_") || key === "NODE_OPTIONS") {
      continue;
    }
    env[key] = value;
  }
  return env;
}
