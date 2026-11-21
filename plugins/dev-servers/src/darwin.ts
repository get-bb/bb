import path from "node:path";
import {
  inheritHiddenEnvironment,
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
): Map<number, Omit<ProcessEntry, "threadId" | "toolCallId" | "launcher">> {
  const table = new Map<
    number,
    Omit<ProcessEntry, "threadId" | "toolCallId" | "launcher">
  >();
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
  toolCallId: string | null;
  argv: string[];
  hidden: boolean;
}

function parsePsCommands(output: string): Map<number, string> {
  const commands = new Map<number, string>();
  for (const line of output.split("\n")) {
    const match = /^\s*(\d+)\s(.*)$/.exec(line);
    if (match !== null) commands.set(Number(match[1]), match[2]!.trimEnd());
  }
  return commands;
}

export function parsePsEnvironment(
  plain: string,
  withEnvironment: string,
): Map<number, PsEnvironmentEntry> {
  const commands = parsePsCommands(plain);
  const entries = new Map<number, PsEnvironmentEntry>();
  for (const [pid, line] of parsePsCommands(withEnvironment)) {
    const command = commands.get(pid) ?? line;
    const environment = line.startsWith(command)
      ? line.slice(command.length)
      : "";
    const matches = [...environment.matchAll(/(?:^|\s)BB_THREAD_ID=(\S+)/g)];
    const toolCalls = [
      ...environment.matchAll(/(?:^|\s)CODEX_TOOL_CALL_ID=(\S+)/g),
    ];
    entries.set(pid, {
      threadId: matches.at(-1)?.[1] ?? null,
      toolCallId: toolCalls.at(-1)?.[1] ?? null,
      argv: command.trim().split(/\s+/).slice(0, 2),
      hidden: !/(?:^|\s)[A-Za-z_][A-Za-z0-9_]*=/.test(environment),
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
  const [ps, commands, environment, lsof] = await Promise.all([
    run("/bin/ps", ["-axo", "pid=,ppid=,uid=,comm="]),
    run("/bin/ps", ["-axww", "-o", "pid=,command="]),
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
  if (ps === null || commands === null || environment === null || lsof === null)
    return null;
  const environments = parsePsEnvironment(commands, environment);
  const table = new Map<number, ProcessEntry>();
  const hidden = new Set<number>();
  for (const entry of parsePsTable(ps, uid).values()) {
    const details = environments.get(entry.pid);
    table.set(entry.pid, {
      ...entry,
      threadId: details?.threadId ?? null,
      toolCallId: details?.toolCallId ?? null,
      launcher: isLauncher(entry.name, details?.argv ?? []),
    });
    if (details === undefined || details.hidden) hidden.add(entry.pid);
  }
  inheritHiddenEnvironment(table, hidden);
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
