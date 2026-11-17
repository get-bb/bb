import { execFile } from "node:child_process";
import { readdir, readFile, readlink, realpath, stat } from "node:fs/promises";
import path from "node:path";

function missing(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error.code === "ENOENT" || error.code === "ESRCH")
  );
}

async function canonicalPath(value: string): Promise<string> {
  try {
    return await realpath(value);
  } catch (error) {
    if (!missing(error)) throw error;
    const parent = path.dirname(value);
    if (parent === value) throw error;
    return path.join(await canonicalPath(parent), path.basename(value));
  }
}

function underWorkspace(value: string, workspace: string): boolean {
  const normalized = value.replace(/ \(deleted\)$/, "");
  return [value, normalized].some(
    (candidate) =>
      candidate === workspace || candidate.startsWith(workspace + path.sep),
  );
}

interface WorkspaceProcessInspection {
  supported: boolean;
  pids: number[];
  unreadablePids: number[];
}

function unsupported(): WorkspaceProcessInspection {
  return { supported: false, pids: [], unreadablePids: [] };
}

export async function inspectWorkspaceProcesses(
  workspacePath: string,
): Promise<WorkspaceProcessInspection> {
  if (process.getuid === undefined) return unsupported();
  if (process.platform === "linux")
    return inspectLinux(workspacePath, process.getuid());
  if (process.platform === "darwin")
    return inspectDarwin(workspacePath, process.getuid());
  return unsupported();
}

async function inspectLinux(
  workspacePath: string,
  uid: number,
): Promise<WorkspaceProcessInspection> {
  const workspace = await canonicalPath(path.resolve(workspacePath));
  const pids: number[] = [];
  const unreadablePids: number[] = [];
  for (const entry of await readdir("/proc")) {
    if (!/^\d+$/.test(entry)) continue;
    const pid = Number(entry);
    const directory = `/proc/${entry}`;
    try {
      const status = await readFile(`${directory}/status`, "utf8");
      const uids = status.match(/^Uid:\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)/m);
      if (uids === null) {
        unreadablePids.push(pid);
        continue;
      }
      if (!uids.slice(1).some((value) => Number(value) === uid)) continue;
      if (/^State:\s+[ZX]/m.test(status)) continue;
      const cwd = await readlink(`${directory}/cwd`);
      const maps = await readFile(`${directory}/maps`, "utf8");
      const mappedPaths = maps.split("\n").flatMap((line) => {
        const match = line.match(/^\S+\s+\S+\s+\S+\s+\S+\s+\S+\s+(\/.*)$/);
        return match === null ? [] : [match[1]!];
      });
      if (
        underWorkspace(cwd, workspace) ||
        mappedPaths.some((value) =>
          underWorkspace(value, workspace.replace(/\n/g, "\\012")),
        )
      )
        pids.push(pid);
    } catch (error) {
      if (missing(error)) {
        try {
          await stat(directory);
        } catch (gone) {
          if (missing(gone)) continue;
        }
      }
      unreadablePids.push(pid);
    }
  }
  return { supported: true, pids, unreadablePids };
}

const DARWIN_INSPECTION_TIMEOUT_MS = 30_000;

function runDarwinTool(
  command: string,
  args: string[],
): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      command,
      args,
      {
        encoding: "latin1",
        env: { ...process.env, LC_ALL: "C" },
        timeout: DARWIN_INSPECTION_TIMEOUT_MS,
        maxBuffer: 512 * 1024 * 1024,
      },
      (error, stdout) => {
        if (error === null) resolve(stdout);
        else if (error.code === 1 && !error.killed && error.signal === null)
          resolve(stdout);
        else resolve(null);
      },
    );
  });
}

interface DarwinProcess {
  pid: number;
  effectiveUid: number;
}

async function listDarwinProcesses(
  uid: number,
  pids?: number[],
): Promise<DarwinProcess[] | null> {
  const output = await runDarwinTool("/bin/ps", [
    ...(pids === undefined ? ["-ax"] : ["-p", pids.join(",")]),
    "-o",
    "pid=,uid=,ruid=,svuid=,stat=",
  ]);
  if (output === null) return null;
  return output.split("\n").flatMap((line) => {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\S+)/);
    if (match === null || match[5]!.startsWith("Z")) return [];
    const uids = [match[2], match[3], match[4]].map(Number);
    if (!uids.includes(uid)) return [];
    return [{ pid: Number(match[1]), effectiveUid: uids[0]! }];
  });
}

const LSOF_ESCAPES: Record<number, string> = {
  0x08: "\\b",
  0x09: "\\t",
  0x0a: "\\n",
  0x0c: "\\f",
  0x0d: "\\r",
  0x5c: "\\\\",
};

function lsofName(value: string): string {
  let name = "";
  for (const byte of Buffer.from(value, "utf8")) {
    const escaped = LSOF_ESCAPES[byte];
    if (escaped !== undefined) name += escaped;
    else if (byte < 0x20) name += `^${String.fromCharCode(byte + 0x40)}`;
    else if (byte < 0x7f) name += String.fromCharCode(byte);
    else name += `\\x${byte.toString(16).padStart(2, "0")}`;
  }
  return name;
}

async function inspectDarwin(
  workspacePath: string,
  uid: number,
): Promise<WorkspaceProcessInspection> {
  const workspace = lsofName(await canonicalPath(path.resolve(workspacePath)));
  const candidates = await listDarwinProcesses(uid);
  if (candidates === null) return unsupported();
  if (candidates.length === 0)
    return { supported: true, pids: [], unreadablePids: [] };
  const output = await runDarwinTool("/usr/sbin/lsof", [
    "-n",
    "-P",
    "-w",
    "-a",
    "-d",
    "cwd,txt",
    "-F",
    "pfn",
    "-p",
    candidates.map((candidate) => candidate.pid).join(","),
  ]);
  if (output === null) return unsupported();
  const inspected = new Set<number>();
  const pids = new Set<number>();
  let pid: number | null = null;
  let descriptor = "";
  for (const line of output.split("\n")) {
    const value = line.slice(1);
    if (line.startsWith("p")) pid = Number(value);
    else if (line.startsWith("f")) descriptor = value;
    else if (line.startsWith("n") && pid !== null) {
      if (descriptor === "cwd") inspected.add(pid);
      if (value === workspace || value.startsWith(workspace + path.sep))
        pids.add(pid);
    }
  }
  const uninspected = candidates
    .map((candidate) => candidate.pid)
    .filter((candidate) => !inspected.has(candidate));
  const remaining =
    uninspected.length === 0 ? [] : await listDarwinProcesses(uid, uninspected);
  const unreadablePids =
    remaining === null
      ? uninspected
      : remaining
          .filter((candidate) => candidate.effectiveUid === uid)
          .map((candidate) => candidate.pid);
  return {
    supported: true,
    pids: [...pids].sort((a, b) => a - b),
    unreadablePids: unreadablePids.sort((a, b) => a - b),
  };
}
