import { execFile as execFileCallback } from "node:child_process";
import { realpath } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

const POLL_INTERVAL_MS = 50;
const DEFAULT_GRACE_MS = 1_000;
const PROCESS_LIST_MAX_BUFFER = 64 * 1024 * 1024;

interface ListedProcess {
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

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !(
      error instanceof Error &&
      "code" in error &&
      error.code === "ESRCH"
    );
  }
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
  const protectedPids = ancestorsOf(process.pid, parents).add(process.pid);
  const children = new Map<number, number[]>();
  for (const entry of processes) {
    children.set(entry.ppid, [...(children.get(entry.ppid) ?? []), entry.pid]);
  }
  const targets = new Set<number>();
  const pending = processes
    .filter((entry) =>
      spellings.some((spelling) => referencesPath(entry.args, spelling)),
    )
    .map((entry) => entry.pid);
  while (pending.length > 0) {
    const pid = pending.pop()!;
    if (protectedPids.has(pid) || targets.has(pid)) continue;
    targets.add(pid);
    pending.push(...(children.get(pid) ?? []));
  }
  if (targets.size === 0) return [];
  signal(targets, "SIGTERM");
  const graceMs = options.graceMs ?? DEFAULT_GRACE_MS;
  for (let waited = 0; waited < graceMs; waited += POLL_INTERVAL_MS) {
    if (![...targets].some(isAlive)) break;
    await sleep(POLL_INTERVAL_MS);
  }
  signal([...targets].filter(isAlive), "SIGKILL");
  return [...targets];
}
