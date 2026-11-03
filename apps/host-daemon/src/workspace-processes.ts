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

export async function inspectWorkspaceProcesses(
  workspacePath: string,
): Promise<{
  supported: boolean;
  pids: number[];
  unreadablePids: number[];
}> {
  if (process.platform !== "linux" || process.getuid === undefined)
    return { supported: false, pids: [], unreadablePids: [] };
  const workspace = await canonicalPath(path.resolve(workspacePath));
  const uid = process.getuid();
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
