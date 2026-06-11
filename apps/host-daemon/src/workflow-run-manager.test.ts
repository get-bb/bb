// Offline tests for the workflow run manager: a REAL runner child process
// (tsx source spawn, full ndjson JSON-RPC protocol, vm sandbox, heartbeat)
// driven against a FakeWorker-backed stub in place of the provider-bound
// WorkflowAgentExecutor — no provider session is ever started.

import { spawn, type ChildProcess } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { afterEach, describe, expect, it } from "vitest";
import {
  AgentInterrupted,
  FakeWorker,
  workflowJournalEntrySchema,
  type AgentResult,
  type AgentSpec,
  type WorkerContext,
  type WorkflowJournalEntry,
} from "@bb/workflow-runtime";
import type { HostDaemonLogger } from "./logger.js";
import {
  isProcessAlive,
  readWorkflowRunnerPidFile,
  readWorkflowRunTerminalRecord,
  workflowRunDirPath,
  workflowRunHeartbeatPath,
  workflowRunJournalPath,
  writeWorkflowRunnerPidFile,
  writeWorkflowRunTerminalRecord,
} from "./workflow-run-dir.js";
import {
  MAX_RUNNER_STDOUT_LINE_LENGTH,
  WorkflowProviderProcessSemaphore,
  WorkflowRunManager,
  type StartWorkflowRunArgs,
  type WorkflowRunManagerRunEvent,
  type WorkflowRunWorker,
} from "./workflow-run-manager.js";

const TWO_PHASE_WORKFLOW = `export const meta = { name: "two-phase", description: "test workflow" };
phase("research");
const findings = await parallel([
  () => agent("research topic A"),
  () => agent("research topic B"),
]);
phase("write");
const summary = await agent("summarize: " + findings.join(" | "));
return { summary };
`;

const SLOW_WORKFLOW = `export const meta = { name: "slow", description: "test workflow" };
await agent("slow task");
return "done";
`;

/** Starves the runner's event loop with microtasks: the abort line, the
 *  heartbeat interval, and SIGTERM dispatch never run. */
const WEDGED_WORKFLOW = `export const meta = { name: "wedged", description: "test workflow" };
while (true) { await Promise.resolve(); }
`;

const HANGING_WORKFLOW = `export const meta = { name: "hang", description: "test workflow" };
await new Promise(() => {});
return "unreachable";
`;

const silentLogger: HostDaemonLogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

interface RecordedAgentContext {
  agentIndex: number;
  attempt: number;
}

class RecordingWorker implements WorkflowRunWorker {
  readonly specs: AgentSpec[] = [];
  readonly contexts: RecordedAgentContext[] = [];
  shutdownCalls = 0;
  private readonly fake: FakeWorker;

  constructor(options: { delayMs?: number } = {}) {
    this.fake = new FakeWorker(
      options.delayMs !== undefined ? { delayMs: options.delayMs } : {},
    );
  }

  runAgent(spec: AgentSpec, context: WorkerContext): Promise<AgentResult> {
    this.specs.push(spec);
    this.contexts.push({
      agentIndex: context.agentIndex,
      attempt: context.attempt,
    });
    return this.fake.runAgent(spec, context);
  }

  async shutdown(): Promise<void> {
    this.shutdownCalls += 1;
  }

  countRunningProviderProcesses(): number {
    return 0;
  }
}

interface Harness {
  manager: WorkflowRunManager;
  dataDir: string;
  workDir: string;
  events: WorkflowRunManagerRunEvent[];
  workers: RecordingWorker[];
  waitForRunEvent: (
    predicate: (event: WorkflowRunManagerRunEvent) => boolean,
  ) => Promise<WorkflowRunManagerRunEvent>;
}

const harnesses: Harness[] = [];
const sleepers: ChildProcess[] = [];

async function createHarness(
  options: { workerDelayMs?: number; cancelEscalationGraceMs?: number } = {},
): Promise<Harness> {
  const dataDir = await mkdtemp(join(tmpdir(), "bb-wf-manager-"));
  const workDir = join(dataDir, "work");
  await mkdir(workDir, { recursive: true });

  const events: WorkflowRunManagerRunEvent[] = [];
  const waiters: Array<{
    predicate: (event: WorkflowRunManagerRunEvent) => boolean;
    resolve: (event: WorkflowRunManagerRunEvent) => void;
  }> = [];
  const workers: RecordingWorker[] = [];

  const manager = new WorkflowRunManager({
    dataDir,
    logger: silentLogger,
    workflowAgentShellEnv: { PATH: "/usr/bin:/bin" },
    onRunEvent: (event) => {
      events.push(event);
      for (let i = waiters.length - 1; i >= 0; i--) {
        const waiter = waiters[i]!;
        if (waiter.predicate(event)) {
          waiters.splice(i, 1);
          waiter.resolve(event);
        }
      }
    },
    maxLiveProviderProcesses: 4,
    worktreeSetupTimeoutMs: 60_000,
    turnStallTimeoutMs: 60_000,
    cancelEscalationGraceMs: options.cancelEscalationGraceMs ?? 10_000,
    createWorker: () => {
      const worker = new RecordingWorker(
        options.workerDelayMs !== undefined
          ? { delayMs: options.workerDelayMs }
          : {},
      );
      workers.push(worker);
      return worker;
    },
  });

  const harness: Harness = {
    manager,
    dataDir,
    workDir,
    events,
    workers,
    waitForRunEvent: (predicate) => {
      const existing = events.find(predicate);
      if (existing) return Promise.resolve(existing);
      return new Promise((resolve) => waiters.push({ predicate, resolve }));
    },
  };
  harnesses.push(harness);
  return harness;
}

function buildStartArgs(
  harness: Harness,
  overrides: Partial<StartWorkflowRunArgs> = {},
): StartWorkflowRunArgs {
  return {
    runId: "wfr_manager_test",
    projectId: "proj_test",
    source: TWO_PHASE_WORKFLOW,
    filename: "test.workflow.js",
    args: undefined,
    seed: 7,
    baseTimeMs: 1_700_000_000_000,
    defaults: {
      provider: "codex",
      effort: "medium",
      sandbox: "read-only",
      cwd: harness.workDir,
      concurrency: 2,
      maxAgents: 20,
      maxFanout: 8,
      budgetOutputTokens: null,
    },
    sandboxCeiling: "workspace-write",
    journal: [],
    execTimeoutMs: null,
    ...overrides,
  };
}

async function waitFor(
  predicate: () => Promise<boolean> | boolean,
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await sleep(50);
  }
  throw new Error("condition not met in time");
}

function spawnSleeper(): ChildProcess {
  const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 600000)"], {
    stdio: "ignore",
  });
  sleepers.push(child);
  return child;
}

afterEach(async () => {
  for (const sleeper of sleepers.splice(0)) {
    if (sleeper.exitCode === null) sleeper.kill("SIGKILL");
  }
  for (const harness of harnesses.splice(0)) {
    await harness.manager.shutdown();
    await rm(harness.dataDir, { recursive: true, force: true });
  }
});

describe("WorkflowRunManager", () => {
  it(
    "runs a two-phase workflow through the real runner child",
    async () => {
      const harness = await createHarness();
      const args = buildStartArgs(harness);
      const result = await harness.manager.startRun(args);
      expect(result).toEqual({ accepted: true });

      const terminal = await harness.waitForRunEvent(
        (e) => e.event.type === "run/completed",
      );
      if (terminal.event.type !== "run/completed") throw new Error("unreachable");
      expect(terminal.runId).toBe(args.runId);
      expect(terminal.event.result).toMatchObject({
        summary: expect.stringContaining("[fake:codex]"),
      });

      const types = harness.events.map((e) => e.event.type);
      expect(types).toContain("run/started");
      expect(types.filter((t) => t === "phase/started")).toHaveLength(2);
      expect(types.filter((t) => t === "agent/completed")).toHaveLength(3);
      expect(harness.workers).toHaveLength(1);
      expect(harness.workers[0]!.specs).toHaveLength(3);

      // The pid file clears only after exit cleanup ends (and flushes) the
      // journal write stream, so waiting on it first makes the journal read
      // deterministic — `run/completed` arrives over stdio while the runner
      // is still alive, racing the hot-cache append otherwise.
      const runDir = workflowRunDirPath(harness.dataDir, args.runId);
      await waitFor(async () => (await readWorkflowRunnerPidFile(runDir)) === null);

      // Journal hot cache: one parseable entry per settled agent.
      const journalLines = (
        await readFile(workflowRunJournalPath(runDir), "utf8")
      )
        .split("\n")
        .filter((line) => line.length > 0);
      expect(journalLines).toHaveLength(3);
      for (const line of journalLines) {
        const entry = workflowJournalEntrySchema.parse(JSON.parse(line));
        expect(entry.status).toBe("completed");
      }

      // Full cleanup after settle: heartbeat gone, nothing reported active,
      // executor disposed, no provider processes.
      await waitFor(async () =>
        (await harness.manager.listActiveWorkflowRunIds()).length === 0,
      );
      expect(harness.manager.countLiveProviderProcesses()).toBe(0);
      expect(harness.workers[0]!.shutdownCalls).toBe(1);
    },
    30_000,
  );

  it(
    "is idempotent per runId while the run is active",
    async () => {
      const harness = await createHarness({ workerDelayMs: 60_000 });
      const args = buildStartArgs(harness, { source: SLOW_WORKFLOW });
      expect(await harness.manager.startRun(args)).toEqual({ accepted: true });
      expect(await harness.manager.startRun(args)).toEqual({ accepted: true });
      expect(harness.workers).toHaveLength(1);

      expect(harness.manager.cancelRun(args.runId)).toBe(true);
      await harness.waitForRunEvent((e) => e.event.type === "run/cancelled");
    },
    30_000,
  );

  it(
    "refuses to prune a live run's dir and prunes it after settle (idempotent)",
    async () => {
      const harness = await createHarness({ workerDelayMs: 60_000 });
      const args = buildStartArgs(harness, {
        runId: "wfr_prune_live",
        source: SLOW_WORKFLOW,
      });
      expect(await harness.manager.startRun(args)).toEqual({ accepted: true });
      const runDir = workflowRunDirPath(harness.dataDir, args.runId);

      // Live handle: the prune is refused and nothing is deleted.
      expect(await harness.manager.pruneRunDir(args.runId)).toEqual({
        pruned: false,
      });
      expect((await stat(runDir)).isDirectory()).toBe(true);

      harness.manager.cancelRun(args.runId);
      await harness.waitForRunEvent((e) => e.event.type === "run/cancelled");
      // Exit cleanup done (pid record cleared) — the dir is now prunable.
      await waitFor(
        async () => (await readWorkflowRunnerPidFile(runDir)) === null,
      );

      expect(await harness.manager.pruneRunDir(args.runId)).toEqual({
        pruned: true,
      });
      await expect(stat(runDir)).rejects.toMatchObject({ code: "ENOENT" });
      // Idempotent: pruning a missing run dir still reports pruned.
      expect(await harness.manager.pruneRunDir(args.runId)).toEqual({
        pruned: true,
      });
    },
    30_000,
  );

  it("refuses to prune a run id that does not resolve to a direct child of the runs root", async () => {
    // Defense in depth ahead of the recursive rm: the contract validates the
    // wfr_ id shape, but the daemon must independently never let a
    // path-segment id escape the workflow-runs root (".." would resolve up
    // to the whole daemon data dir).
    const harness = await createHarness();
    const markerPath = join(harness.dataDir, "outside-marker.txt");
    await writeFile(markerPath, "must survive");

    for (const hostileId of ["..", "../..", "wfr_x/../..", "."]) {
      await expect(harness.manager.pruneRunDir(hostileId)).rejects.toThrow(
        /non-child run id/,
      );
    }
    // Nothing outside the runs root was touched.
    expect((await stat(markerPath)).isFile()).toBe(true);
    expect((await stat(harness.dataDir)).isDirectory()).toBe(true);
  });

  it("refuses to prune while a handle-less runner's heartbeat is fresh", async () => {
    // A runner that survived a daemon restart has no handle in the runs map
    // but keeps its heartbeat fresh — pruning it would corrupt a live run.
    const harness = await createHarness();
    const runId = "wfr_prune_orphan";
    const runDir = workflowRunDirPath(harness.dataDir, runId);
    await mkdir(runDir, { recursive: true });
    await writeFile(workflowRunHeartbeatPath(runDir), "beat");

    expect(await harness.manager.pruneRunDir(runId)).toEqual({
      pruned: false,
    });
    expect((await stat(runDir)).isDirectory()).toBe(true);

    // Stale heartbeat = demonstrably dead segment: prunable.
    const stale = new Date(Date.now() - 120_000);
    await utimes(workflowRunHeartbeatPath(runDir), stale, stale);
    expect(await harness.manager.pruneRunDir(runId)).toEqual({ pruned: true });
    await expect(stat(runDir)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it(
    "deduplicates OVERLAPPING startRun calls for one runId onto one child",
    async () => {
      // The M3 durable-command redelivery race: a re-request lands while the
      // first spawn is still awaiting its start ack. Both must share one
      // runner child — a second spawn would shadow the first in the runs map.
      const harness = await createHarness({ workerDelayMs: 60_000 });
      const args = buildStartArgs(harness, { source: SLOW_WORKFLOW });
      const [first, second] = await Promise.all([
        harness.manager.startRun(args),
        harness.manager.startRun(args),
      ]);
      expect(first).toEqual({ accepted: true });
      expect(second).toEqual({ accepted: true });
      expect(harness.workers).toHaveLength(1);

      expect(harness.manager.cancelRun(args.runId)).toBe(true);
      await harness.waitForRunEvent((e) => e.event.type === "run/cancelled");
    },
    30_000,
  );

  it(
    "rejects an invalid script as script_invalid and cleans up",
    async () => {
      const harness = await createHarness();
      const args = buildStartArgs(harness, { source: "const nope = 1;\n" });
      const result = await harness.manager.startRun(args);
      expect(result).toMatchObject({ accepted: false, code: "script_invalid" });
      // Pre-side-effect rejection: no events, nothing active, worker disposed.
      expect(harness.events).toHaveLength(0);
      expect(await harness.manager.listActiveWorkflowRunIds()).toEqual([]);
      expect(harness.workers[0]!.shutdownCalls).toBe(1);
    },
    30_000,
  );

  it(
    "cancelRun interrupts in-flight agents and the run settles as cancelled",
    async () => {
      const harness = await createHarness({ workerDelayMs: 60_000 });
      const args = buildStartArgs(harness, { source: SLOW_WORKFLOW });
      await harness.manager.startRun(args);
      await harness.waitForRunEvent((e) => e.event.type === "agent/started");

      expect(harness.manager.cancelRun(args.runId)).toBe(true);
      const terminal = await harness.waitForRunEvent(
        (e) => e.event.type === "run/cancelled",
      );
      expect(terminal.runId).toBe(args.runId);
      // The journaled interruption still surfaced as agent/failed first.
      expect(
        harness.events.some((e) => e.event.type === "agent/failed"),
      ).toBe(true);
      await waitFor(async () =>
        (await harness.manager.listActiveWorkflowRunIds()).length === 0,
      );

      expect(harness.manager.cancelRun("wfr_unknown")).toBe(false);
    },
    30_000,
  );

  it(
    "cancelRun escalates to termination when the runner ignores abort",
    async () => {
      // A microtask-starved vm body never reads the abort line, never beats
      // its heartbeat again, and never handles SIGTERM — only the cancel
      // escalation (and its SIGKILL ladder) can settle the run.
      const harness = await createHarness({ cancelEscalationGraceMs: 750 });
      const args = buildStartArgs(harness, {
        runId: "wfr_wedged",
        source: WEDGED_WORKFLOW,
      });
      expect(await harness.manager.startRun(args)).toEqual({ accepted: true });
      await harness.waitForRunEvent((e) => e.event.type === "run/started");

      expect(harness.manager.cancelRun(args.runId)).toBe(true);
      const terminal = await harness.waitForRunEvent(
        (e) => e.event.type === "run/failed",
      );
      if (terminal.event.type !== "run/failed") throw new Error("unreachable");
      expect(terminal.event.error).toMatch(/^runner_exited:/);

      // Full convergence: nothing active, the handle is released.
      await waitFor(async () =>
        (await harness.manager.listActiveWorkflowRunIds()).length === 0,
      );
      expect(harness.workers[0]!.shutdownCalls).toBe(1);
    },
    30_000,
  );

  it(
    "a run exceeding execTimeoutMs settles as run/failed",
    async () => {
      const harness = await createHarness();
      const args = buildStartArgs(harness, {
        runId: "wfr_timeout",
        source: HANGING_WORKFLOW,
        execTimeoutMs: 700,
      });
      expect(await harness.manager.startRun(args)).toEqual({ accepted: true });

      const terminal = await harness.waitForRunEvent(
        (e) => e.event.type === "run/failed",
      );
      if (terminal.event.type !== "run/failed") throw new Error("unreachable");
      expect(terminal.event.error).toContain("workflow exceeded 700ms");
      await waitFor(async () =>
        (await harness.manager.listActiveWorkflowRunIds()).length === 0,
      );
    },
    30_000,
  );

  it(
    "an oversized runner stdout line fails the run instead of buffering it",
    async () => {
      // `console` is exposed in the sandbox, so untrusted workflow JS can
      // write arbitrary bytes to the protocol stream; the daemon's bounded
      // line reader must fail the run rather than buffer a giant line.
      const harness = await createHarness();
      const overflowWorkflow = `export const meta = { name: "overflow", description: "test workflow" };
console.log("x".repeat(${MAX_RUNNER_STDOUT_LINE_LENGTH + 1_024}));
await new Promise(() => {});
`;
      const args = buildStartArgs(harness, {
        runId: "wfr_overflow",
        source: overflowWorkflow,
      });
      expect(await harness.manager.startRun(args)).toEqual({ accepted: true });

      const terminal = await harness.waitForRunEvent(
        (e) => e.event.type === "run/failed",
      );
      if (terminal.event.type !== "run/failed") throw new Error("unreachable");
      expect(terminal.event.error).toMatch(/^runner_output_overflow:/);
      await waitFor(async () =>
        (await harness.manager.listActiveWorkflowRunIds()).length === 0,
      );
    },
    30_000,
  );

  it(
    "a SIGKILLed runner surfaces a synthetic runner_exited run/failed",
    async () => {
      const harness = await createHarness({ workerDelayMs: 60_000 });
      const args = buildStartArgs(harness, { source: SLOW_WORKFLOW });
      await harness.manager.startRun(args);
      await harness.waitForRunEvent((e) => e.event.type === "agent/started");

      const runDir = workflowRunDirPath(harness.dataDir, args.runId);
      const pid = await readWorkflowRunnerPidFile(runDir);
      expect(pid).not.toBeNull();
      process.kill(pid!, "SIGKILL");

      const terminal = await harness.waitForRunEvent(
        (e) => e.event.type === "run/failed",
      );
      if (terminal.event.type !== "run/failed") throw new Error("unreachable");
      expect(terminal.event.error).toMatch(/^runner_exited:/);

      // Cleanup leaves nothing active: pid file cleared and the residual
      // heartbeat removed so the dead run is not reported alive.
      await waitFor(async () => (await readWorkflowRunnerPidFile(runDir)) === null);
      expect(await harness.manager.listActiveWorkflowRunIds()).toEqual([]);
      expect(harness.workers[0]!.shutdownCalls).toBe(1);
    },
    30_000,
  );

  it(
    "replays a preloaded journal without re-running the worker",
    async () => {
      const harness = await createHarness();
      const firstArgs = buildStartArgs(harness, { runId: "wfr_first" });
      await harness.manager.startRun(firstArgs);
      const firstTerminal = await harness.waitForRunEvent(
        (e) => e.event.type === "run/completed" && e.runId === "wfr_first",
      );
      if (firstTerminal.event.type !== "run/completed") {
        throw new Error("unreachable");
      }

      const journal: WorkflowJournalEntry[] = harness.events
        .filter(
          (e): e is WorkflowRunManagerRunEvent =>
            e.runId === "wfr_first" && e.event.type === "agent/completed",
        )
        .map((e) =>
          e.event.type === "agent/completed"
            ? e.event.entry
            : (() => {
                throw new Error("unreachable");
              })(),
        );
      expect(journal).toHaveLength(3);

      const resumeArgs = buildStartArgs(harness, {
        runId: "wfr_resumed",
        journal,
      });
      await harness.manager.startRun(resumeArgs);
      const resumedTerminal = await harness.waitForRunEvent(
        (e) => e.event.type === "run/completed" && e.runId === "wfr_resumed",
      );
      if (resumedTerminal.event.type !== "run/completed") {
        throw new Error("unreachable");
      }
      expect(resumedTerminal.event.result).toEqual(firstTerminal.event.result);

      const resumedCompletions = harness.events.filter(
        (e) => e.runId === "wfr_resumed" && e.event.type === "agent/completed",
      );
      expect(resumedCompletions).toHaveLength(3);
      for (const completion of resumedCompletions) {
        if (completion.event.type !== "agent/completed") {
          throw new Error("unreachable");
        }
        expect(completion.event.cached).toBe(true);
      }
      // The replayed run never touched its worker.
      expect(harness.workers).toHaveLength(2);
      expect(harness.workers[1]!.specs).toHaveLength(0);

      // PARTIAL journal resume: drop one mid-run entry and resume again. The
      // re-run agent allocates a display index past the journaled maximum,
      // and that exact index crosses the agent/run wire to the worker — the
      // correlation the per-agent drill-in (logs keyed by agentIndex) relies
      // on after a resume.
      const journaledMax = Math.max(...journal.map((entry) => entry.agentIndex));
      const partialJournal = journal.filter(
        (entry) =>
          !entry.resultText.startsWith("[fake:codex] research topic B"),
      );
      expect(partialJournal).toHaveLength(2);
      await harness.manager.startRun(
        buildStartArgs(harness, {
          runId: "wfr_partial",
          journal: partialJournal,
        }),
      );
      await harness.waitForRunEvent(
        (e) => e.event.type === "run/completed" && e.runId === "wfr_partial",
      );
      const rerun = harness.events.filter(
        (e) =>
          e.runId === "wfr_partial" &&
          e.event.type === "agent/completed" &&
          !e.event.cached,
      );
      expect(rerun).toHaveLength(1);
      const rerunEvent = rerun[0]!.event;
      if (rerunEvent.type !== "agent/completed") throw new Error("unreachable");
      const partialWorker = harness.workers[2]!;
      expect(partialWorker.contexts).toHaveLength(1);
      expect(partialWorker.contexts[0]).toEqual({
        agentIndex: rerunEvent.agentIndex,
        attempt: 0,
      });
      expect(rerunEvent.agentIndex).toBeGreaterThan(journaledMax);
    },
    30_000,
  );

  it(
    "shutdown terminates runner children and disposes their workers",
    async () => {
      const harness = await createHarness({ workerDelayMs: 60_000 });
      const args = buildStartArgs(harness, { source: SLOW_WORKFLOW });
      await harness.manager.startRun(args);
      await harness.waitForRunEvent((e) => e.event.type === "agent/started");
      const runDir = workflowRunDirPath(harness.dataDir, args.runId);
      const pid = await readWorkflowRunnerPidFile(runDir);
      expect(pid).not.toBeNull();

      await harness.manager.shutdown();

      await waitFor(() => !isProcessAlive(pid!));
      expect(harness.workers[0]!.shutdownCalls).toBe(1);
      expect(await harness.manager.listActiveWorkflowRunIds()).toEqual([]);
      await expect(
        harness.manager.startRun(buildStartArgs(harness, { runId: "wfr_late" })),
      ).rejects.toThrow(/shut down/);
    },
    30_000,
  );

  it(
    "boot reap kills stale runners, clears dead records, keeps fresh ones, and spools NO synthetic settle",
    async () => {
      const harness = await createHarness();

      // Stale heartbeat + live process: a hung runner from a dead daemon.
      const hungDir = workflowRunDirPath(harness.dataDir, "wfr_hung");
      await mkdir(hungDir, { recursive: true });
      const hung = spawnSleeper();
      await writeWorkflowRunnerPidFile(hungDir, hung.pid!);
      await writeFile(workflowRunHeartbeatPath(hungDir), String(Date.now()));
      const past = new Date(Date.now() - 60_000);
      await utimes(workflowRunHeartbeatPath(hungDir), past, past);

      // Stale heartbeat + dead pid: leftover records only.
      const deadDir = workflowRunDirPath(harness.dataDir, "wfr_dead");
      await mkdir(deadDir, { recursive: true });
      await writeWorkflowRunnerPidFile(deadDir, 2 ** 30);
      await writeFile(workflowRunHeartbeatPath(deadDir), String(Date.now()));
      await utimes(workflowRunHeartbeatPath(deadDir), past, past);

      // Fresh heartbeat + live process: a runner that survived a daemon restart.
      const aliveDir = workflowRunDirPath(harness.dataDir, "wfr_alive");
      await mkdir(aliveDir, { recursive: true });
      const alive = spawnSleeper();
      await writeWorkflowRunnerPidFile(aliveDir, alive.pid!);
      await writeFile(workflowRunHeartbeatPath(aliveDir), String(Date.now()));

      await harness.manager.reapStaleRunners({
        spoolSyntheticTerminalEvents: false,
      });

      await waitFor(() => !isProcessAlive(hung.pid!));
      expect(await readWorkflowRunnerPidFile(hungDir)).toBeNull();
      expect(await readWorkflowRunnerPidFile(deadDir)).toBeNull();

      // Boot reap never settles foreign segments: session-open reconciliation
      // interrupts them server-side, keeping them resumable. A synthetic
      // run/failed here would supersede that interruption to `failed`.
      expect(harness.events).toEqual([]);
      expect(await readWorkflowRunTerminalRecord(hungDir)).toBeNull();
      expect(await readWorkflowRunTerminalRecord(deadDir)).toBeNull();

      // The surviving runner is untouched and reported active.
      expect(isProcessAlive(alive.pid!)).toBe(true);
      expect(await readWorkflowRunnerPidFile(aliveDir)).toBe(alive.pid);
      expect(await harness.manager.listActiveWorkflowRunIds()).toEqual([
        "wfr_alive",
      ]);
    },
    30_000,
  );

  it(
    "the in-life sweep spools a synthetic run/failed settle for a dead segment without a terminal record",
    async () => {
      const harness = await createHarness();
      const past = new Date(Date.now() - 60_000);

      // A runner that was alive at boot (so the boot reap skipped it and the
      // run was reported active) and died later: dead pid, stale heartbeat,
      // no terminal record, no live handle.
      const orphanDir = workflowRunDirPath(harness.dataDir, "wfr_orphan");
      await mkdir(orphanDir, { recursive: true });
      await writeWorkflowRunnerPidFile(orphanDir, 2 ** 30);
      await writeFile(workflowRunHeartbeatPath(orphanDir), String(Date.now()));
      await utimes(workflowRunHeartbeatPath(orphanDir), past, past);

      // A dead dir whose segment DID settle: must not be re-settled.
      const settledDir = workflowRunDirPath(harness.dataDir, "wfr_settled");
      await mkdir(settledDir, { recursive: true });
      await writeWorkflowRunnerPidFile(settledDir, 2 ** 30);
      await writeFile(workflowRunHeartbeatPath(settledDir), String(Date.now()));
      await utimes(workflowRunHeartbeatPath(settledDir), past, past);
      await writeWorkflowRunTerminalRecord(settledDir, {
        eventType: "run/completed",
        settledAtMs: Date.now(),
      });

      await harness.manager.reapStaleRunners({
        spoolSyntheticTerminalEvents: true,
      });

      // Exactly one synthetic settle, for the unsettled orphan only.
      expect(harness.events).toHaveLength(1);
      expect(harness.events[0]).toMatchObject({
        runId: "wfr_orphan",
        event: { type: "run/failed" },
      });
      const failedEvent = harness.events[0]!.event;
      if (failedEvent.type !== "run/failed") {
        throw new Error("expected run/failed");
      }
      expect(failedEvent.error).toContain("runner_exited");
      // The settle is recorded so a redelivered workflow.start acks, and the
      // dir is no longer reported active or re-reaped.
      await expect(
        readWorkflowRunTerminalRecord(orphanDir),
      ).resolves.toMatchObject({ eventType: "run/failed" });
      expect(await readWorkflowRunnerPidFile(orphanDir)).toBeNull();
      expect(await harness.manager.listActiveWorkflowRunIds()).toEqual([]);

      // Idempotent: a second sweep pass emits nothing new.
      await harness.manager.reapStaleRunners({
        spoolSyntheticTerminalEvents: true,
      });
      expect(harness.events).toHaveLength(1);
    },
    30_000,
  );
});

describe("WorkflowProviderProcessSemaphore", () => {
  it("caps tokens and hands released tokens to the oldest waiter", async () => {
    const gate = new WorkflowProviderProcessSemaphore(1);
    const signal = new AbortController().signal;
    const first = await gate.acquire({ signal });

    let secondGranted = false;
    const second = gate.acquire({ signal }).then((token) => {
      secondGranted = true;
      return token;
    });
    await sleep(20);
    expect(secondGranted).toBe(false);

    first.release();
    const secondToken = await second;
    expect(secondGranted).toBe(true);
    // Double release is a no-op; capacity stays 1.
    first.release();
    secondToken.release();
    const third = await gate.acquire({ signal });
    third.release();
  });

  it("rejects queued and pre-aborted acquisitions with AgentInterrupted", async () => {
    const gate = new WorkflowProviderProcessSemaphore(1);
    const held = await gate.acquire({ signal: new AbortController().signal });

    const aborter = new AbortController();
    const queued = gate.acquire({ signal: aborter.signal });
    aborter.abort();
    await expect(queued).rejects.toBeInstanceOf(AgentInterrupted);

    const preAborted = new AbortController();
    preAborted.abort();
    await expect(gate.acquire({ signal: preAborted.signal })).rejects.toBeInstanceOf(
      AgentInterrupted,
    );

    // The held token still releases cleanly to the next caller.
    held.release();
    const next = await gate.acquire({ signal: new AbortController().signal });
    next.release();
  });

  it("rejects a non-positive capacity", () => {
    expect(() => new WorkflowProviderProcessSemaphore(0)).toThrow(
      /positive integer/,
    );
  });
});
