// Soak-suite-local helpers (plan §10 M7). The gated soak scenarios drive the
// exact production surfaces the fake suites use — public API launches, real
// lifecycle/sweep functions, the harness daemon's own run manager — and these
// helpers only add the soak-specific instrumentation: peak provider-process
// sampling, ingress round-trip timing, retention backdating, and git-level
// worktree observation. They live in soak/ (not ../helpers/) because the
// default `test` task must never pull them in.

import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { workflowRuns } from "@bb/db";
import { eq } from "drizzle-orm";
import type { IntegrationHarness } from "../helpers/harness.js";
import { runGit } from "../helpers/seed.js";

// The retention/prune sweeps are the archive scenario's drivers; re-exported
// here (the helpers/workflow-runs.ts pattern) so soak files reach apps/server
// modules through helpers only.
export {
  runWorkflowRunDirPruneSweep,
  runWorkflowRunRetentionSweep,
  WORKFLOW_RUN_ARCHIVE_AFTER_MS,
} from "../../../apps/server/src/services/workflows/workflow-run-retention.js";

const execFileAsync = promisify(execFile);

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const WAIT_UNTIL_POLL_INTERVAL_MS = 100;

/** Polls `read` until truthy or the timeout elapses (then throws). */
export async function waitUntil(
  read: () => Promise<boolean> | boolean,
  describeFailure: () => string,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await read()) {
      return;
    }
    if (Date.now() > deadline) {
      throw new Error(describeFailure());
    }
    await sleep(WAIT_UNTIL_POLL_INTERVAL_MS);
  }
}

export interface BuildFanOutWorkflowSourceArgs {
  agentCount: number;
  delayMs: number;
  name: string;
  worktree: boolean;
}

/**
 * One phase fanning out `agentCount` parallel agents against the fake
 * provider (the `delay:<ms>` prompt prefix controls turn duration).
 * `worktree: true` makes every agent provision a real git worktree — the
 * daemon-token-gated resource the multi-run soak saturates. Returns the
 * count of non-null settlements so a silently degraded agent is visible in
 * the run result.
 */
export function buildFanOutWorkflowSource(
  args: BuildFanOutWorkflowSourceArgs,
): string {
  const agentOptions = args.worktree ? ", { worktree: true }" : "";
  return [
    `export const meta = { name: ${JSON.stringify(args.name)}, description: "M7 soak fixture workflow" };`,
    "",
    'phase("fan-out");',
    "const results = await parallel(",
    `  Array.from({ length: ${args.agentCount} }, (_, index) => () =>`,
    `    agent("delay:${args.delayMs} soak item " + (index + 1)${agentOptions}),`,
    "  ),",
    ");",
    "return { settled: results.filter((result) => result !== null).length };",
    "",
  ].join("\n");
}

const PROVIDER_PROCESS_SAMPLE_INTERVAL_MS = 50;

export interface ProviderProcessSampler {
  /** Stops sampling and resolves the peak observed Σ live provider processes. */
  stop(): Promise<number>;
}

/**
 * Polls the daemon run manager's Σ live-provider-process accessor
 * (`countLiveProviderProcesses`, observability-only per the recorded M2
 * divergence) so the soak can assert the PEAK against the worktree token cap
 * plus the shared-process allowance. Reads `harness.daemonApp` through the
 * harness on every sample so daemon restarts stay observable.
 */
export function startProviderProcessSampler(
  harness: IntegrationHarness,
): ProviderProcessSampler {
  let stopped = false;
  let peak = 0;
  const loop = (async () => {
    while (!stopped) {
      peak = Math.max(
        peak,
        harness.daemonApp.workflowRunManager.countLiveProviderProcesses(),
      );
      await sleep(PROVIDER_PROCESS_SAMPLE_INTERVAL_MS);
    }
  })();
  return {
    async stop(): Promise<number> {
      stopped = true;
      await loop;
      return peak;
    },
  };
}

const OS_PROVIDER_PID_SAMPLE_INTERVAL_MS = 250;
const FAKE_PROVIDER_SCRIPT_MARKER = "fake-provider-script";

/**
 * OS-level fake-provider child pids of THIS test process: `ps` rows whose
 * ppid is the test process (the harness daemon runs in-process, so provider
 * children are direct children of it) and whose argv names the fake provider
 * script. The ppid match makes cross-contamination from concurrent test runs
 * structurally impossible.
 */
export async function listOsFakeProviderPids(): Promise<number[]> {
  const { stdout } = await execFileAsync("ps", [
    "-axo",
    "pid=,ppid=,command=",
  ]);
  const pids: number[] = [];
  for (const line of stdout.split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    if (!match) continue;
    const [, pidText, ppidText, command] = match;
    if (
      Number(ppidText) === process.pid &&
      command !== undefined &&
      command.includes(FAKE_PROVIDER_SCRIPT_MARKER)
    ) {
      pids.push(Number(pidText));
    }
  }
  return pids;
}

export interface OsProviderPidSampler {
  /** Stops sampling; resolves every distinct pid observed and the peak
   *  concurrent count. */
  stop(): Promise<{ observedPids: Set<number>; peakConcurrent: number }>;
}

/**
 * The OS-grounded companion to {@link startProviderProcessSampler}: samples
 * `ps` for live fake-provider child processes so the soak's resource
 * assertions are not self-referential (the in-process Σ accessor reads the
 * daemon's own runtime-entries map — a disposal bug that drops an entry while
 * its child survives would corrupt exactly that accounting). Mirrors the
 * orphan soak's recorded-pid + signal-0 treatment for runner pids.
 */
export function startOsProviderPidSampler(): OsProviderPidSampler {
  let stopped = false;
  const observedPids = new Set<number>();
  let peakConcurrent = 0;
  const loop = (async () => {
    while (!stopped) {
      const pids = await listOsFakeProviderPids();
      peakConcurrent = Math.max(peakConcurrent, pids.length);
      for (const pid of pids) {
        observedPids.add(pid);
      }
      await sleep(OS_PROVIDER_PID_SAMPLE_INTERVAL_MS);
    }
  })();
  return {
    async stop() {
      stopped = true;
      await loop;
      return { observedPids, peakConcurrent };
    },
  };
}

const WORKFLOW_RUN_EVENTS_INGRESS_PATH = "/internal/session/workflow-run-events";

function requestPathname(input: RequestInfo | URL): string {
  if (typeof input === "string") {
    return new URL(input).pathname;
  }
  if (input instanceof URL) {
    return input.pathname;
  }
  return new URL(input.url).pathname;
}

export interface IngressTimingFetch {
  /** One entry per `POST /internal/session/workflow-run-events` round trip. */
  durationsMs: number[];
  fetchFn: typeof fetch;
}

/**
 * Wraps the daemon's server transport (the `CreateHarnessOptions.daemonFetchFn`
 * seam) to time every workflow run-event ingestion batch round trip. This is
 * the only end-to-end ingress latency that is measurable at all: the wire
 * envelope carries no daemon-side timestamp and spool rows are deleted on
 * settle, so server-side `createdAt` cannot reconstruct it (recorded in the
 * convergence memo §8).
 */
export function createIngressTimingFetch(): IngressTimingFetch {
  const durationsMs: number[] = [];
  const fetchFn: typeof fetch = async (input, init) => {
    if (requestPathname(input) !== WORKFLOW_RUN_EVENTS_INGRESS_PATH) {
      return fetch(input, init);
    }
    const startedAt = performance.now();
    const response = await fetch(input, init);
    durationsMs.push(performance.now() - startedAt);
    return response;
  };
  return { durationsMs, fetchFn };
}

/** Nearest-rank percentile (`p` in (0, 100]) over an unsorted sample. */
export function percentile(samples: readonly number[], p: number): number {
  if (samples.length === 0) {
    throw new Error("Cannot take a percentile of an empty sample");
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  const value = sorted[rank - 1];
  if (value === undefined) {
    throw new Error(`Percentile rank ${rank} out of range`);
  }
  return value;
}

export interface BackdateWorkflowRunArgs {
  runId: string;
  settledAt?: number;
  updatedAt: number;
}

/**
 * Ages a run into the retention window (the unit suite's backdate lever):
 * `listArchivableWorkflowRuns` keys terminal runs on `settledAt` and
 * abandoned interrupted runs on `updatedAt`.
 */
export function backdateWorkflowRun(
  harness: IntegrationHarness,
  args: BackdateWorkflowRunArgs,
): void {
  harness.db
    .update(workflowRuns)
    .set({
      updatedAt: args.updatedAt,
      ...(args.settledAt !== undefined ? { settledAt: args.settledAt } : {}),
    })
    .where(eq(workflowRuns.id, args.runId))
    .run();
}

/** Worktree checkout paths registered on the repo (`git worktree list`). */
export async function listGitWorktreePaths(repoDir: string): Promise<string[]> {
  const output = await runGit({
    cwd: repoDir,
    args: ["worktree", "list", "--porcelain"],
  });
  return output
    .split("\n")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length).trim());
}

/** `wf/<runId>-<index>` branches on the repo (preserved or leaked). */
export async function listWorkflowWorktreeBranches(
  repoDir: string,
): Promise<string[]> {
  const output = await runGit({
    cwd: repoDir,
    args: ["branch", "--list", "wf/*", "--format=%(refname:short)"],
  });
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** `<daemonData>/workflow-runs/<runId>` — the daemon-owned run dir. */
export function workflowRunDirPathFor(
  harness: IntegrationHarness,
  runId: string,
): string {
  return path.join(harness.daemonDataDir, "workflow-runs", runId);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error;
}

export async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.stat(targetPath);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

const RUNNER_PID_FILE_NAME = "runner.pid";
const HEARTBEAT_FILE_NAME = ".heartbeat";

/**
 * The recorded runner pid for a run dir, or null when the record is absent
 * (cleared at settle/crash teardown). Extracted from the raw record so the
 * orphan soak can assert the process itself is dead.
 */
export async function readRecordedRunnerPid(
  harness: IntegrationHarness,
  runId: string,
): Promise<number | null> {
  const pidPath = path.join(
    workflowRunDirPathFor(harness, runId),
    RUNNER_PID_FILE_NAME,
  );
  let raw: string;
  try {
    raw = await fs.readFile(pidPath, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
  const match = /"pid"\s*:\s*(\d+)/.exec(raw);
  if (!match?.[1]) {
    throw new Error(`Unreadable runner pid record for run ${runId}: ${raw}`);
  }
  return Number(match[1]);
}

/** Whether the run dir still holds a runner heartbeat file. */
export async function hasRunnerHeartbeat(
  harness: IntegrationHarness,
  runId: string,
): Promise<boolean> {
  return pathExists(
    path.join(workflowRunDirPathFor(harness, runId), HEARTBEAT_FILE_NAME),
  );
}

/** Signal-0 liveness probe for pids the soak recorded earlier. */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
