import { performance } from "node:perf_hooks";
import { readProcessTable, type ProcessTableEntry } from "./process-start.js";

const STOP_POLL_MS = 100;
const KILL_CONFIRM_MS = 1_000;

export interface RecordedProcess {
  pid: number;
  processGroup: boolean;
  startId: string | null;
}

export type RecordedProcessStop = "exited" | "terminated" | "unverified";

export type ProcessTreeMember = ProcessTableEntry;

export interface ProcessTreeSnapshot {
  members: ProcessTableEntry[];
  groups: number[];
  unverified: boolean;
  roots: readonly RecordedProcess[];
}

function groupBy(
  entries: readonly ProcessTableEntry[],
  key: (entry: ProcessTableEntry) => number,
): Map<number, ProcessTableEntry[]> {
  const groups = new Map<number, ProcessTableEntry[]>();
  for (const entry of entries) {
    const list = groups.get(key(entry));
    if (list === undefined) groups.set(key(entry), [entry]);
    else list.push(entry);
  }
  return groups;
}

function collectProcessTree(
  table: readonly ProcessTableEntry[],
  roots: readonly RecordedProcess[],
): Omit<ProcessTreeSnapshot, "roots"> {
  const byPid = new Map(table.map((entry) => [entry.pid, entry]));
  const children = groupBy(table, (entry) => entry.ppid);
  const groupMembers = groupBy(table, (entry) => entry.pgid);
  const ownGroup = byPid.get(process.pid)?.pgid ?? null;
  const collected = new Map<number, ProcessTableEntry>();
  const groups = new Set<number>();
  const queue: ProcessTableEntry[] = [];
  let unverified = false;
  const add = (entry: ProcessTableEntry): void => {
    if (entry.pid <= 1 || entry.pid === process.pid) return;
    if (collected.has(entry.pid)) return;
    collected.set(entry.pid, entry);
    queue.push(entry);
  };
  const addGroup = (pgid: number): void => {
    if (pgid <= 1 || pgid === ownGroup || groups.has(pgid)) return;
    const members = groupMembers.get(pgid) ?? [];
    if (members.length === 0) return;
    groups.add(pgid);
    for (const member of members) add(member);
  };
  for (const root of roots) {
    const entry = byPid.get(root.pid);
    if (
      entry !== undefined &&
      root.startId !== null &&
      entry.startId === root.startId
    ) {
      add(entry);
      if (root.processGroup) addGroup(root.pid);
      continue;
    }
    if (entry !== undefined) unverified = true;
    if (
      entry === undefined &&
      root.processGroup &&
      (groupMembers.get(root.pid)?.length ?? 0) > 0
    )
      unverified = true;
  }
  for (let entry = queue.shift(); entry !== undefined; entry = queue.shift()) {
    for (const child of children.get(entry.pid) ?? []) add(child);
    if (entry.pgid === entry.pid) addGroup(entry.pid);
  }
  return { members: [...collected.values()], groups: [...groups], unverified };
}

export async function snapshotProcessTree(
  roots: readonly RecordedProcess[],
): Promise<ProcessTreeSnapshot> {
  if (process.platform === "win32")
    return { members: [], groups: [], unverified: false, roots };
  return { ...collectProcessTree(await readProcessTable(), roots), roots };
}

export async function snapshotChildTree(child: {
  pid?: number | undefined;
  exitCode: number | null;
  signalCode: NodeJS.Signals | null;
}): Promise<ProcessTreeSnapshot | null> {
  const exited = () => child.exitCode !== null || child.signalCode !== null;
  if (process.platform === "win32" || child.pid === undefined || exited())
    return null;
  const table = await readProcessTable();
  if (exited()) return null;
  const entry = table.find((candidate) => candidate.pid === child.pid);
  if (entry === undefined) return null;
  const roots = [
    { pid: entry.pid, processGroup: false, startId: entry.startId },
  ];
  return { ...collectProcessTree(table, roots), roots };
}

function signalTree(
  members: readonly ProcessTableEntry[],
  groups: readonly number[],
  signal: NodeJS.Signals,
): void {
  for (const pgid of groups) {
    try {
      process.kill(-pgid, signal);
    } catch {}
  }
  for (const member of members) {
    try {
      process.kill(member.pid, signal);
    } catch {}
  }
}

function signalable(pid: number): boolean {
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

async function waitUntilSignalsFail(
  members: readonly ProcessTableEntry[],
  groups: readonly number[],
  timeoutMs: number,
): Promise<void> {
  const deadline = performance.now() + timeoutMs;
  while (
    performance.now() < deadline &&
    (members.some((member) => signalable(member.pid)) ||
      groups.some((pgid) => signalable(-pgid)))
  ) {
    await new Promise((resolve) => setTimeout(resolve, STOP_POLL_MS));
  }
}

interface SurvivingTree {
  members: ProcessTableEntry[];
  groups: number[];
  mismatched: boolean;
}

function survivingTree(
  table: readonly ProcessTableEntry[],
  snapshot: Pick<ProcessTreeSnapshot, "members" | "groups">,
): SurvivingTree {
  const live = new Map(table.map((entry) => [entry.pid, entry]));
  let mismatched = false;
  const members = snapshot.members.flatMap((member) => {
    const current = live.get(member.pid);
    if (current === undefined) return [];
    if (current.startId !== member.startId) {
      mismatched = true;
      return [];
    }
    return [current];
  });
  const groups = snapshot.groups.filter((pgid) =>
    members.some((member) => member.pgid === pgid),
  );
  const known = new Set(members.map((member) => member.pid));
  const stragglers = table.filter(
    (entry) =>
      groups.includes(entry.pgid) &&
      !known.has(entry.pid) &&
      entry.pid !== process.pid,
  );
  return { members: [...members, ...stragglers], groups, mismatched };
}

export async function stopProcessTree(
  snapshot: ProcessTreeSnapshot,
  args: { graceMs: number },
): Promise<RecordedProcessStop> {
  if (process.platform === "win32") return stopWindowsRoots(snapshot.roots);
  let unverified = snapshot.unverified;
  const survivors = async (
    tree: Pick<ProcessTreeSnapshot, "members" | "groups">,
  ): Promise<SurvivingTree> => {
    const remaining = survivingTree(await readProcessTable(), tree);
    if (remaining.mismatched) unverified = true;
    return remaining;
  };
  const settle = (result: RecordedProcessStop): RecordedProcessStop =>
    unverified ? "unverified" : result;
  let remaining: SurvivingTree;
  try {
    remaining = await survivors(snapshot);
  } catch {
    return "unverified";
  }
  if (remaining.members.length === 0) return settle("exited");
  signalTree(remaining.members, remaining.groups, "SIGTERM");
  await waitUntilSignalsFail(remaining.members, remaining.groups, args.graceMs);
  try {
    remaining = await survivors(remaining);
    if (remaining.members.length === 0) return settle("terminated");
    signalTree(remaining.members, remaining.groups, "SIGKILL");
    await waitUntilSignalsFail(
      remaining.members,
      remaining.groups,
      KILL_CONFIRM_MS,
    );
    return (await survivors(remaining)).members.length === 0
      ? settle("terminated")
      : "unverified";
  } catch {
    return "unverified";
  }
}

function stopWindowsRoots(
  roots: readonly RecordedProcess[],
): RecordedProcessStop {
  return roots.some((root) => signalable(root.pid)) ? "unverified" : "exited";
}

export async function stopRecordedProcesses(
  recorded: readonly RecordedProcess[],
  args: { graceMs: number },
): Promise<RecordedProcessStop> {
  if (recorded.length === 0) return "exited";
  let snapshot: ProcessTreeSnapshot;
  try {
    snapshot = await snapshotProcessTree(recorded);
  } catch {
    return "unverified";
  }
  return stopProcessTree(snapshot, args);
}

export function stopRecordedProcess(
  recorded: RecordedProcess,
  args: { graceMs: number },
): Promise<RecordedProcessStop> {
  return stopRecordedProcesses([recorded], args);
}
