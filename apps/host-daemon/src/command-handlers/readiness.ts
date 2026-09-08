import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type {
  HostDaemonOnlineRpcCommand,
  HostDaemonOnlineRpcResult,
} from "@bb/host-daemon-contract";

const exec = promisify(execFile);
export async function inspectReadiness(
  path: string,
): Promise<HostDaemonOnlineRpcResult<"workspace.readiness.inspect">> {
  const git = async (...args: string[]) =>
    (
      await exec("git", ["-C", path, ...args], {
        maxBuffer: 8 * 1024 * 1024,
        timeout: 30000,
      })
    ).stdout;
  const directory = await realpath(path);
  const inside = await git("rev-parse", "--is-inside-work-tree").catch(
    (error: unknown) => {
      if (
        error instanceof Error &&
        error.message.includes("not a git repository")
      )
        return "false";
      throw error;
    },
  );
  if (inside.trim() !== "true") {
    const hook = join(directory, ".bb-env-setup.sh");
    const stat = await lstat(hook).catch((error: unknown) => {
      if (error instanceof Error && "code" in error && error.code === "ENOENT")
        return null;
      throw error;
    });
    if (stat && (!stat.isFile() || stat.size > 16 * 1024 * 1024))
      throw new Error("Unsupported readiness input file");
    return {
      kind: "directory" as const,
      path: directory,
      hookSha256: stat
        ? createHash("sha256")
            .update(await readFile(hook))
            .digest("hex")
        : null,
    };
  }
  const [tracked, dirty, commit] = await Promise.all([
    git("ls-files", "-z"),
    git("status", "--porcelain=v1", "-z", "--untracked-files=no"),
    git("rev-parse", "HEAD"),
  ]);
  const files = [];
  for (const name of tracked.split("\0").filter(Boolean)) {
    if (
      !/(^|\/)([^/]*lock[^/]*|go\.sum|package\.json|\.bb-env-setup\.sh|\.worktreeinclude|\.node-version|\.nvmrc)$/.test(
        name,
      )
    )
      continue;
    const file = join(path, name);
    const stat = await lstat(file).catch(() => null);
    if (!stat) continue;
    if (!stat.isFile() || stat.size > 16 * 1024 * 1024)
      throw new Error("Unsupported readiness input file");
    files.push({
      path: name,
      sha256: createHash("sha256")
        .update(await readFile(file))
        .digest("hex"),
    });
  }
  return {
    commit: commit.trim(),
    dirty: dirty.split("\0").filter(Boolean),
    files,
    abi: `${process.platform}/${process.arch}/node-${process.versions.modules}`,
  };
}
export async function probeReadiness(
  input: Extract<HostDaemonOnlineRpcCommand, { type: "host.readiness.probe" }>,
  serverUrl: string | undefined,
) {
  if (!serverUrl) return { reachable: false, status: null };
  try {
    const base = new URL(serverUrl);
    const url = new URL(input.serverPath, base);
    if (url.origin !== base.origin) return { reachable: false, status: null };
    const response = await fetch(url, {
      headers: input.headers,
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    });
    await response.body?.cancel();
    return { reachable: response.ok, status: response.status };
  } catch {
    return { reachable: false, status: null };
  }
}
