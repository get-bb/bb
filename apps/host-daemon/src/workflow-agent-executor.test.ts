import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import type {
  AgentRuntime,
  AgentRuntimeOptions,
  RunTurnArgs,
  StartThreadArgs,
  StopThreadArgs,
} from "@bb/agent-runtime";
import {
  createAgentRuntimeWithAdapters,
  createFakeAdapter,
  fakeProviderScriptPath,
} from "@bb/agent-runtime/test";
import {
  parseThreadEventRow,
  type JsonObject,
  type ThreadEventRow,
} from "@bb/domain";
import {
  buildThreadTimelineFromEvents,
  decodeThreadEventRow,
  EMPTY_ACCEPTED_CLIENT_REQUEST_CONTEXT,
  type ThreadEventWithMeta,
} from "@bb/thread-view";
import {
  AgentError,
  AgentInterrupted,
  withRetry,
  type AgentSpec,
  type WorkerContext,
  type WorkerProgress,
  type WorkflowSandbox,
} from "@bb/workflow-runtime";
import type { HostDaemonLogger } from "./logger.js";
import {
  WorkflowAgentExecutor,
  type WorkflowProviderProcessGate,
} from "./workflow-agent-executor.js";
import { workflowRunDirPath } from "./workflow-run-dir.js";
import {
  WorkflowRunManager,
  type WorkflowRunManagerRunEvent,
} from "./workflow-run-manager.js";

const execFileAsync = promisify(execFile);

const RUN_ID = "wfr_test";

const executorFakeProviderScriptPath = fileURLToPath(
  new URL("./workflow-agent-executor.fake-provider-script.ts", import.meta.url),
);

const ANSWER_SCHEMA: JsonObject = {
  type: "object",
  properties: { answer: { type: "string" } },
  required: ["answer"],
};

interface RecordingGate extends WorkflowProviderProcessGate {
  acquired: number;
  released: number;
}

function createRecordingGate(): RecordingGate {
  const gate: RecordingGate = {
    acquired: 0,
    released: 0,
    acquire: ({ signal }) => {
      if (signal.aborted) {
        return Promise.reject(new AgentInterrupted());
      }
      gate.acquired += 1;
      return Promise.resolve({
        release: () => {
          gate.released += 1;
        },
      });
    },
  };
  return gate;
}

interface Harness {
  executor: WorkflowAgentExecutor;
  rootDir: string;
  runDir: string;
  workDir: string;
  gate: RecordingGate;
  runtimes: AgentRuntime[];
  createRuntimeOptions: AgentRuntimeOptions[];
  startThreadArgs: StartThreadArgs[];
  runTurnArgs: RunTurnArgs[];
  stopThreadArgs: StopThreadArgs[];
}

interface CreateHarnessOptions {
  turnStallTimeoutMs?: number;
  scriptPath?: string;
  /** Per-run sandbox ceiling; defaults to the built-in project policy
   *  default (workspace-write — danger-full-access requires a grant). */
  sandboxCeiling?: WorkflowSandbox;
}

const harnesses: Harness[] = [];

async function createHarness(options: CreateHarnessOptions = {}): Promise<Harness> {
  const rootDir = await mkdtemp(join(tmpdir(), "bb-wf-executor-"));
  const workDir = join(rootDir, "work");
  await mkdir(workDir, { recursive: true });
  const runDir = join(rootDir, "run");

  const runtimes: AgentRuntime[] = [];
  const createRuntimeOptions: AgentRuntimeOptions[] = [];
  const startThreadArgs: StartThreadArgs[] = [];
  const runTurnArgs: RunTurnArgs[] = [];
  const stopThreadArgs: StopThreadArgs[] = [];
  const gate = createRecordingGate();

  const executor = new WorkflowAgentExecutor({
    runId: RUN_ID,
    projectId: "proj_test",
    runDir,
    sandboxCeiling: options.sandboxCeiling ?? "workspace-write",
    workflowAgentShellEnv: { PATH: "/usr/bin:/bin" },
    createRuntime: (runtimeOptions) => {
      createRuntimeOptions.push(runtimeOptions);
      const runtime = createAgentRuntimeWithAdapters({
        ...runtimeOptions,
        adapterFactory: () =>
          createFakeAdapter({
            scriptPath: options.scriptPath ?? executorFakeProviderScriptPath,
            supportsUserQuestion: true,
          }),
      });
      const wrapped: AgentRuntime = {
        ...runtime,
        startThread: (args) => {
          startThreadArgs.push(args);
          return runtime.startThread(args);
        },
        runTurn: (args) => {
          runTurnArgs.push(args);
          return runtime.runTurn(args);
        },
        stopThread: (args) => {
          stopThreadArgs.push(args);
          return runtime.stopThread(args);
        },
      };
      runtimes.push(wrapped);
      return wrapped;
    },
    providerProcessGate: gate,
    worktreeSetupTimeoutMs: 10_000,
    turnStallTimeoutMs: options.turnStallTimeoutMs ?? 60_000,
  });

  const harness: Harness = {
    executor,
    rootDir,
    runDir,
    workDir,
    gate,
    runtimes,
    createRuntimeOptions,
    startThreadArgs,
    runTurnArgs,
    stopThreadArgs,
  };
  harnesses.push(harness);
  return harness;
}

afterEach(async () => {
  for (const harness of harnesses.splice(0)) {
    await harness.executor.shutdown();
    await rm(harness.rootDir, { recursive: true, force: true });
  }
});

function buildSpec(harness: Harness, overrides: Partial<AgentSpec> = {}): AgentSpec {
  return {
    prompt: "hello",
    provider: "codex",
    effort: "medium",
    cwd: harness.workDir,
    sandbox: "read-only",
    ...overrides,
  };
}

interface BuildContextOverrides {
  agentIndex?: number;
  attempt?: number;
}

function buildContext(overrides: BuildContextOverrides = {}): WorkerContext & {
  controller: AbortController;
  progress: WorkerProgress[];
} {
  const controller = new AbortController();
  const progress: WorkerProgress[] = [];
  return {
    controller,
    progress,
    agentIndex: overrides.agentIndex ?? 0,
    attempt: overrides.attempt ?? 0,
    signal: controller.signal,
    onProgress: (entry) => {
      progress.push(entry);
    },
  };
}

async function readAgentLogRows(harness: Harness, agentIndex: number) {
  const raw = await readFile(
    join(harness.runDir, "agents", `${agentIndex}.events.jsonl`),
    "utf8",
  );
  return raw
    .trim()
    .split("\n")
    .map((line) => parseThreadEventRow(JSON.parse(line)));
}

function decodeAgentLogRows(rows: ThreadEventRow[]): ThreadEventWithMeta[] {
  return rows.map((row) => decodeThreadEventRow(row));
}

/** Renders a decoded per-agent event log through thread-view's pure timeline
 *  projection with the exact options the thread page and CLI use — the M5
 *  drill-in contract (plan §6/§9). */
function renderAgentTimeline(events: ThreadEventWithMeta[]) {
  return buildThreadTimelineFromEvents({
    acceptedClientRequestContext: EMPTY_ACCEPTED_CLIENT_REQUEST_CONTEXT,
    contextWindowEvents: events,
    events,
    options: {
      includeDebugRawEvents: false,
      includeNestedRows: true,
      includeProviderUnhandledOperations: false,
      isLatestPage: true,
      threadStatus: "idle",
      turnMessageDetail: "full",
      workspaceRoot: null,
    },
  });
}

async function createGitRepo(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  const git = (args: string[]) => execFileAsync("git", args, { cwd: dir });
  await git(["init", "--initial-branch=main"]);
  await git(["config", "user.email", "workflow-test@example.com"]);
  await git(["config", "user.name", "Workflow Test"]);
  await git(["config", "commit.gpgsign", "false"]);
  await writeFile(join(dir, "README.md"), "workflow executor test repo\n");
  await git(["add", "."]);
  await git(["commit", "-m", "init"]);
}

describe("WorkflowAgentExecutor", () => {
  it("runs an agent and writes a decodable per-agent event log", async () => {
    const harness = await createHarness();
    const context = buildContext();

    const result = await harness.executor.runAgent(
      buildSpec(harness, { prompt: "hello there" }),
      context,
    );

    expect(result.status).toBe("completed");
    expect(result.text).toBe("Response to: hello there");
    expect(result.worktreeBranch).toBeUndefined();

    // The session started as a workflow agent with the restricted env kind,
    // run-scoped ids, and the sandbox-derived execution options.
    expect(harness.startThreadArgs).toHaveLength(1);
    const startArgs = harness.startThreadArgs[0]!;
    expect(startArgs.sessionKind).toBe("workflowAgent");
    expect(startArgs.threadId).toBe(`wfa_${RUN_ID}_0`);
    expect(startArgs.environmentId).toBe(RUN_ID);
    expect(startArgs.projectId).toBe("proj_test");
    expect(startArgs.options).toMatchObject({
      model: "fake-model",
      serviceTier: "default",
      reasoningLevel: "medium",
      workflowsEnabled: false,
      permissionMode: "readonly",
      permissionEscalation: "deny",
    });

    // Worker progress carried the agent message text.
    expect(
      context.progress.some(
        (entry) => entry.kind === "text" && entry.text.includes("hello there"),
      ),
    ).toBe(true);

    // The event log re-parses through the strict row schema with per-agent
    // monotonic sequence meta...
    const rows = await readAgentLogRows(harness, 0);
    expect(rows.length).toBeGreaterThan(0);
    rows.forEach((row, index) => {
      expect(row.threadId).toBe(`wfa_${RUN_ID}_0`);
      expect(row.seq).toBe(index + 1);
    });
    const types = rows.map((row) => row.type);
    expect(types).toContain("turn/started");
    expect(types).toContain("item/completed");
    expect(types).toContain("turn/completed");

    // ...and renders through thread-view's pure timeline projection — the
    // drill-in contract for the run page (plan §6/§9).
    const timeline = renderAgentTimeline(decodeAgentLogRows(rows));
    expect(timeline.rows.length).toBeGreaterThan(0);
  });

  it("routes concurrent agents' interleaved events to separate logs that each render a timeline", async () => {
    const harness = await createHarness();

    // Same cwd → one runtime, one shared onEvent stream: with overlapping
    // delays both turns are live at once, so the two agents' events
    // interleave and per-agent routing is load-bearing.
    const [first, second] = await Promise.all([
      harness.executor.runAgent(
        buildSpec(harness, { prompt: "delay:300 alpha" }),
        buildContext({ agentIndex: 0 }),
      ),
      harness.executor.runAgent(
        buildSpec(harness, { prompt: "delay:150 beta" }),
        buildContext({ agentIndex: 1 }),
      ),
    ]);
    expect(first.text).toBe("Response to: delay:300 alpha");
    expect(second.text).toBe("Response to: delay:150 beta");
    expect(harness.createRuntimeOptions).toHaveLength(1);

    const expectedMessageTexts = [
      "Response to: delay:300 alpha",
      "Response to: delay:150 beta",
    ];
    for (const agentIndex of [0, 1]) {
      const rows = await readAgentLogRows(harness, agentIndex);
      // Each log holds only its own agent's rows, with its own contiguous
      // per-agent sequence (a shared counter or cross-agent leak breaks this).
      rows.forEach((row, index) => {
        expect(row.threadId).toBe(`wfa_${RUN_ID}_${agentIndex}`);
        expect(row.seq).toBe(index + 1);
      });
      const events = decodeAgentLogRows(rows);
      const messageTexts = events.flatMap(({ event }) =>
        event.type === "item/completed" && event.item.type === "agentMessage"
          ? [event.item.text]
          : [],
      );
      expect(messageTexts).toEqual([expectedMessageTexts[agentIndex]]);
      // Every agent's log — not just the first — renders a non-empty
      // timeline (M2 exit criterion: "each agent's event log").
      expect(renderAgentTimeline(events).rows.length).toBeGreaterThan(0);
    }
  });

  it("maps sandbox levels and model overrides onto execution options", async () => {
    const harness = await createHarness();
    const context = buildContext();

    await harness.executor.runAgent(
      buildSpec(harness, { sandbox: "workspace-write", model: "custom-model" }),
      context,
    );

    const startArgs = harness.startThreadArgs[0]!;
    expect(startArgs.options).toMatchObject({
      model: "custom-model",
      permissionMode: "workspace-write",
      permissionEscalation: "deny",
    });
  });

  it("rejects over-ceiling specs terminally before any session starts", async () => {
    // The server launch gate only rejects an over-ceiling RUN DEFAULT; a
    // per-call `agent(prompt, {sandbox})` arrives here with whatever the
    // script wrote. The executor enforces the run-row ceiling snapshot
    // (M7's per-project allowance): terminal AgentError (withRetry must not
    // re-spend slots on a policy reject), no provider session, no agent log.
    const harness = await createHarness();
    const context = buildContext();

    const run = harness.executor.runAgent(
      buildSpec(harness, { sandbox: "danger-full-access" }),
      context,
    );
    await expect(run).rejects.toMatchObject({
      code: "sandbox_not_allowed",
      retryable: false,
    });
    await expect(run).rejects.toBeInstanceOf(AgentError);
    expect(harness.startThreadArgs).toHaveLength(0);
    expect(harness.createRuntimeOptions).toHaveLength(0);

    // A lowered ceiling gates workspace-write the same way.
    const lowered = await createHarness({ sandboxCeiling: "read-only" });
    await expect(
      lowered.executor.runAgent(
        buildSpec(lowered, { sandbox: "workspace-write" }),
        buildContext(),
      ),
    ).rejects.toMatchObject({ code: "sandbox_not_allowed", retryable: false });
    expect(lowered.startThreadArgs).toHaveLength(0);
  });

  it("rejects worktree specs under a read-only ceiling (effective sandbox, not declared)", async () => {
    // Worktree agents are forced to workspace-write regardless of the
    // declared spec sandbox, so the ceiling must gate the EFFECTIVE sandbox:
    // a worktree spec carrying the read-only run default under a read-only
    // ceiling would otherwise execute with workspace-write — including
    // wf/<runId>-* branch creation in the real project repo's refs. Terminal
    // reject before any gate-token, worktree, or session spend.
    const harness = await createHarness({ sandboxCeiling: "read-only" });

    const run = harness.executor.runAgent(
      buildSpec(harness, { sandbox: "read-only", worktree: true }),
      buildContext(),
    );
    await expect(run).rejects.toMatchObject({
      code: "sandbox_not_allowed",
      retryable: false,
    });
    await expect(run).rejects.toBeInstanceOf(AgentError);
    expect(harness.gate.acquired).toBe(0);
    expect(harness.startThreadArgs).toHaveLength(0);
    expect(harness.createRuntimeOptions).toHaveLength(0);
    // No worktree was provisioned (the worktrees dir was never created).
    await expect(stat(join(harness.runDir, "worktrees"))).rejects.toMatchObject(
      { code: "ENOENT" },
    );

    // A workspace-write ceiling admits the same spec: the forced effective
    // sandbox equals the ceiling.
    const admitted = await createHarness({ sandboxCeiling: "workspace-write" });
    await createGitRepo(admitted.workDir);
    const result = await admitted.executor.runAgent(
      buildSpec(admitted, { sandbox: "read-only", worktree: true }),
      buildContext(),
    );
    expect(result.status).toBe("completed");
  });

  it("admits danger-full-access when the run's ceiling grants it (permissionMode full)", async () => {
    // The grant travels server → workflow.start → run manager → executor
    // options; the executor never decides policy, it only compares against
    // the snapshotted ceiling.
    const harness = await createHarness({
      sandboxCeiling: "danger-full-access",
    });

    const result = await harness.executor.runAgent(
      buildSpec(harness, { sandbox: "danger-full-access" }),
      buildContext(),
    );

    expect(result.status).toBe("completed");
    expect(harness.startThreadArgs).toHaveLength(1);
    expect(harness.startThreadArgs[0]!.options).toMatchObject({
      permissionMode: "full",
    });
  });

  it("shares one runtime per cwd and disposes it at shutdown", async () => {
    const harness = await createHarness();

    const [first, second] = await Promise.all([
      harness.executor.runAgent(
        buildSpec(harness, { prompt: "delay:200 one" }),
        buildContext({ agentIndex: 0 }),
      ),
      harness.executor.runAgent(
        buildSpec(harness, { prompt: "delay:200 two" }),
        buildContext({ agentIndex: 1 }),
      ),
    ]);
    expect(first.status).toBe("completed");
    expect(second.status).toBe("completed");

    // Same cwd → one runtime, one provider process for both agents.
    expect(harness.createRuntimeOptions).toHaveLength(1);
    expect(harness.runtimes[0]!.listRunningProviders()).toEqual(["codex"]);
    expect(harness.executor.countRunningProviderProcesses()).toBe(1);

    await harness.executor.shutdown();
    expect(harness.runtimes[0]!.listRunningProviders()).toEqual([]);
    expect(harness.executor.countRunningProviderProcesses()).toBe(0);
  });

  it("maps abort to AgentInterrupted", async () => {
    const harness = await createHarness();
    const context = buildContext();

    const run = harness.executor.runAgent(
      buildSpec(harness, { prompt: "delay:60000" }),
      context,
    );
    await sleep(400);
    context.controller.abort();

    await expect(run).rejects.toBeInstanceOf(AgentInterrupted);
  });

  it("maps a stalled turn to a retryable AgentError", async () => {
    const harness = await createHarness({ turnStallTimeoutMs: 300 });
    const context = buildContext();

    const error = await harness.executor
      .runAgent(
        buildSpec(harness, { prompt: "delay:60000", provider: "claude-code" }),
        context,
      )
      .then(
        () => null,
        (raised: unknown) => raised,
      );

    expect(error).toBeInstanceOf(AgentError);
    expect(error).toMatchObject({ code: "turn_stalled", retryable: true });
    // Single-agent path (claude): the stalled turn IS stopped best-effort.
    expect(harness.stopThreadArgs.length).toBeGreaterThan(0);
  });

  it("abandons a stalled codex turn on a shared runtime without stopping the provider", async () => {
    const harness = await createHarness({ turnStallTimeoutMs: 400 });

    // Both agents share the (run, cwd) runtime. Stopping the stalled codex
    // turn would restart the WHOLE provider process and kill the sibling —
    // the executor abandons it instead (accepted trade-off, see
    // onTurnStalled): the waiter rejects retryable while the sibling and the
    // shared provider process keep running.
    const stalled = harness.executor
      .runAgent(
        buildSpec(harness, { prompt: "delay:60000 stall" }),
        buildContext({ agentIndex: 1 }),
      )
      .then(
        () => null,
        (raised: unknown) => raised,
      );
    const sibling = await harness.executor.runAgent(
      buildSpec(harness, { prompt: "delay:150 sibling" }),
      buildContext({ agentIndex: 2 }),
    );
    const error = await stalled;

    expect(sibling.status).toBe("completed");
    expect(error).toBeInstanceOf(AgentError);
    expect(error).toMatchObject({ code: "turn_stalled", retryable: true });
    // The stalled turn was abandoned, never stopped: no thread/stop reached
    // the shared runtime, and its provider process is still alive.
    expect(harness.stopThreadArgs).toHaveLength(0);
    expect(harness.runtimes[0]!.listRunningProviders()).toEqual(["codex"]);
  });

  it("maps a provider process death to a retryable AgentError and retries into ONE agent log", async () => {
    const harness = await createHarness();
    const controller = new AbortController();
    const marker = join(harness.rootDir, "crash.marker");
    const spec = buildSpec(harness, { prompt: `crash-once:${marker}` });
    const agentIndex = 5;

    // Mirror the M1 runtime's contract: every retry of one logical agent
    // reuses its journal-stable agentIndex with an incremented attempt.
    let attempts = 0;
    const result = await withRetry(
      () =>
        harness.executor.runAgent(spec, {
          ...buildContext({ agentIndex, attempt: attempts++ }),
          signal: controller.signal,
        }),
      { signal: controller.signal, baseMs: 10 },
    );

    expect(attempts).toBe(2);
    expect(result.status).toBe("completed");
    expect(result.text).toContain("crash-once:");

    // The drill-in contract (plan §6/§9): one logical agent maps to exactly
    // ONE log file addressed by its run-event agentIndex, with the crashed
    // attempt's synthesized failure rows (mirroring
    // RuntimeManager.buildUnexpectedProviderExitEvents) and the successful
    // retry appended in order under one monotonic sequence.
    const rows = await readAgentLogRows(harness, agentIndex);
    rows.forEach((row, index) => {
      expect(row.seq).toBe(index + 1);
    });
    const systemError = rows.find((row) => row.type === "system/error");
    expect(systemError).toBeDefined();
    expect(systemError).toMatchObject({
      data: { code: "provider_process_exited" },
    });
    const turnStatuses = rows.flatMap((row) =>
      row.type === "turn/completed" && "status" in row.data
        ? [row.data.status]
        : [],
    );
    expect(turnStatuses).toEqual(["failed", "completed"]);
    // No log exists under the executor-internal call order (the old
    // divergent-index behavior).
    expect(existsSync(join(harness.runDir, "agents", "0.events.jsonl"))).toBe(
      false,
    );
    // The merged failed+retried log still renders one coherent timeline.
    expect(
      renderAgentTimeline(decodeAgentLogRows(rows)).rows.length,
    ).toBeGreaterThan(0);
  });

  it("runs the codex two-turn structured output flow", async () => {
    const harness = await createHarness();
    const context = buildContext();

    const result = await harness.executor.runAgent(
      buildSpec(harness, { schema: ANSWER_SCHEMA }),
      context,
    );

    expect(result.structured).toEqual({ answer: "ok" });
    expect(harness.runTurnArgs).toHaveLength(2);
    // Working turn: free-form, no schema. Extraction turn: strictified schema
    // on the codex turn-level outputSchema.
    expect(harness.runTurnArgs[0]!.outputSchema).toBeUndefined();
    expect(harness.runTurnArgs[1]!.outputSchema).toMatchObject({
      additionalProperties: false,
      required: ["answer"],
    });
    expect(harness.startThreadArgs[0]!.outputSchema).toBeUndefined();
    // The silent extraction turn forwards no progress.
    expect(
      context.progress.some(
        (entry) => entry.kind === "text" && entry.text.includes('"answer"'),
      ),
    ).toBe(false);
  });

  it("runs claude-code structured output session-level in a single turn", async () => {
    const harness = await createHarness();
    const context = buildContext();

    const result = await harness.executor.runAgent(
      buildSpec(harness, {
        provider: "claude-code",
        // The session is schema-constrained, so the working turn's final
        // message is the JSON; the marker makes the fake provider return it.
        prompt: "Summarize. Output only the JSON.",
        schema: ANSWER_SCHEMA,
      }),
      context,
    );

    expect(result.structured).toEqual({ answer: "ok" });
    expect(harness.startThreadArgs[0]!.outputSchema).toEqual(ANSWER_SCHEMA);
    expect(harness.runTurnArgs).toHaveLength(1);
    expect(harness.runTurnArgs[0]!.outputSchema).toBeUndefined();
  });

  it("runs the pi schema-in-prompt extraction with no adapter schema", async () => {
    const harness = await createHarness();
    const context = buildContext();

    const result = await harness.executor.runAgent(
      buildSpec(harness, { provider: "pi", schema: ANSWER_SCHEMA }),
      context,
    );

    expect(result.structured).toEqual({ answer: "ok" });
    expect(harness.runTurnArgs).toHaveLength(2);
    expect(harness.startThreadArgs[0]!.outputSchema).toBeUndefined();
    expect(harness.runTurnArgs[1]!.outputSchema).toBeUndefined();
    // The schema travels inside the extraction prompt instead.
    const extractionInput = harness.runTurnArgs[1]!.input[0];
    expect(extractionInput).toBeDefined();
    if (extractionInput?.type !== "text") {
      throw new Error("expected text extraction input");
    }
    expect(extractionInput.text).toContain('"answer"');
    expect(extractionInput.text).toContain("Output only the JSON");
  });

  it("answers user questions autonomously without pending interactions", async () => {
    const harness = await createHarness({ scriptPath: fakeProviderScriptPath });
    const context = buildContext();

    const result = await harness.executor.runAgent(
      buildSpec(harness, { prompt: "ask_user" }),
      context,
    );

    expect(result.status).toBe("completed");
    expect(result.text).toContain("Question answered:");
    expect(result.text).toContain("autonomously");
  });

  it("provisions a worktree agent, forces workspace-write, and removes a clean worktree", async () => {
    const harness = await createHarness();
    const repoDir = join(harness.rootDir, "repo");
    await createGitRepo(repoDir);
    const context = buildContext();

    const result = await harness.executor.runAgent(
      buildSpec(harness, { cwd: repoDir, worktree: true }),
      context,
    );

    expect(result.status).toBe("completed");
    expect(result.worktreeBranch).toBeUndefined();
    expect(harness.gate.acquired).toBe(1);
    expect(harness.gate.released).toBe(1);

    const worktreePath = join(harness.runDir, "worktrees", "0");
    expect(harness.createRuntimeOptions[0]!.workspacePath).toBe(worktreePath);
    expect(harness.startThreadArgs[0]!.options.permissionMode).toBe(
      "workspace-write",
    );
    // Clean worktree: removed at settle, single-agent runtime disposed.
    expect(existsSync(worktreePath)).toBe(false);
    expect(harness.runtimes[0]!.listRunningProviders()).toEqual([]);
    expect(harness.executor.countRunningProviderProcesses()).toBe(0);
  });

  it("preserves a dirty worktree's branch and reports it on the result", async () => {
    const harness = await createHarness();
    const repoDir = join(harness.rootDir, "repo");
    await createGitRepo(repoDir);
    const context = buildContext();

    const run = harness.executor.runAgent(
      buildSpec(harness, { cwd: repoDir, worktree: true, prompt: "delay:1500" }),
      context,
    );

    // Dirty the worktree while the agent runs.
    const worktreePath = join(harness.runDir, "worktrees", "0");
    const deadline = Date.now() + 10_000;
    while (!existsSync(join(worktreePath, "README.md"))) {
      if (Date.now() > deadline) {
        throw new Error("worktree was never provisioned");
      }
      await sleep(25);
    }
    await writeFile(join(worktreePath, "agent-output.txt"), "changed\n");

    const result = await run;
    expect(result.worktreeBranch).toBe(`wf/${RUN_ID}-0`);
    expect(existsSync(join(worktreePath, "agent-output.txt"))).toBe(true);
  });

  it("does not acquire the provider-process gate for shared-cwd agents", async () => {
    const harness = await createHarness();

    await harness.executor.runAgent(buildSpec(harness), buildContext());

    expect(harness.gate.acquired).toBe(0);
    expect(harness.gate.released).toBe(0);
  });
});

const silentLogger: HostDaemonLogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

describe("WorkflowAgentExecutor across the runner wire", () => {
  it(
    "revalidates structured output with one corrective re-prompt into the agentIndex-keyed log",
    async () => {
      // Full M1-runtime + runner-wire + executor + fake-provider path: the
      // first structured reply violates the schema, the workflow runtime's
      // single corrective re-prompt re-runs the agent (same agentIndex, next
      // attempt), and the corrected value validates.
      const dataDir = await mkdtemp(join(tmpdir(), "bb-wf-corrective-"));
      const workDir = join(dataDir, "work");
      await mkdir(workDir, { recursive: true });
      const events: WorkflowRunManagerRunEvent[] = [];
      const manager = new WorkflowRunManager({
        dataDir,
        logger: silentLogger,
        workflowAgentShellEnv: { PATH: "/usr/bin:/bin" },
        onRunEvent: (event) => {
          events.push(event);
        },
        maxLiveProviderProcesses: 4,
        worktreeSetupTimeoutMs: 10_000,
        turnStallTimeoutMs: 60_000,
        cancelEscalationGraceMs: 10_000,
        createRuntime: (runtimeOptions) =>
          createAgentRuntimeWithAdapters({
            ...runtimeOptions,
            adapterFactory: () =>
              createFakeAdapter({
                scriptPath: executorFakeProviderScriptPath,
                supportsUserQuestion: true,
              }),
          }),
      });
      try {
        const marker = join(dataDir, "schema-miss.marker");
        const source = [
          'export const meta = { name: "corrective", description: "corrective retry fixture" };',
          `return await agent("schema-miss-once:${marker} collect the answer", { schema: { type: "object", properties: { answer: { type: "string" } }, required: ["answer"] } });`,
          "",
        ].join("\n");
        const accepted = await manager.startRun({
          runId: "wfr_corrective",
          projectId: "proj_test",
          source,
          filename: "corrective.workflow.js",
          args: undefined,
          seed: 11,
          baseTimeMs: 1_700_000_000_000,
          defaults: {
            provider: "codex",
            effort: "medium",
            sandbox: "read-only",
            cwd: workDir,
            concurrency: 2,
            maxAgents: 5,
            maxFanout: 4,
            budgetOutputTokens: null,
          },
          sandboxCeiling: "workspace-write",
          journal: [],
          execTimeoutMs: null,
        });
        expect(accepted).toEqual({ accepted: true });

        const deadline = Date.now() + 25_000;
        const isTerminal = (entry: WorkflowRunManagerRunEvent) =>
          entry.event.type === "run/completed" ||
          entry.event.type === "run/failed" ||
          entry.event.type === "run/cancelled";
        while (!events.some(isTerminal)) {
          if (Date.now() > deadline) {
            throw new Error(
              `run never settled: ${JSON.stringify(events.map((e) => e.event.type))}`,
            );
          }
          await sleep(50);
        }
        const terminal = events.find(isTerminal)!;
        if (terminal.event.type !== "run/completed") {
          throw new Error(`run did not complete: ${JSON.stringify(terminal.event)}`);
        }
        expect(terminal.event.result).toEqual({ answer: "ok" });

        // Exactly one corrective re-prompt was issued.
        const correctiveLogs = events.filter(
          (entry) =>
            entry.event.type === "log" &&
            entry.event.message.includes("structured output retry"),
        );
        expect(correctiveLogs).toHaveLength(1);

        const completion = events.find(
          (entry) => entry.event.type === "agent/completed",
        );
        if (!completion || completion.event.type !== "agent/completed") {
          throw new Error("expected an agent/completed event");
        }
        expect(completion.event.entry.structured).toEqual({ answer: "ok" });

        // Both attempts (a working + extraction turn each) landed in the ONE
        // log addressed by the run event's agentIndex — the M5 drill-in key.
        const raw = await readFile(
          join(
            workflowRunDirPath(dataDir, "wfr_corrective"),
            "agents",
            `${completion.event.agentIndex}.events.jsonl`,
          ),
          "utf8",
        );
        const rows = raw
          .trim()
          .split("\n")
          .map((line) => parseThreadEventRow(JSON.parse(line)));
        rows.forEach((row, index) => {
          expect(row.seq).toBe(index + 1);
        });
        expect(rows.filter((row) => row.type === "turn/completed")).toHaveLength(
          4,
        );
      } finally {
        await manager.shutdown();
        await rm(dataDir, { recursive: true, force: true });
      }
    },
    30_000,
  );
});
