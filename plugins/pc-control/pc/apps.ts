import path from "node:path";
import type { CommandRunner, RawProcessEntry } from "./process-listing.js";
import {
  hostExecutableFormError,
  normalizeProcessName,
} from "./limits.js";

export interface ChildProcessLike {
  pid?: number | undefined;
  unref(): void;
}

export interface SpawnLike {
  (
    file: string,
    args: readonly string[],
    options: {
      cwd: string;
      stdio: "ignore";
      detached: boolean;
      windowsHide: boolean;
    },
  ): ChildProcessLike;
}

export interface StatLike {
  (target: string): Promise<{ isFile: boolean; isDirectory: boolean } | null>;
}

export interface AppsDeps {
  readonly run: CommandRunner;
  readonly spawn: SpawnLike;
  readonly stat: StatLike;
  readonly platform: NodeJS.Platform;
  readonly listRaw: () => Promise<readonly RawProcessEntry[]>;
  readonly delay: (ms: number) => Promise<void>;
  readonly now: () => number;
}

const STOP_GRACEFUL_TIMEOUT_MS = 5_000;
const STOP_POLL_INTERVAL_MS = 300;
const STOP_MAX_TOTAL_MS = 20_000;

export function expectedProcessIdentity(exePath: string): string {
  return normalizeProcessName(path.basename(exePath));
}

export function entryMatchesIdentity(
  entry: { name: string; exePath: string | null },
  processName: string,
  exePath: string,
): boolean {
  if (normalizeProcessName(entry.name) === normalizeProcessName(processName)) {
    return true;
  }
  if (entry.exePath !== null) {
    const normalize = (value: string): string =>
      path.win32.normalize(value).replace(/[\\/]/gu, "\\").toLowerCase();
    return normalize(entry.exePath) === normalize(exePath);
  }
  return false;
}

export async function startManagedApp(
  deps: AppsDeps,
  input: { exePath: string; args: readonly string[]; cwd: string },
): Promise<{ pid: number }> {
  const exeError = hostExecutableFormError(input.exePath, deps.platform);
  if (exeError !== null) throw new Error(exeError);
  const exeStat = await deps.stat(input.exePath);
  if (exeStat === null || !exeStat.isFile) {
    throw new Error(`Executable was not found: ${input.exePath}`);
  }
  const cwdStat = await deps.stat(input.cwd);
  if (cwdStat === null || !cwdStat.isDirectory) {
    throw new Error(`Working directory was not found: ${input.cwd}`);
  }
  const child = deps.spawn(input.exePath, input.args, {
    cwd: input.cwd,
    stdio: "ignore",
    detached: true,
    windowsHide: false,
  });
  child.unref();
  const pid = child.pid;
  if (pid === undefined) {
    throw new Error(`Failed to start ${path.basename(input.exePath)}.`);
  }
  return { pid };
}

async function pidAlive(
  deps: AppsDeps,
  pid: number,
  identityName: string,
  exePath: string,
): Promise<boolean> {
  const entries = await deps.listRaw();
  return entries.some(
    (entry) =>
      entry.pid === pid && entryMatchesIdentity(entry, identityName, exePath),
  );
}

export async function stopManagedProcesses(
  deps: AppsDeps,
  input: {
    pids: readonly number[];
    processName: string;
    exePath: string;
  },
): Promise<{ stoppedCount: number }> {
  const startedAt = deps.now();
  let stoppedCount = 0;
  for (const pid of input.pids) {
    if (!(await pidAlive(deps, pid, input.processName, input.exePath))) {
      continue;
    }
    await terminatePid(deps, pid, false);
    const graceful = await waitForExit(
      deps,
      pid,
      input.processName,
      input.exePath,
      STOP_GRACEFUL_TIMEOUT_MS,
      startedAt,
    );
    if (graceful) {
      stoppedCount += 1;
      continue;
    }
    await terminatePid(deps, pid, true);
    const forced = await waitForExit(
      deps,
      pid,
      input.processName,
      input.exePath,
      STOP_GRACEFUL_TIMEOUT_MS,
      startedAt,
    );
    if (forced) stoppedCount += 1;
  }
  return { stoppedCount };
}

async function terminatePid(
  deps: AppsDeps,
  pid: number,
  force: boolean,
): Promise<void> {
  if (deps.platform === "win32") {
    const args = ["/PID", String(pid), "/T"];
    if (force) args.push("/F");
    await deps.run("taskkill", args, { timeoutMs: 10_000 });
    return;
  }
  const signal = force ? "KILL" : "TERM";
  await deps.run("kill", [`-${signal}`, String(pid)], { timeoutMs: 10_000 });
}

async function waitForExit(
  deps: AppsDeps,
  pid: number,
  processName: string,
  exePath: string,
  timeoutMs: number,
  startedAt: number,
): Promise<boolean> {
  const deadline = Math.min(
    deps.now() + timeoutMs,
    startedAt + STOP_MAX_TOTAL_MS,
  );
  for (;;) {
    await deps.delay(STOP_POLL_INTERVAL_MS);
    if (!(await pidAlive(deps, pid, processName, exePath))) return true;
    if (deps.now() >= deadline) return false;
  }
}
