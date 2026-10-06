import { lstat, readdir, readlink, realpath } from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";
import { spawnPortableOutputProcess } from "./spawn.js";

interface ProcessWithCwd {
  pid: number;
  cwd: string;
}

interface ListProcessesWithCwdUnderArgs {
  directory: string;
}

interface KillProcessesWithCwdUnderArgs {
  directory: string;
  graceMs?: number;
}

function isPathUnderDirectory(candidate: string, directory: string): boolean {
  const normalized = candidate.endsWith(" (deleted)")
    ? candidate.slice(0, -" (deleted)".length)
    : candidate;
  return (
    normalized === directory || normalized.startsWith(`${directory}${sep}`)
  );
}

async function listLinuxProcessCwds(): Promise<ProcessWithCwd[]> {
  const entries = await readdir("/proc");
  const results: ProcessWithCwd[] = [];
  await Promise.all(
    entries.map(async (entry) => {
      if (!/^\d+$/.test(entry)) {
        return;
      }
      try {
        const cwd = await readlink(`/proc/${entry}/cwd`);
        results.push({ pid: Number(entry), cwd });
      } catch {}
    }),
  );
  return results;
}

async function listLsofProcessCwds(): Promise<ProcessWithCwd[]> {
  const child = spawnPortableOutputProcess({
    command: "lsof",
    args: ["-a", "-d", "cwd", "-F", "pn", "-w", "-n"],
  });
  const chunks: Buffer[] = [];
  child.stdout.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
  child.stderr.resume();
  await new Promise<void>((resolveExit) => {
    child.once("error", () => resolveExit());
    child.once("exit", () => resolveExit());
  });
  const results: ProcessWithCwd[] = [];
  let pid: number | null = null;
  for (const line of Buffer.concat(chunks).toString("utf8").split("\n")) {
    if (line.startsWith("p")) {
      pid = Number(line.slice(1));
    } else if (line.startsWith("n") && pid !== null) {
      results.push({ pid, cwd: line.slice(1) });
    }
  }
  return results;
}

async function resolveSweepDirectory(
  directory: string,
): Promise<string | null> {
  const resolved = resolve(directory);
  let parent = dirname(resolved);
  try {
    parent = await realpath(parent);
  } catch {}
  const canonical = join(parent, basename(resolved));
  try {
    if ((await lstat(canonical)).isSymbolicLink()) {
      return null;
    }
  } catch {}
  return canonical;
}

export async function listProcessesWithCwdUnder(
  args: ListProcessesWithCwdUnderArgs,
): Promise<ProcessWithCwd[]> {
  if (process.platform === "win32") {
    return [];
  }
  const directory = await resolveSweepDirectory(args.directory);
  if (directory === null) {
    return [];
  }
  const all =
    process.platform === "linux"
      ? await listLinuxProcessCwds()
      : await listLsofProcessCwds();
  return all.filter(
    (entry) =>
      entry.pid !== process.pid && isPathUnderDirectory(entry.cwd, directory),
  );
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

const MAX_CWD_SWEEP_ROUNDS = 5;

function signalProcesses(
  targets: ProcessWithCwd[],
  signal: NodeJS.Signals,
  signalled: Map<number, ProcessWithCwd>,
): void {
  for (const target of targets) {
    try {
      process.kill(target.pid, signal);
      signalled.set(target.pid, target);
    } catch {}
  }
}

export async function killProcessesWithCwdUnder(
  args: KillProcessesWithCwdUnderArgs,
): Promise<ProcessWithCwd[]> {
  const graceMs = args.graceMs ?? 2000;
  const signalled = new Map<number, ProcessWithCwd>();
  for (let round = 0; round < MAX_CWD_SWEEP_ROUNDS; round += 1) {
    const targets = await listProcessesWithCwdUnder({
      directory: args.directory,
    });
    if (targets.length === 0) {
      break;
    }
    signalProcesses(targets, "SIGTERM", signalled);
    const deadline = Date.now() + graceMs;
    while (
      Date.now() < deadline &&
      targets.some((target) => isProcessAlive(target.pid))
    ) {
      await delay(50);
    }
    const survivors = await listProcessesWithCwdUnder({
      directory: args.directory,
    });
    if (survivors.length === 0) {
      break;
    }
    signalProcesses(survivors, "SIGKILL", signalled);
    await delay(50);
  }
  return Array.from(signalled.values());
}
