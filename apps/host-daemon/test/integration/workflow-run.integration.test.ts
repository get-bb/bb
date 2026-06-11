// End-to-end daemon harness for M2 workflow runs (plan M2 exit criteria): the
// full production composition in one test — WorkflowRunManager → REAL runner
// child (runner-main.ts under tsx, ndjson JSON-RPC stdio bridge) → the
// manager-built WorkflowAgentExecutor (no worker stub) → fake provider
// adapters injected through the createRuntime seam. Agent execution is the
// scripted fake provider child; no real provider session is ever started.
//
// Complements the focused suites: src/workflow-run-manager.test.ts drives the
// manager against a FakeWorker stub and src/workflow-agent-executor.test.ts
// drives the executor in-process — this file is where the two halves meet
// through the real child processes, so it owns the cross-cutting assertions:
// run events and journal produced by real provider turns, provider-process
// accounting across the runner boundary, and no leaked (run,cwd) runtimes
// after completion, cancellation, or a SIGKILLed runner.

import { mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { setTimeout as sleep } from "node:timers/promises";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentRuntime } from "@bb/agent-runtime";
import {
  createAgentRuntimeWithAdapters,
  createFakeAdapter,
} from "@bb/agent-runtime/test";
import { parseThreadEventRow } from "@bb/domain";
import {
  sanitizeInheritedChildProcessEnv,
  spawnPortablePipedProcess,
  type PortablePipedChildProcess,
} from "@bb/process-utils";
import {
  decodeWorkflowRunnerDaemonInboundLine,
  encodeWorkflowRunnerStartRequest,
  resolveWorkflowRunnerProcessArgs,
  workflowJournalEntrySchema,
  type WorkflowRunnerDaemonInboundMessage,
  type WorkflowRunnerStartParams,
} from "@bb/workflow-runtime";
import type { HostDaemonLogger } from "../../src/logger.js";
import {
  isProcessAlive,
  readWorkflowRunnerPidFile,
  workflowRunDirPath,
  workflowRunJournalPath,
} from "../../src/workflow-run-dir.js";
import {
  WorkflowRunManager,
  type StartWorkflowRunArgs,
  type WorkflowRunManagerRunEvent,
} from "../../src/workflow-run-manager.js";

// Phase-1 prompts carry the fake provider's `delay:<ms>` token so the run is
// demonstrably mid-flight while we sample live provider-process counts.
const TWO_PHASE_WORKFLOW = `export const meta = { name: "two-phase-e2e", description: "e2e harness workflow" };
phase("research");
const findings = await parallel([
  () => agent("delay:250 research topic A"),
  () => agent("delay:250 research topic B"),
]);
phase("write");
const summary = await agent("summarize: " + findings.join(" | "));
return { summary };
`;

// A turn the fake provider holds open long enough to kill/cancel mid-run.
const SLOW_WORKFLOW = `export const meta = { name: "slow-e2e", description: "e2e harness workflow" };
await agent("delay:60000 slow task");
return "done";
`;

// For the stdio-watchdog test the harness IS the daemon and never answers the
// agent/run request, so any single-agent script stays mid-run forever.
const PENDING_AGENT_WORKFLOW = `export const meta = { name: "stdio-watchdog-e2e", description: "e2e harness workflow" };
const answer = await agent("pending agent");
return { answer };
`;

const silentLogger: HostDaemonLogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

interface Harness {
  manager: WorkflowRunManager;
  dataDir: string;
  workDir: string;
  events: WorkflowRunManagerRunEvent[];
  /** Every AgentRuntime the REAL executor created, via the createRuntime seam. */
  runtimes: AgentRuntime[];
  waitForRunEvent: (
    predicate: (event: WorkflowRunManagerRunEvent) => boolean,
  ) => Promise<WorkflowRunManagerRunEvent>;
}

const harnesses: Harness[] = [];
const tempDirs: string[] = [];
const directRunners: PortablePipedChildProcess[] = [];

async function createHarness(): Promise<Harness> {
  const dataDir = await mkdtemp(join(tmpdir(), "bb-wf-e2e-"));
  const workDir = join(dataDir, "work");
  await mkdir(workDir, { recursive: true });

  const events: WorkflowRunManagerRunEvent[] = [];
  const waiters: Array<{
    predicate: (event: WorkflowRunManagerRunEvent) => boolean;
    resolve: (event: WorkflowRunManagerRunEvent) => void;
  }> = [];
  const runtimes: AgentRuntime[] = [];

  // No `createWorker`: the manager builds the production WorkflowAgentExecutor.
  // Only the provider adapter is faked, through the same createRuntime seam the
  // daemon exposes for RuntimeManager (fake adapters spawn REAL child
  // processes speaking the provider stdio protocol).
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
    cancelEscalationGraceMs: 10_000,
    createRuntime: (options) => {
      const runtime = createAgentRuntimeWithAdapters({
        ...options,
        adapterFactory: () => createFakeAdapter(),
      });
      runtimes.push(runtime);
      return runtime;
    },
  });

  const harness: Harness = {
    manager,
    dataDir,
    workDir,
    events,
    runtimes,
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
    runId: "wfr_e2e_test",
    projectId: "proj_test",
    source: TWO_PHASE_WORKFLOW,
    filename: "e2e.workflow.js",
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

async function readJournalEntries(harness: Harness, runId: string) {
  const runDir = workflowRunDirPath(harness.dataDir, runId);
  // The journal hot-cache stream is flushed and closed before the pid record
  // clears (handleChildDown ends the stream, then clears the pid file), so a
  // post-settle read is deterministic only after the pid file is gone — a
  // terminal RUN EVENT alone races the async stream open/flush.
  await waitFor(async () => (await readWorkflowRunnerPidFile(runDir)) === null);
  const raw = await readFile(workflowRunJournalPath(runDir), "utf8");
  return raw
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => workflowJournalEntrySchema.parse(JSON.parse(line)));
}

/** Post-settle leak check (scenario e): worker shutdown runs before the pid
 *  record clears, so once the pid file is gone every runtime the executor
 *  created must have zero live provider processes — deterministically. */
async function expectNoLeakedRuntimes(
  harness: Harness,
  runId: string,
): Promise<void> {
  const runDir = workflowRunDirPath(harness.dataDir, runId);
  await waitFor(async () => (await readWorkflowRunnerPidFile(runDir)) === null);
  expect(harness.runtimes.length).toBeGreaterThan(0);
  for (const runtime of harness.runtimes) {
    expect(runtime.listRunningProviders()).toEqual([]);
  }
  expect(harness.manager.countLiveProviderProcesses()).toBe(0);
  await waitFor(async () =>
    (await harness.manager.listActiveWorkflowRunIds()).length === 0,
  );
}

interface DirectRunner {
  child: PortablePipedChildProcess;
  send: (line: string) => void;
  waitForMessage: (
    predicate: (message: WorkflowRunnerDaemonInboundMessage) => boolean,
  ) => Promise<WorkflowRunnerDaemonInboundMessage>;
  exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
}

/** Spawn the runner child exactly as the manager does (same argv resolution
 *  and env sanitation), with this test acting as the daemon over stdio. */
function spawnDirectRunner(cwd: string): DirectRunner {
  const child = spawnPortablePipedProcess({
    command: "node",
    args: resolveWorkflowRunnerProcessArgs({}),
    cwd,
    env: sanitizeInheritedChildProcessEnv({ env: process.env }),
  });
  child.stdin.on("error", () => undefined);
  directRunners.push(child);

  const messages: WorkflowRunnerDaemonInboundMessage[] = [];
  const waiters: Array<{
    predicate: (message: WorkflowRunnerDaemonInboundMessage) => boolean;
    resolve: (message: WorkflowRunnerDaemonInboundMessage) => void;
  }> = [];
  const stdout = createInterface({ input: child.stdout });
  stdout.on("line", (line) => {
    const message = decodeWorkflowRunnerDaemonInboundLine(line);
    messages.push(message);
    for (let i = waiters.length - 1; i >= 0; i--) {
      const waiter = waiters[i]!;
      if (waiter.predicate(message)) {
        waiters.splice(i, 1);
        waiter.resolve(message);
      }
    }
  });
  const exited = new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
  }>((resolve) => {
    child.once("close", (code, signal) => resolve({ code, signal }));
  });

  return {
    child,
    send: (line) => child.stdin.write(`${line}\n`),
    waitForMessage: (predicate) => {
      const existing = messages.find(predicate);
      if (existing) return Promise.resolve(existing);
      return new Promise((resolve) => waiters.push({ predicate, resolve }));
    },
    exited,
  };
}

function buildDirectRunnerStartParams(dir: string): WorkflowRunnerStartParams {
  return {
    runId: "wfr_e2e_stdio",
    source: PENDING_AGENT_WORKFLOW,
    filename: "e2e.workflow.js",
    seed: 7,
    baseTimeMs: 1_700_000_000_000,
    defaults: {
      provider: "codex",
      effort: "medium",
      sandbox: "read-only",
      cwd: dir,
      concurrency: 2,
      maxAgents: 20,
      maxFanout: 8,
      budgetOutputTokens: null,
    },
    journal: [],
    heartbeatFilePath: join(dir, ".heartbeat"),
    execTimeoutMs: null,
  };
}

afterEach(async () => {
  for (const child of directRunners.splice(0)) {
    if (child.exitCode === null && !child.killed) child.kill("SIGKILL");
  }
  for (const harness of harnesses.splice(0)) {
    await harness.manager.shutdown();
    await rm(harness.dataDir, { recursive: true, force: true });
  }
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe("workflow run end-to-end (manager + runner child + real executor + fake providers)", () => {
  it(
    "runs a two-phase workflow to completion with the expected events, journal, and agent logs",
    async () => {
      const harness = await createHarness();
      const args = buildStartArgs(harness);
      expect(await harness.manager.startRun(args)).toEqual({ accepted: true });

      // While agents are in flight, the run holds a REAL provider process
      // (the fake adapter child) — observed through the manager surface.
      await waitFor(() => harness.manager.countLiveProviderProcesses() > 0);

      const terminal = await harness.waitForRunEvent(
        (e) => e.event.type === "run/completed",
      );
      if (terminal.event.type !== "run/completed") throw new Error("unreachable");
      expect(terminal.runId).toBe(args.runId);
      // Provider-produced text (not FakeWorker synthesis) crossed the wire and
      // phase-1 results fed the phase-2 prompt.
      expect(terminal.event.result).toMatchObject({
        summary: expect.stringContaining("Response to: summarize:"),
      });
      expect(JSON.stringify(terminal.event.result)).toContain("research topic A");
      expect(JSON.stringify(terminal.event.result)).toContain("research topic B");

      const types = harness.events.map((e) => e.event.type);
      expect(types[0]).toBe("run/started");
      expect(types[types.length - 1]).toBe("run/completed");
      expect(types.filter((t) => t === "phase/started")).toHaveLength(2);
      expect(types.filter((t) => t === "agent/started")).toHaveLength(3);
      expect(types.filter((t) => t === "agent/completed")).toHaveLength(3);
      expect(types).not.toContain("agent/failed");
      expect(types).not.toContain("run/failed");

      // Journal hot cache: one settled entry per agent, from real turns.
      const entries = await readJournalEntries(harness, args.runId);
      expect(entries).toHaveLength(3);
      for (const entry of entries) {
        expect(entry.status).toBe("completed");
        expect(entry.provider).toBe("codex");
        expect(entry.resultText).toContain("Response to:");
      }

      // The REAL executor ran: per-agent provider event logs exist, keyed by
      // the EXACT agentIndex each agent/completed run event carries (the M5
      // drill-in correlation), and re-parse through the strict ThreadEventRow
      // boundary (drill-in source).
      const completedIndices = harness.events
        .flatMap((e) =>
          e.event.type === "agent/completed" ? [e.event.agentIndex] : [],
        )
        .sort((a, b) => a - b);
      expect(completedIndices).toHaveLength(3);
      const runDir = workflowRunDirPath(harness.dataDir, args.runId);
      const agentLogs = (await readdir(join(runDir, "agents"))).sort();
      expect(agentLogs).toEqual(
        completedIndices.map((index) => `${index}.events.jsonl`),
      );
      for (const file of agentLogs) {
        const rows = (await readFile(join(runDir, "agents", file), "utf8"))
          .trim()
          .split("\n")
          .map((line) => parseThreadEventRow(JSON.parse(line)));
        expect(rows.some((row) => row.type === "turn/completed")).toBe(true);
      }

      // Scenario (e): completion leaks nothing — every (run,cwd) runtime the
      // executor created is drained and nothing is reported active.
      await expectNoLeakedRuntimes(harness, args.runId);
      // Shared cwd: all three agents rode one runtime.
      expect(harness.runtimes).toHaveLength(1);
    },
    30_000,
  );

  it(
    "surfaces runner_exited and reaps the executor's provider processes when the runner child is SIGKILLed mid-run",
    async () => {
      const harness = await createHarness();
      const args = buildStartArgs(harness, { source: SLOW_WORKFLOW });
      await harness.manager.startRun(args);
      await harness.waitForRunEvent((e) => e.event.type === "agent/started");
      // The agent's provider process is genuinely live before the kill.
      await waitFor(() => harness.manager.countLiveProviderProcesses() > 0);

      const runDir = workflowRunDirPath(harness.dataDir, args.runId);
      const pid = await readWorkflowRunnerPidFile(runDir);
      expect(pid).not.toBeNull();
      process.kill(pid!, "SIGKILL");

      const terminal = await harness.waitForRunEvent(
        (e) => e.event.type === "run/failed",
      );
      if (terminal.event.type !== "run/failed") throw new Error("unreachable");
      expect(terminal.runId).toBe(args.runId);
      expect(terminal.event.error).toMatch(/^runner_exited:/);

      // The dead runner takes nothing with it, and the manager disposes the
      // executor: the provider process must not outlive the run.
      await expectNoLeakedRuntimes(harness, args.runId);
    },
    30_000,
  );

  it(
    "self-terminates the runner when the daemon side of stdio closes mid-run (no orphan)",
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "bb-wf-e2e-stdio-"));
      tempDirs.push(dir);
      const runner = spawnDirectRunner(dir);

      runner.send(
        encodeWorkflowRunnerStartRequest({
          id: 1,
          params: buildDirectRunnerStartParams(dir),
        }),
      );
      // Mid-run: the vm loop is blocked on an agent/run we never answer.
      await runner.waitForMessage((m) => m.kind === "agent-run");

      const pid = runner.child.pid;
      expect(pid).toBeDefined();
      expect(isProcessAlive(pid!)).toBe(true);

      // Simulate daemon death: its end of the runner's stdin goes away.
      runner.child.stdin.end();

      const exit = await runner.exited;
      expect(exit.code).toBe(1);
      await waitFor(() => !isProcessAlive(pid!));
    },
    30_000,
  );

  it(
    "cancelRun interrupts the in-flight provider-backed agent and settles as run/cancelled",
    async () => {
      const harness = await createHarness();
      const args = buildStartArgs(harness, { source: SLOW_WORKFLOW });
      await harness.manager.startRun(args);
      await harness.waitForRunEvent((e) => e.event.type === "agent/started");
      await waitFor(() => harness.manager.countLiveProviderProcesses() > 0);

      expect(harness.manager.cancelRun(args.runId)).toBe(true);
      const terminal = await harness.waitForRunEvent(
        (e) => e.event.type === "run/cancelled",
      );
      expect(terminal.runId).toBe(args.runId);

      // The aborted agent settled through the executor as interrupted and was
      // journaled (agent/failed precedes the terminal event).
      const failed = harness.events.find((e) => e.event.type === "agent/failed");
      if (!failed || failed.event.type !== "agent/failed") {
        throw new Error("expected an agent/failed event before run/cancelled");
      }
      expect(failed.event.entry.status).toBe("interrupted");
      expect(
        harness.events.indexOf(failed) <
          harness.events.findIndex((e) => e.event.type === "run/cancelled"),
      ).toBe(true);
      const entries = await readJournalEntries(harness, args.runId);
      expect(entries).toHaveLength(1);
      expect(entries[0]!.status).toBe("interrupted");

      // Cancellation leaks nothing either.
      await expectNoLeakedRuntimes(harness, args.runId);
    },
    30_000,
  );
});
