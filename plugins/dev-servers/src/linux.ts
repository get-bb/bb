import { readFile, readdir, readlink, stat } from "node:fs/promises";
import path from "node:path";
import {
  isLauncher,
  type ListeningSocket,
  type ProcessEntry,
} from "./attribute.js";

const LISTEN_STATE = "0A";
const THREAD_ID_PREFIX = "BB_THREAD_ID=";

export interface ProcessSnapshot {
  table: Map<number, ProcessEntry>;
  sockets: ListeningSocket[];
}

function hexBytes(hex: string): number[] {
  const bytes: number[] = [];
  for (let index = 0; index < hex.length; index += 2)
    bytes.push(Number.parseInt(hex.slice(index, index + 2), 16));
  return bytes;
}

export function decodeProcAddress(hex: string): string {
  const words: number[][] = [];
  for (let index = 0; index < hex.length; index += 8)
    words.push(hexBytes(hex.slice(index, index + 8)).reverse());
  const bytes = words.flat();
  if (bytes.length === 4) return bytes.join(".");
  const v4Mapped =
    bytes.slice(0, 10).every((byte) => byte === 0) &&
    bytes[10] === 0xff &&
    bytes[11] === 0xff;
  if (v4Mapped) return `::ffff:${bytes.slice(12).join(".")}`;
  const groups: string[] = [];
  for (let index = 0; index < 16; index += 2)
    groups.push(((bytes[index]! << 8) | bytes[index + 1]!).toString(16));
  const joined = groups.join(":");
  if (joined === "0:0:0:0:0:0:0:0") return "::";
  if (joined === "0:0:0:0:0:0:0:1") return "::1";
  return joined;
}

export function parseProcNetTcp(
  content: string,
  uid: number,
): Map<string, { port: number; address: string }> {
  const listening = new Map<string, { port: number; address: string }>();
  for (const line of content.split("\n").slice(1)) {
    const fields = line.trim().split(/\s+/);
    if (fields.length < 10 || fields[3] !== LISTEN_STATE) continue;
    if (Number(fields[7]) !== uid) continue;
    const [addressHex, portHex] = fields[1]!.split(":");
    if (addressHex === undefined || portHex === undefined) continue;
    listening.set(fields[9]!, {
      port: Number.parseInt(portHex, 16),
      address: decodeProcAddress(addressHex),
    });
  }
  return listening;
}

export function parseProcStat(content: string): { ppid: number } | null {
  const close = content.lastIndexOf(")");
  if (close === -1) return null;
  const fields = content.slice(close + 2).split(" ");
  const ppid = Number(fields[1]);
  return Number.isInteger(ppid) ? { ppid } : null;
}

export function threadIdFromEnviron(content: string): string | null {
  const entry = content
    .split("\0")
    .find((value) => value.startsWith(THREAD_ID_PREFIX));
  const threadId = entry?.slice(THREAD_ID_PREFIX.length) ?? "";
  return threadId === "" ? null : threadId;
}

const READ_BATCH = 64;

async function mapInBatches<T, R>(
  items: readonly T[],
  map: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  for (let index = 0; index < items.length; index += READ_BATCH)
    results.push(
      ...(await Promise.all(items.slice(index, index + READ_BATCH).map(map))),
    );
  return results;
}

async function readOptional(file: string): Promise<string | null> {
  try {
    return await readFile(file, "utf8");
  } catch {
    return null;
  }
}

async function readProcess(
  procRoot: string,
  pid: number,
  uid: number,
): Promise<ProcessEntry | null> {
  const directory = path.join(procRoot, String(pid));
  try {
    if ((await stat(directory)).uid !== uid) return null;
  } catch {
    return null;
  }
  const [statContent, comm, environ] = await Promise.all([
    readOptional(path.join(directory, "stat")),
    readOptional(path.join(directory, "comm")),
    readOptional(path.join(directory, "environ")),
  ]);
  const parsed = statContent === null ? null : parseProcStat(statContent);
  if (parsed === null || comm === null) return null;
  const threadId = environ === null ? null : threadIdFromEnviron(environ);
  const name = comm.trim();
  const cmdline =
    threadId === null
      ? null
      : await readOptional(path.join(directory, "cmdline"));
  return {
    pid,
    ppid: parsed.ppid,
    name,
    threadId,
    launcher: isLauncher(name, cmdline?.split("\0") ?? []),
  };
}

async function socketInodes(procRoot: string, pid: number): Promise<string[]> {
  const directory = path.join(procRoot, String(pid), "fd");
  let entries: string[];
  try {
    entries = await readdir(directory);
  } catch {
    return [];
  }
  const links = await mapInBatches(entries, (entry) =>
    readlink(path.join(directory, entry)).catch(() => null),
  );
  return links.flatMap((link) => {
    const match = link === null ? null : /^socket:\[(\d+)\]$/.exec(link);
    return match === null ? [] : [match[1]!];
  });
}

export async function readLinuxSnapshot(
  uid: number,
  procRoot = "/proc",
): Promise<ProcessSnapshot> {
  const listening = new Map<string, { port: number; address: string }>();
  for (const file of ["tcp", "tcp6"]) {
    const content = await readOptional(path.join(procRoot, "net", file));
    if (content === null) continue;
    for (const [inode, socket] of parseProcNetTcp(content, uid))
      listening.set(inode, socket);
  }
  const pids = (await readdir(procRoot))
    .filter((entry) => /^\d+$/.test(entry))
    .map(Number);
  const entries = await mapInBatches(pids, (pid) =>
    readProcess(procRoot, pid, uid),
  );
  const table = new Map<number, ProcessEntry>();
  for (const entry of entries) if (entry !== null) table.set(entry.pid, entry);
  const sockets: ListeningSocket[] = [];
  if (listening.size === 0) return { table, sockets };
  for (const entry of table.values()) {
    if (entry.threadId === null) continue;
    for (const inode of await socketInodes(procRoot, entry.pid)) {
      const socket = listening.get(inode);
      if (socket !== undefined) sockets.push({ pid: entry.pid, ...socket });
    }
  }
  return { table, sockets };
}

export async function readLinuxCwd(
  pid: number,
  procRoot = "/proc",
): Promise<string | null> {
  try {
    return await readlink(path.join(procRoot, String(pid), "cwd"));
  } catch {
    return null;
  }
}
