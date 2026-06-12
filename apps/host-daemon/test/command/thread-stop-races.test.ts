import path from "node:path";
import { writeFile } from "node:fs/promises";
import type {
  AgentRuntime,
  AgentRuntimeProcessExitInfo,
} from "@bb/agent-runtime";
import {
  createAgentRuntimeWithAdapters,
  createFakeAdapter,
  type ProviderAdapter,
  type ProviderAdapterFactory,
} from "@bb/agent-runtime/test";
import {
  encodeClientTurnRequestIdNumber,
  type ClientTurnRequestId,
  type ThreadEvent,
} from "@bb/domain";
import type { HostDaemonOnlineRpcResponseMessage } from "@bb/host-daemon-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import { dispatchCommand } from "../../src/command-dispatch.js";
import {
  noopEventSink,
  type CommandDispatchOptions,
  type CommandOf,
} from "../../src/command-dispatch-support.js";
import { CommandRouter } from "../../src/command-router.js";
import { RuntimeManager } from "../../src/runtime-manager.js";
import {
  cleanupTempDirs,
  createFakeWorkspace,
  makeDispatchOptions,
  makeTempDir,
  unexpectedProjectAttachmentFetch,
} from "./dispatch-helpers.js";

/**
 * Race coverage for the thread.stop dispatch flow against the REAL agent
 * runtime (fake provider adapter, real provider subprocess): the stop wait is
 * event-driven via runtime.waitForActiveTurn, crash clearing is owned by the
 * runtime, and repeated stops are idempotent.
 */

const ENVIRONMENT_ID = "env-stop-race";
const THREAD_STOP_ACTIVE_TURN_WAIT_MS = 5_000;

type RecordedAdapterCommand = Parameters<ProviderAdapter["buildCommandPlan"]>[0];

interface RaceHarnessArgs {
  adapterFactory?: ProviderAdapterFactory;
}

interface RaceHarness {
  dispatchOptions: CommandDispatchOptions;
  events: ThreadEvent[];
  exits: AgentRuntimeProcessExitInfo[];
  manager: RuntimeManager;
  recordedCommands: RecordedAdapterCommand[];
  requireRuntime: () => AgentRuntime;
  workspacePath: string;
}

interface ThreadStartArgs {
  threadId: string;
  providerId?: string;
  inputText?: string;
}

interface TurnSubmitArgs {
  threadId: string;
  inputText: string;
}

const CRASH_MID_TURN_PROVIDER_SCRIPT = `
const readline = require("node:readline");

function send(message) {
  process.stdout.write(JSON.stringify(message) + "\\n");
}

const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    send({ jsonrpc: "2.0", id: message.id, result: { ok: true } });
    return;
  }
  if (message.method === "thread/start") {
    const threadId = message.params.threadId;
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: { providerThreadId: "prov-crash" },
    });
    send({
      jsonrpc: "2.0",
      method: "thread/identity",
      params: { threadId, providerThreadId: "prov-crash" },
    });
    return;
  }
  if (message.method === "turn/start") {
    const threadId = message.params.threadId;
    send({ jsonrpc: "2.0", id: message.id, result: { ok: true } });
    send({
      jsonrpc: "2.0",
      method: "turn/started",
      params: { threadId, turnId: "turn-1", providerThreadId: "prov-crash" },
    });
    // Die mid-turn, after the turn/started handoff has been flushed.
    setTimeout(() => process.exit(1), 50);
  }
});
`;

const managers: RuntimeManager[] = [];
let nextClientRequestIdValue = 1;
let nextRpcRequestIdValue = 1;

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(managers.splice(0).map((manager) => manager.shutdownAll()));
  await cleanupTempDirs();
});

function nextClientRequestId(): ClientTurnRequestId {
  const requestId = encodeClientTurnRequestIdNumber({
    value: nextClientRequestIdValue,
  });
  nextClientRequestIdValue += 1;
  return requestId;
}

function withRecordedCommands(
  adapter: ProviderAdapter,
  recordedCommands: RecordedAdapterCommand[],
): ProviderAdapter {
  return {
    ...adapter,
    buildCommandPlan(command) {
      recordedCommands.push(command);
      return adapter.buildCommandPlan(command);
    },
  };
}

/** Lets queued microtasks (the dispatch chain up to its turn waiter) run. */
function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

async function createRaceHarness(
  args: RaceHarnessArgs = {},
): Promise<RaceHarness> {
  const workspacePath = await makeTempDir("bb-stop-race-workspace-");
  const events: ThreadEvent[] = [];
  const exits: AgentRuntimeProcessExitInfo[] = [];
  const recordedCommands: RecordedAdapterCommand[] = [];
  const adapterFactory: ProviderAdapterFactory =
    args.adapterFactory ?? (() => createFakeAdapter());
  let runtime: AgentRuntime | null = null;
  const manager = new RuntimeManager({
    provisionWorkspace: async () => createFakeWorkspace(workspacePath).workspace,
    createRuntime: (options) => {
      runtime = createAgentRuntimeWithAdapters({
        ...options,
        adapterFactory: (providerId, factoryOptions) =>
          withRecordedCommands(
            adapterFactory(providerId, factoryOptions),
            recordedCommands,
          ),
      });
      return runtime;
    },
    onEvent: ({ event }) => {
      events.push(event);
    },
    onProcessExit: (info) => {
      exits.push(info);
    },
  });
  managers.push(manager);

  return {
    dispatchOptions: makeDispatchOptions({ runtimeManager: manager }),
    events,
    exits,
    manager,
    recordedCommands,
    requireRuntime: () => {
      if (!runtime) {
        throw new Error("Runtime has not been created yet");
      }
      return runtime;
    },
    workspacePath,
  };
}

function threadStartCommand(
  harness: RaceHarness,
  args: ThreadStartArgs,
): CommandOf<"thread.start"> {
  return {
    type: "thread.start",
    environmentId: ENVIRONMENT_ID,
    threadId: args.threadId,
    workspaceContext: {
      workspacePath: harness.workspacePath,
      workspaceProvisionType: "unmanaged",
    },
    projectId: "project-stop-race",
    providerId: args.providerId ?? "fake",
    requestId: nextClientRequestId(),
    input:
      args.inputText === undefined
        ? []
        : [{ type: "text", text: args.inputText, mentions: [] }],
    options: {
      model: "fake-model",
      serviceTier: "default",
      reasoningLevel: "medium",
      workflowsEnabled: false,
      permissionMode: "full",
      permissionEscalation: null,
    },
    instructions: "Be a helpful coding agent.",
    dynamicTools: [],
    injectedSkillSources: [],
    instructionMode: "append",
  };
}

function turnSubmitCommand(
  harness: RaceHarness,
  args: TurnSubmitArgs,
): CommandOf<"turn.submit"> {
  return {
    type: "turn.submit",
    environmentId: ENVIRONMENT_ID,
    threadId: args.threadId,
    requestId: nextClientRequestId(),
    input: [{ type: "text", text: args.inputText, mentions: [] }],
    options: {
      model: "fake-model",
      serviceTier: "default",
      reasoningLevel: "medium",
      workflowsEnabled: false,
      permissionMode: "full",
      permissionEscalation: null,
    },
    resumeContext: {
      workspaceContext: {
        workspacePath: harness.workspacePath,
        workspaceProvisionType: "unmanaged",
      },
      projectId: "project-stop-race",
      providerId: "fake",
      providerThreadId: "prov-1",
      instructions: "Be a helpful coding agent.",
      dynamicTools: [],
      injectedSkillSources: [],
      instructionMode: "append",
    },
    target: { mode: "start" },
  };
}

function threadStopCommand(threadId: string): CommandOf<"thread.stop"> {
  return {
    type: "thread.stop",
    environmentId: ENVIRONMENT_ID,
    threadId,
  };
}

function recordedThreadStops(
  harness: RaceHarness,
): RecordedAdapterCommand[] {
  return harness.recordedCommands.filter(
    (command) => command.type === "thread/stop",
  );
}

function routerStop(
  router: CommandRouter,
  threadId: string,
): Promise<HostDaemonOnlineRpcResponseMessage> {
  const requestId = `stop-race-rpc-${nextRpcRequestIdValue}`;
  nextRpcRequestIdValue += 1;
  return router.handleOnlineRpcRequest({
    type: "host-rpc.request",
    requestId,
    command: threadStopCommand(threadId),
  });
}

describe("thread.stop race semantics", () => {
  it("resolves a stop dispatched before turn/started event-driven and stops the right turn", async () => {
    const harness = await createRaceHarness();
    await dispatchCommand(
      threadStartCommand(harness, { threadId: "t-race" }),
      harness.dispatchOptions,
    );
    const runtime = harness.requireRuntime();
    expect(runtime.hasThread("t-race")).toBe(true);
    expect(runtime.getActiveTurnId("t-race")).toBeNull();

    // Stop arrives while no turn is active yet: it must wait for the
    // turn/started observation, not poll and not give up.
    const stopPromise = dispatchCommand(
      threadStopCommand("t-race"),
      harness.dispatchOptions,
    );
    await flushMicrotasks();
    expect(recordedThreadStops(harness)).toHaveLength(0);

    // The turn now starts; its turn/started observation must release the stop.
    const submitPromise = dispatchCommand(
      turnSubmitCommand(harness, { threadId: "t-race", inputText: "delay:60000" }),
      harness.dispatchOptions,
    );
    await expect(stopPromise).resolves.toEqual({});
    await expect(submitPromise).resolves.toEqual({ appliedAs: "new-turn" });

    expect(recordedThreadStops(harness)).toEqual([
      expect.objectContaining({
        type: "thread/stop",
        threadId: "t-race",
        activeTurnId: "turn-1",
      }),
    ]);
    expect(harness.events).toContainEqual(
      expect.objectContaining({
        type: "turn/completed",
        threadId: "t-race",
        status: "interrupted",
      }),
    );
    expect(runtime.getActiveTurnId("t-race")).toBeNull();
    expect(runtime.hasThread("t-race")).toBe(false);
  });

  it("noops a stop after the turn-start wait times out without hanging", async () => {
    const harness = await createRaceHarness();
    await dispatchCommand(
      threadStartCommand(harness, { threadId: "t-idle" }),
      harness.dispatchOptions,
    );
    const runtime = harness.requireRuntime();
    expect(runtime.getActiveTurnId("t-idle")).toBeNull();

    // No turn ever starts, so the stop waits the full timeout. Fake timers
    // advance past it without spending the 5s in test time.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const stopPromise = dispatchCommand(
      threadStopCommand("t-idle"),
      harness.dispatchOptions,
    );
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(THREAD_STOP_ACTIVE_TURN_WAIT_MS);
    vi.useRealTimers();

    await expect(stopPromise).resolves.toEqual({});
    // The stop reached the provider as a no-turn stop and released the thread.
    expect(recordedThreadStops(harness)).toEqual([
      expect.objectContaining({
        type: "thread/stop",
        threadId: "t-idle",
        activeTurnId: null,
      }),
    ]);
    expect(runtime.hasThread("t-idle")).toBe(false);
    expect(
      harness.events.filter((event) => event.type === "turn/completed"),
    ).toEqual([]);
  });

  it("clears the active turn when the provider crashes mid-turn so a later stop noops", async () => {
    const crashDir = await makeTempDir("bb-stop-race-crash-");
    const crashScriptPath = path.join(crashDir, "crash-mid-turn-provider.cjs");
    await writeFile(crashScriptPath, CRASH_MID_TURN_PROVIDER_SCRIPT, "utf8");
    const harness = await createRaceHarness({
      adapterFactory: (providerId) =>
        providerId === "crasher"
          ? createFakeAdapter({ id: "crasher", scriptPath: crashScriptPath })
          : createFakeAdapter(),
    });
    // A healthy sibling provider keeps the environment entry alive across
    // the crash, so the follow-up stop exercises the dispatch path.
    await dispatchCommand(
      threadStartCommand(harness, { threadId: "t-healthy" }),
      harness.dispatchOptions,
    );
    await dispatchCommand(
      threadStartCommand(harness, {
        threadId: "t-crash",
        providerId: "crasher",
        inputText: "boom",
      }),
      harness.dispatchOptions,
    );
    const runtime = harness.requireRuntime();

    await vi.waitFor(
      () => {
        expect(
          harness.exits.some((info) => info.providerId === "crasher"),
        ).toBe(true);
      },
      { timeout: 5_000 },
    );
    const crashExit = harness.exits.find(
      (info) => info.providerId === "crasher",
    );
    // The exit snapshot proves the thread was mid-turn when the process died.
    expect(crashExit?.threads).toEqual([
      expect.objectContaining({
        threadId: "t-crash",
        providerThreadId: "prov-crash",
        activeTurnId: "turn-1",
      }),
    ]);
    // The runtime's own exit handling is the only clearing of that state.
    expect(runtime.getActiveTurnId("t-crash")).toBeNull();
    expect(runtime.hasThread("t-crash")).toBe(false);
    // The daemon synthesized the failure for the orphaned turn.
    expect(harness.events).toContainEqual(
      expect.objectContaining({
        type: "turn/completed",
        threadId: "t-crash",
        status: "failed",
      }),
    );

    await expect(
      dispatchCommand(threadStopCommand("t-crash"), harness.dispatchOptions),
    ).resolves.toEqual({});
    // The stop never reached a provider: the crashed thread is unknown.
    expect(recordedThreadStops(harness)).toHaveLength(0);
  });

  it("treats the second of two racing stops as an idempotent no-op", async () => {
    const harness = await createRaceHarness();
    const router = new CommandRouter({
      dataDir: "/tmp/bb-stop-race-data",
      eventSink: noopEventSink,
      fetchProjectAttachment: unexpectedProjectAttachmentFetch,
      logger: { debug: () => undefined, warn: () => undefined },
      runtimeManager: harness.manager,
      threadStorageRootPath: "/tmp/bb-stop-race-thread-storage",
    });
    await dispatchCommand(
      threadStartCommand(harness, {
        threadId: "t-double",
        inputText: "delay:60000",
      }),
      harness.dispatchOptions,
    );
    const runtime = harness.requireRuntime();
    await vi.waitFor(
      () => {
        expect(runtime.getActiveTurnId("t-double")).toBe("turn-1");
      },
      { timeout: 5_000 },
    );

    const [firstStop, secondStop] = await Promise.all([
      routerStop(router, "t-double"),
      routerStop(router, "t-double"),
    ]);

    expect(firstStop.ok).toBe(true);
    expect(secondStop.ok).toBe(true);
    // Only one stop reached the provider; the loser saw the thread already
    // forgotten and nooped.
    expect(recordedThreadStops(harness)).toHaveLength(1);
    expect(
      harness.events.filter(
        (event) =>
          event.type === "turn/completed" && event.threadId === "t-double",
      ),
    ).toEqual([
      expect.objectContaining({
        status: "interrupted",
      }),
    ]);
    expect(runtime.hasThread("t-double")).toBe(false);
  });
});
