import path from "node:path";
import {
  isLauncher,
  type ListeningSocket,
  type ProcessEntry,
} from "./attribute.js";
import type { ProcessSnapshot } from "./linux.js";

export type RunTool = (
  command: string,
  args: readonly string[],
) => Promise<string | null>;

export function parsePsTable(
  output: string,
  uid: number,
): Map<number, Omit<ProcessEntry, "threadId" | "launcher">> {
  const table = new Map<number, Omit<ProcessEntry, "threadId" | "launcher">>();
  for (const line of output.split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/.exec(line);
    if (match === null || Number(match[3]) !== uid) continue;
    table.set(Number(match[1]), {
      pid: Number(match[1]),
      ppid: Number(match[2]),
      name: path.basename(match[4]!.trim()),
    });
  }
  return table;
}

export interface PsEnvironmentEntry {
  threadId: string | null;
  argv: string[];
}

export function parsePsEnvironment(
  output: string,
): Map<number, PsEnvironmentEntry> {
  const entries = new Map<number, PsEnvironmentEntry>();
  for (const line of output.split("\n")) {
    const match = /^\s*(\d+)\s+(.*)$/.exec(line);
    if (match === null) continue;
    const matches = [...match[2]!.matchAll(/(?:^|\s)BB_THREAD_ID=(\S+)/g)];
    entries.set(Number(match[1]), {
      threadId: matches.at(-1)?.[1] ?? null,
      argv: match[2]!.split(/\s+/).slice(0, 2),
    });
  }
  return entries;
}

export function parseLsofListeners(output: string): ListeningSocket[] {
  const sockets: ListeningSocket[] = [];
  let pid: number | null = null;
  for (const line of output.split("\n")) {
    if (line.startsWith("p")) pid = Number(line.slice(1));
    if (!line.startsWith("n") || pid === null) continue;
    const name = line.slice(1);
    const separator = name.lastIndexOf(":");
    const port = Number(name.slice(separator + 1));
    if (separator === -1 || !Number.isInteger(port)) continue;
    const host = name.slice(0, separator).replace(/^\[|\]$/g, "");
    sockets.push({ pid, port, address: host === "*" ? "0.0.0.0" : host });
  }
  return sockets;
}

export async function readDarwinSnapshot(
  uid: number,
  run: RunTool,
): Promise<ProcessSnapshot | null> {
  const [ps, environment, lsof] = await Promise.all([
    run("/bin/ps", ["-axo", "pid=,ppid=,uid=,comm="]),
    run("/bin/ps", ["-axwwE", "-o", "pid=,command="]),
    run("/usr/sbin/lsof", [
      "-nP",
      "-a",
      "-u",
      String(uid),
      "-iTCP",
      "-sTCP:LISTEN",
      "-Fpn",
    ]),
  ]);
  if (ps === null || environment === null || lsof === null) return null;
  const environments = parsePsEnvironment(environment);
  const table = new Map<number, ProcessEntry>();
  for (const entry of parsePsTable(ps, uid).values()) {
    const details = environments.get(entry.pid);
    table.set(entry.pid, {
      ...entry,
      threadId: details?.threadId ?? null,
      launcher: isLauncher(entry.name, details?.argv ?? []),
    });
  }
  return { table, sockets: parseLsofListeners(lsof) };
}

export async function readDarwinCwd(
  pid: number,
  run: RunTool,
): Promise<string | null> {
  const output = await run("/usr/sbin/lsof", [
    "-a",
    "-p",
    String(pid),
    "-d",
    "cwd",
    "-Fn",
  ]);
  const line = output?.split("\n").find((value) => value.startsWith("n"));
  return line === undefined ? null : line.slice(1);
}
