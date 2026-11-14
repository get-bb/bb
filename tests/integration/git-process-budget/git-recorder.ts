import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

export interface GitCall {
  cwd: string;
  args: string[];
}

export interface GitRecorder {
  realGit: string;
  shimDir: string;
  take(): Promise<GitCall[]>;
  settle(): Promise<GitCall[]>;
}

const QUIET_MS = 1_000;
const POLL_MS = 25;
const SETTLE_TIMEOUT_MS = 120_000;

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function installGitRecorder(root: string): Promise<GitRecorder> {
  const realGit = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
  const shimDir = path.join(root, "git-shim");
  const callsDir = path.join(root, "git-calls");
  await fs.mkdir(shimDir, { recursive: true });
  await fs.mkdir(callsDir, { recursive: true });
  await fs.writeFile(
    path.join(shimDir, "git"),
    [
      "#!/bin/sh",
      "set -C",
      "n=0",
      `until { printf '%s\\0' "$$"; pwd -P; printf '\\0'; printf '%s\\0' "$@"; } > ${shellQuote(callsDir)}/"$$.$n.tmp" 2>/dev/null; do n=$((n+1)); done`,
      `mv ${shellQuote(callsDir)}/"$$.$n.tmp" ${shellQuote(callsDir)}/"$$.$n"`,
      `exec ${shellQuote(realGit)} "$@"`,
      "",
    ].join("\n"),
    { mode: 0o755 },
  );

  const seen = new Set<string>();
  const pending: { pid: number; call: GitCall }[] = [];

  async function collect(): Promise<number> {
    let added = 0;
    for (const name of await fs.readdir(callsDir)) {
      if (name.endsWith(".tmp") || seen.has(name)) continue;
      seen.add(name);
      const [pid, cwd, ...args] = (
        await fs.readFile(path.join(callsDir, name), "utf8")
      )
        .slice(0, -1)
        .split("\0");
      pending.push({
        pid: Number(pid),
        call: { cwd: cwd!.replace(/\n$/u, ""), args },
      });
      added += 1;
    }
    return added;
  }

  async function startedButUnrecorded(): Promise<boolean> {
    return (await fs.readdir(callsDir)).some((name) => name.endsWith(".tmp"));
  }

  async function take(): Promise<GitCall[]> {
    await collect();
    return pending.splice(0).map((entry) => entry.call);
  }

  async function settle(): Promise<GitCall[]> {
    const deadline = Date.now() + SETTLE_TIMEOUT_MS;
    let quietSince = Date.now();
    for (;;) {
      if (Date.now() > deadline) {
        throw new Error("Git processes were still starting after 120 s");
      }
      const added = await collect();
      if (
        added > 0 ||
        pending.some((entry) => isRunning(entry.pid)) ||
        (await startedButUnrecorded())
      ) {
        quietSince = Date.now();
      } else if (Date.now() - quietSince >= QUIET_MS) {
        return take();
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
  }

  return { realGit, shimDir, take, settle };
}
