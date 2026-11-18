import { execFile as execFileCallback } from "node:child_process";
import { realpath } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

const POLL_INTERVAL_MS = 50;
const DEFAULT_GRACE_MS = 1_000;
const PROCESS_LIST_MAX_BUFFER = 64 * 1024 * 1024;

export interface ListedProcess {
  pid: number;
  ppid: number;
  args: string;
}

interface KillProcessesReferencingPathOptions {
  graceMs?: number;
}

async function listProcesses(): Promise<ListedProcess[]> {
  const { stdout } = await execFile(
    "ps",
    ["-A", "-ww", "-o", "pid=", "-o", "ppid=", "-o", "args="],
    { encoding: "utf8", maxBuffer: PROCESS_LIST_MAX_BUFFER },
  );
  return stdout.split("\n").flatMap((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s(.*)$/u.exec(line);
    if (match === null) return [];
    return [{ pid: Number(match[1]), ppid: Number(match[2]), args: match[3]! }];
  });
}

async function pathSpellings(path: string): Promise<string[]> {
  const spellings = new Set([path.replace(/\/+$/u, "")]);
  const resolved = await realpath(path).catch(() => null);
  if (resolved !== null) spellings.add(resolved);
  for (const spelling of [...spellings]) {
    if (spelling.startsWith("/private/")) {
      spellings.add(spelling.slice("/private".length));
    } else if (/^\/(?:var|tmp|etc)\//u.test(spelling)) {
      spellings.add(`/private${spelling}`);
    }
  }
  return [...spellings].filter((spelling) => spelling.length > 1);
}

function referencesPath(args: string, spelling: string): boolean {
  let index = args.indexOf(spelling);
  while (index !== -1) {
    const next = args[index + spelling.length];
    if (next === undefined || /[/\s"'=:]/u.test(next)) return true;
    index = args.indexOf(spelling, index + 1);
  }
  return false;
}

function ancestorsOf(pid: number, parents: Map<number, number>): Set<number> {
  const ancestors = new Set<number>();
  let current = parents.get(pid);
  while (current !== undefined && current > 1 && !ancestors.has(current)) {
    ancestors.add(current);
    current = parents.get(current);
  }
  return ancestors;
}

async function stillListed(targets: Map<number, string>): Promise<number[]> {
  return (await listProcesses())
    .filter((entry) => targets.get(entry.pid) === entry.args)
    .map((entry) => entry.pid);
}

function signal(pids: Iterable<number>, name: NodeJS.Signals): void {
  for (const pid of pids) {
    try {
      process.kill(pid, name);
    } catch {}
  }
}

export async function killProcessesReferencingPath(
  path: string,
  options: KillProcessesReferencingPathOptions = {},
): Promise<number[]> {
  if (process.platform === "win32") return [];
  const spellings = await pathSpellings(path);
  const processes = await listProcesses();
  const parents = new Map(processes.map((entry) => [entry.pid, entry.ppid]));
  const args = new Map(processes.map((entry) => [entry.pid, entry.args]));
  const protectedPids = ancestorsOf(process.pid, parents).add(process.pid);
  const children = new Map<number, number[]>();
  for (const entry of processes) {
    children.set(entry.ppid, [...(children.get(entry.ppid) ?? []), entry.pid]);
  }
  const targets = new Map<number, string>();
  const pending = processes
    .filter((entry) =>
      spellings.some((spelling) => referencesPath(entry.args, spelling)),
    )
    .map((entry) => entry.pid);
  while (pending.length > 0) {
    const pid = pending.pop()!;
    if (protectedPids.has(pid) || targets.has(pid)) continue;
    targets.set(pid, args.get(pid) ?? "");
    pending.push(...(children.get(pid) ?? []));
  }
  if (targets.size === 0) return [];
  signal(targets.keys(), "SIGTERM");
  const deadline = Date.now() + (options.graceMs ?? DEFAULT_GRACE_MS);
  let remaining = await stillListed(targets);
  while (remaining.length > 0 && Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    remaining = await stillListed(targets);
  }
  signal(remaining, "SIGKILL");
  return [...targets.keys()];
}

interface SignalDescendantProcessesArgs {
  select: (entry: ListedProcess, parent: ListedProcess | undefined) => boolean;
  signal: NodeJS.Signals;
}

export async function signalDescendantProcesses(
  args: SignalDescendantProcessesArgs,
): Promise<ListedProcess[]> {
  const processes = await listProcesses();
  const byPid = new Map(processes.map((entry) => [entry.pid, entry]));
  const descendants: ListedProcess[] = [];
  const pending = [process.pid];
  while (pending.length > 0) {
    const parent = pending.shift()!;
    for (const entry of processes) {
      if (entry.ppid !== parent) continue;
      descendants.push(entry);
      pending.push(entry.pid);
    }
  }
  const selected = descendants.filter((entry) =>
    args.select(entry, byPid.get(entry.ppid)),
  );
  signal(
    selected.map((entry) => entry.pid),
    args.signal,
  );
  return selected;
}
