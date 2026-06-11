// Dispatch-level tests for the workflow.* durable commands and registry RPCs:
// redelivery idempotency (live handle + terminal record), resume journal
// ordering (fetch-before-spawn), typed error-code mapping, and the registry
// tier resolution surfaced over workflow.list / workflow.resolve.

import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { afterEach, describe, expect, it } from "vitest";
import type { HostDaemonCommand } from "@bb/host-daemon-contract";
import {
  FakeWorker,
  KEY_VERSION,
  type AgentResult,
  type AgentSpec,
  type WorkerContext,
  type WorkflowJournalEntry,
} from "@bb/workflow-runtime";
import {
  dispatchCommand,
  dispatchOnlineRpcCommand,
} from "../../src/command-dispatch.js";
import type { CommandDispatchOptions } from "../../src/command-dispatch-support.js";
import { RuntimeManager } from "../../src/runtime-manager.js";
import {
  WorkflowRunManager,
  type StartWorkflowRunArgs,
  type StartWorkflowRunResult,
  type WorkflowRunWorker,
} from "../../src/workflow-run-manager.js";
import {
  readWorkflowRunTerminalRecord,
  workflowRunDirPath,
  writeWorkflowRunTerminalRecord,
} from "../../src/workflow-run-dir.js";
import type { HostDaemonLogger } from "../../src/logger.js";
import {
  cleanupTempDirs,
  createFakeWorkspace,
  makeDispatchOptions,
  makeTempDir,
} from "./dispatch-helpers.js";

afterEach(cleanupTempDirs);

const SIMPLE_WORKFLOW = `export const meta = { name: "simple", description: "test workflow" };
const result = await agent("do the work");
return { result };
`;

const silentLogger: HostDaemonLogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

type WorkflowStartCommand = Extract<
  HostDaemonCommand,
  { type: "workflow.start" }
>;

class FakeWorkflowRunTarget {
  readonly startCalls: StartWorkflowRunArgs[] = [];
  readonly cancelCalls: string[] = [];
  readonly pruneCalls: string[] = [];
  startResult: StartWorkflowRunResult = { accepted: true };
  cancelResult = true;
  pruneResult = { pruned: true };

  async startRun(args: StartWorkflowRunArgs): Promise<StartWorkflowRunResult> {
    this.startCalls.push(args);
    return this.startResult;
  }

  cancelRun(runId: string): boolean {
    this.cancelCalls.push(runId);
    return this.cancelResult;
  }

  async pruneRunDir(runId: string): Promise<{ pruned: boolean }> {
    this.pruneCalls.push(runId);
    return this.pruneResult;
  }
}

class RecordingWorker implements WorkflowRunWorker {
  readonly specs: AgentSpec[] = [];
  private readonly fake = new FakeWorker();

  runAgent(spec: AgentSpec, context: WorkerContext): Promise<AgentResult> {
    this.specs.push(spec);
    return this.fake.runAgent(spec, context);
  }

  async shutdown(): Promise<void> {}

  countRunningProviderProcesses(): number {
    return 0;
  }
}

function buildStartCommand(
  overrides: Partial<WorkflowStartCommand> = {},
): WorkflowStartCommand {
  return {
    type: "workflow.start",
    runId: "wfr_dispatch_test",
    projectId: "proj_test",
    script: {
      name: "simple",
      content: SIMPLE_WORKFLOW,
      hash: createHash("sha256").update(SIMPLE_WORKFLOW).digest("hex"),
    },
    argsJson: '{"topic":"unit tests"}',
    seed: 7,
    keyVersion: KEY_VERSION,
    baseTimeMs: 1_700_000_000_000,
    defaults: {
      providerId: "codex",
      model: null,
      effort: "medium",
      sandbox: "read-only",
      concurrency: 2,
      maxAgents: 20,
      maxFanout: 8,
      budgetOutputTokens: null,
    },
    sandboxCeiling: "workspace-write",
    workspacePath: "/tmp/wf-workspace",
    execTimeoutMs: null,
    resume: null,
    ...overrides,
  };
}

function journalEntry(agentIndex: number): WorkflowJournalEntry {
  return {
    key: `key-${agentIndex}`,
    agentIndex,
    branchKey: "root",
    status: "completed",
    resultText: "cached result",
    usage: { inputTokens: 5, outputTokens: 3 },
    provider: "codex",
    durationMs: 20,
  };
}

interface WorkflowDispatchHarness {
  dataDir: string;
  target: FakeWorkflowRunTarget;
  journalFetches: string[];
  options: CommandDispatchOptions;
}

async function createWorkflowDispatchHarness(
  args: {
    journal?: WorkflowJournalEntry[];
    journalError?: Error;
  } = {},
): Promise<WorkflowDispatchHarness> {
  const dataDir = await makeTempDir("bb-workflow-dispatch-");
  const target = new FakeWorkflowRunTarget();
  const journalFetches: string[] = [];
  const options = makeDispatchOptions({
    dataDir,
    runtimeManager: new RuntimeManager({
      provisionWorkspace: async () => createFakeWorkspace("/tmp/env-1").workspace,
    }),
    workflowRunManager: target,
    fetchWorkflowRunJournal: async ({ runId }) => {
      journalFetches.push(runId);
      if (args.journalError) {
        throw args.journalError;
      }
      return args.journal ?? [];
    },
  });
  return { dataDir, target, journalFetches, options };
}

describe("workflow.start dispatch", () => {
  it("maps the command onto runner start args and acks acceptance", async () => {
    const harness = await createWorkflowDispatchHarness();
    const command = buildStartCommand();

    const result = await dispatchCommand(command, harness.options);

    expect(result).toEqual({ accepted: true });
    expect(harness.journalFetches).toEqual([]);
    expect(harness.target.startCalls).toHaveLength(1);
    expect(harness.target.startCalls[0]).toEqual({
      runId: "wfr_dispatch_test",
      projectId: "proj_test",
      source: SIMPLE_WORKFLOW,
      filename: "simple.workflow.js",
      args: { topic: "unit tests" },
      seed: 7,
      baseTimeMs: 1_700_000_000_000,
      defaults: {
        provider: "codex",
        effort: "medium",
        sandbox: "read-only",
        cwd: "/tmp/wf-workspace",
        concurrency: 2,
        maxAgents: 20,
        maxFanout: 8,
        budgetOutputTokens: null,
      },
      sandboxCeiling: "workspace-write",
      journal: [],
      execTimeoutMs: null,
    });
  });

  it("carries a run-level model override and null args explicitly", async () => {
    const harness = await createWorkflowDispatchHarness();
    const command = buildStartCommand({
      argsJson: null,
      defaults: {
        ...buildStartCommand().defaults,
        model: "gpt-5",
      },
    });

    await dispatchCommand(command, harness.options);

    expect(harness.target.startCalls[0]).toMatchObject({
      args: undefined,
      defaults: expect.objectContaining({ model: "gpt-5" }),
    });
  });

  it("maps a manager script rejection to the typed script_invalid error", async () => {
    const harness = await createWorkflowDispatchHarness();
    harness.target.startResult = {
      accepted: false,
      code: "script_invalid",
      message: "meta must be a pure object literal",
    };

    await expect(
      dispatchCommand(buildStartCommand(), harness.options),
    ).rejects.toMatchObject({
      code: "script_invalid",
      message: "meta must be a pure object literal",
      name: "ExpectedCommandDispatchError",
    });
  });

  it("acks a redelivered start without re-running once the run dir is terminal", async () => {
    const harness = await createWorkflowDispatchHarness();
    const command = buildStartCommand();
    const runDir = workflowRunDirPath(harness.dataDir, command.runId);
    await mkdir(runDir, { recursive: true });
    await writeWorkflowRunTerminalRecord(runDir, {
      eventType: "run/completed",
      settledAtMs: Date.now(),
    });

    const result = await dispatchCommand(command, harness.options);

    expect(result).toEqual({ accepted: true });
    expect(harness.target.startCalls).toHaveLength(0);
  });

  it("fetches the resume journal before spawning and preloads it", async () => {
    const entries = [journalEntry(0), journalEntry(1)];
    const harness = await createWorkflowDispatchHarness({ journal: entries });
    const command = buildStartCommand({ resume: { nonce: "resume-nonce-1" } });
    // An interrupted-but-resumable run can carry a stale settle record from a
    // PREVIOUS segment (e.g. a history-only run/cancelled the server's
    // transition table refused). A fresh resume (no matching marker) must
    // clear it, not treat it as already-settled.
    const runDir = workflowRunDirPath(harness.dataDir, command.runId);
    await mkdir(runDir, { recursive: true });
    await writeWorkflowRunTerminalRecord(runDir, {
      eventType: "run/failed",
      settledAtMs: Date.now(),
    });

    const result = await dispatchCommand(command, harness.options);

    expect(result).toEqual({ accepted: true });
    expect(harness.journalFetches).toEqual(["wfr_dispatch_test"]);
    expect(harness.target.startCalls[0]).toMatchObject({ journal: entries });
    await expect(readWorkflowRunTerminalRecord(runDir)).resolves.toBeNull();
  });

  it("acks a redelivered resume whose segment already settled, without re-running (nonce-scoped)", async () => {
    const harness = await createWorkflowDispatchHarness();
    const command = buildStartCommand({ resume: { nonce: "resume-nonce-1" } });
    const runDir = workflowRunDirPath(harness.dataDir, command.runId);

    // First delivery: journal fetched, marker written, runner "spawned".
    await expect(dispatchCommand(command, harness.options)).resolves.toEqual({
      accepted: true,
    });
    expect(harness.target.startCalls).toHaveLength(1);
    expect(harness.journalFetches).toEqual(["wfr_dispatch_test"]);

    // The resumed segment settles (the manager records the terminal settle
    // at child cleanup), then the daemon dies before posting the command
    // result and the SAME command is redelivered.
    await writeWorkflowRunTerminalRecord(runDir, {
      eventType: "run/failed",
      settledAtMs: Date.now(),
    });
    await expect(dispatchCommand(command, harness.options)).resolves.toEqual({
      accepted: true,
    });
    // No second spawn, no second journal fetch, record left intact.
    expect(harness.target.startCalls).toHaveLength(1);
    expect(harness.journalFetches).toEqual(["wfr_dispatch_test"]);
    await expect(readWorkflowRunTerminalRecord(runDir)).resolves.not.toBeNull();

    // A genuinely NEW resume operation (fresh nonce) clears the stale record
    // and re-runs.
    const freshResume = buildStartCommand({
      resume: { nonce: "resume-nonce-2" },
    });
    await expect(
      dispatchCommand(freshResume, harness.options),
    ).resolves.toEqual({ accepted: true });
    expect(harness.target.startCalls).toHaveLength(2);
    await expect(readWorkflowRunTerminalRecord(runDir)).resolves.toBeNull();
  });

  it("fails a resume with journal_fetch_failed before any side effect", async () => {
    const harness = await createWorkflowDispatchHarness({
      journalError: new Error("server unreachable"),
    });
    const command = buildStartCommand({ resume: { nonce: "resume-nonce-1" } });
    const runDir = workflowRunDirPath(harness.dataDir, command.runId);
    await mkdir(runDir, { recursive: true });
    await writeWorkflowRunTerminalRecord(runDir, {
      eventType: "run/failed",
      settledAtMs: Date.now(),
    });

    await expect(
      dispatchCommand(command, harness.options),
    ).rejects.toMatchObject({
      code: "journal_fetch_failed",
      name: "ExpectedCommandDispatchError",
    });
    expect(harness.target.startCalls).toHaveLength(0);
    // Fetch-before-side-effect: the terminal record survives a failed fetch.
    await expect(readWorkflowRunTerminalRecord(runDir)).resolves.not.toBeNull();
  });

  it("rejects a resume under a different key scheme without fetching", async () => {
    const harness = await createWorkflowDispatchHarness();
    const command = buildStartCommand({
      resume: { nonce: "resume-nonce-1" },
      keyVersion: "bb0-legacy",
    });

    await expect(
      dispatchCommand(command, harness.options),
    ).rejects.toMatchObject({
      code: "resume_preconditions_failed",
      name: "ExpectedCommandDispatchError",
    });
    expect(harness.journalFetches).toEqual([]);
    expect(harness.target.startCalls).toHaveLength(0);
  });

  it("rejects unparseable argsJson with invalid_args", async () => {
    const harness = await createWorkflowDispatchHarness();

    await expect(
      dispatchCommand(
        buildStartCommand({ argsJson: "{not json" }),
        harness.options,
      ),
    ).rejects.toMatchObject({ code: "invalid_args" });
    expect(harness.target.startCalls).toHaveLength(0);
  });

  it("acks a redelivery after the run settles for real, without a second spawn", async () => {
    const dataDir = await makeTempDir("bb-workflow-dispatch-real-");
    const workDir = join(dataDir, "work");
    await mkdir(workDir, { recursive: true });
    const workers: RecordingWorker[] = [];
    const manager = new WorkflowRunManager({
      dataDir,
      logger: silentLogger,
      workflowAgentShellEnv: { PATH: "/usr/bin:/bin" },
      onRunEvent: () => undefined,
      maxLiveProviderProcesses: 4,
      worktreeSetupTimeoutMs: 60_000,
      turnStallTimeoutMs: 60_000,
      cancelEscalationGraceMs: 10_000,
      createWorker: () => {
        const worker = new RecordingWorker();
        workers.push(worker);
        return worker;
      },
    });
    const options = makeDispatchOptions({
      dataDir,
      runtimeManager: new RuntimeManager({
        provisionWorkspace: async () => createFakeWorkspace(workDir).workspace,
      }),
      workflowRunManager: manager,
      fetchWorkflowRunJournal: async () => [],
    });
    const command = buildStartCommand({
      runId: "wfr_real_redelivery",
      workspacePath: workDir,
    });
    const runDir = workflowRunDirPath(dataDir, command.runId);

    try {
      await expect(dispatchCommand(command, options)).resolves.toEqual({
        accepted: true,
      });

      // Wait for the run to settle: the FakeWorker completes the single agent
      // and the manager records the terminal settle at child cleanup.
      const deadline = Date.now() + 30_000;
      while ((await readWorkflowRunTerminalRecord(runDir)) === null) {
        if (Date.now() > deadline) {
          throw new Error("workflow run never recorded a terminal settle");
        }
        await sleep(50);
      }
      await expect(readWorkflowRunTerminalRecord(runDir)).resolves.toMatchObject(
        { eventType: "run/completed" },
      );

      // Durable redelivery after settle: ack, no second runner, no re-run.
      await expect(dispatchCommand(command, options)).resolves.toEqual({
        accepted: true,
      });
      expect(workers).toHaveLength(1);
      expect(workers[0]?.specs).toHaveLength(1);
    } finally {
      await manager.shutdown();
    }
  }, 60_000);
});

describe("workflow.cancel dispatch", () => {
  it("passes the manager's live-run answer through", async () => {
    const harness = await createWorkflowDispatchHarness();

    harness.target.cancelResult = true;
    await expect(
      dispatchCommand(
        { type: "workflow.cancel", runId: "wfr_live" },
        harness.options,
      ),
    ).resolves.toEqual({ accepted: true });

    harness.target.cancelResult = false;
    await expect(
      dispatchCommand(
        { type: "workflow.cancel", runId: "wfr_gone" },
        harness.options,
      ),
    ).resolves.toEqual({ accepted: false });

    expect(harness.target.cancelCalls).toEqual(["wfr_live", "wfr_gone"]);
  });
});

describe("workflow registry RPC dispatch", () => {
  it("lists and resolves workflows across tiers", async () => {
    const harness = await createWorkflowDispatchHarness();
    const rootPath = await makeTempDir("bb-workflow-dispatch-root-");
    await mkdir(join(rootPath, ".git"), { recursive: true });
    const projectDir = join(rootPath, ".bb", "workflows");
    await mkdir(projectDir, { recursive: true });
    const source = `export const meta = { name: "triage", description: "triage issues", whenToUse: "bug triage" };
return await agent("triage");
`;
    await writeFile(join(projectDir, "triage.workflow.js"), source);

    const listed = await dispatchOnlineRpcCommand(
      { type: "workflow.list", rootPath },
      harness.options,
    );
    expect(listed.workflows).toContainEqual({
      name: "triage",
      description: "triage issues",
      whenToUse: "bug triage",
      tier: "project",
    });
    expect(
      listed.workflows.some((workflow) => workflow.tier === "builtin"),
    ).toBe(true);

    const resolved = await dispatchOnlineRpcCommand(
      { type: "workflow.resolve", rootPath, name: "triage" },
      harness.options,
    );
    expect(resolved).toEqual({
      name: "triage",
      content: source,
      sha256: createHash("sha256").update(source).digest("hex"),
    });
  });

  it("reports workflow_not_found for unknown names", async () => {
    const harness = await createWorkflowDispatchHarness();
    const rootPath = await makeTempDir("bb-workflow-dispatch-root-");
    await mkdir(join(rootPath, ".git"), { recursive: true });

    await expect(
      dispatchOnlineRpcCommand(
        { type: "workflow.resolve", rootPath, name: "missing" },
        harness.options,
      ),
    ).rejects.toMatchObject({
      code: "workflow_not_found",
      name: "ExpectedCommandDispatchError",
    });
  });
});
