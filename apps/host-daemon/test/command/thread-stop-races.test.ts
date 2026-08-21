import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createAgentRuntime,
  type AgentRuntime,
  type AgentRuntimeProcessExitInfo,
} from "@bb/agent-runtime";
import {
  createScriptedEchoRequestRecord,
  type ScriptedEchoLaunchScript,
  type ScriptedEchoRequestRecord,
} from "@bb/agent-runtime/test";
import { buildPluginHost, resolvePluginBuildToolchain } from "@bb/plugin-build";
import {
  encodeClientTurnRequestIdNumber,
  type ClientTurnRequestId,
  type ThreadEvent,
} from "@bb/domain";
import type {
  HostDaemonBridgeLaunch,
  HostDaemonOnlineRpcResponseMessage,
} from "@bb/host-daemon-contract";
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
 * runtime (the scripted echo bridge, a real provider subprocess behind the
 * real bridge-protocol adapter): the stop wait is event-driven via
 * runtime.waitForActiveTurn, crash clearing is owned by the runtime, and
 * repeated stops are idempotent.
 */

const ENVIRONMENT_ID = "env-stop-race";
const THREAD_STOP_ACTIVE_TURN_WAIT_MS = 5_000;

interface RaceHarness {
  dispatchOptions: CommandDispatchOptions;
  events: ThreadEvent[];
  exits: AgentRuntimeProcessExitInfo[];
  /** The scripted echo bridge launch every command in this harness carries. */
  launch: HostDaemonBridgeLaunch;
  manager: RuntimeManager;
  /** Every request the bridge processes handled (the provider's view). */
  record: ScriptedEchoRequestRecord;
  requireRuntime: () => AgentRuntime;
  workspacePath: string;
}

interface ThreadStartArgs {
  threadId: string;
  providerId?: string;
  inputText?: string;
  bridgeLaunch?: HostDaemonBridgeLaunch;
}

interface TurnSubmitArgs {
  threadId: string;
  inputText: string;
}

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

/** Lets queued microtasks (the dispatch chain up to its turn waiter) run. */
function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

/**
 * The scripted echo bridge as the daemon receives a plugin provider: a built
 * `bb.host` artifact named by digest and byte length on the wire, fetched and
 * hash-verified into the daemon's cache before the bootstrap imports it.
 * Built once per file from source, like the plugin runtime builds it.
 */
let scriptedEchoArtifact: Promise<{
  bytes: Uint8Array;
  digest: string;
}> | null = null;

function buildScriptedEchoArtifact(): Promise<{
  bytes: Uint8Array;
  digest: string;
}> {
  scriptedEchoArtifact ??= (async () => {
    const rootDir = fileURLToPath(
      new URL("../../../../tests/scripted-echo-provider", import.meta.url),
    );
    const toolchain = await resolvePluginBuildToolchain(
      path.join(os.tmpdir(), "bb-plugin-build-toolchain"),
    );
    const build = await buildPluginHost(rootDir, "0.0.0-test", toolchain);
    return {
      bytes: await readFile(build.jsPath),
      digest: build.artifactDigest,
    };
  })();
  return scriptedEchoArtifact;
}

/**
 * The launch the dispatch commands carry, the way the server attaches a
 * plugin provider's artifact. `scripted` rides `providerOptions` like any
 * provider-owned static.
 */
async function scriptedEchoDispatchLaunch(
  options: { pluginId?: string; scripted?: ScriptedEchoLaunchScript } = {},
): Promise<HostDaemonBridgeLaunch> {
  const artifact = await buildScriptedEchoArtifact();
  return {
    pluginId: options.pluginId ?? "provider-scripted-echo",
    source: {
      kind: "artifact",
      digest: artifact.digest,
      byteLength: artifact.bytes.byteLength,
    },
    providerOptions:
      options.scripted === undefined
        ? {}
        : { scripted: JSON.parse(JSON.stringify(options.scripted)) },
    envPassthrough: [],
    capabilities: {
      experimental_providerInstallation: false,
      supportsServiceTier: false,
      permissionModes: ["accept-edits", "auto", "full"],
      supportsThreadArchive: true,
      supportsThreadRename: true,
      fork: "checkpoint",
    },
  };
}

async function createRaceHarness(): Promise<RaceHarness> {
  const workspacePath = await makeTempDir("bb-stop-race-workspace-");
  const events: ThreadEvent[] = [];
  const exits: AgentRuntimeProcessExitInfo[] = [];
  const record = createScriptedEchoRequestRecord();
  let runtime: AgentRuntime | null = null;
  const manager = new RuntimeManager({
    provisionWorkspace: async () =>
      createFakeWorkspace(workspacePath).workspace,
    createRuntime: (options) => {
      runtime = createAgentRuntime({
        ...options,
        env: { ...options.env, ...record.env },
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

  const artifact = await buildScriptedEchoArtifact();
  const dataDir = await makeTempDir("bb-stop-race-daemon-data-");
  return {
    dispatchOptions: makeDispatchOptions({
      runtimeManager: manager,
      dataDir,
      // The daemon's artifact fetcher, serving the built scripted echo bridge
      // for whichever plugin id a launch names.
      fetchPluginHostArtifact: async ({ digest }) => {
        if (digest !== artifact.digest) {
          throw new Error(`unknown plugin host artifact ${digest}`);
        }
        return artifact.bytes;
      },
    }),
    events,
    exits,
    launch: await scriptedEchoDispatchLaunch(),
    manager,
    record,
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
    bridgeLaunch: args.bridgeLaunch ?? harness.launch,
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
      providerOptions: {},
      permissionMode: "full",
      permissionScope: "full",
      approvalReviewer: null,
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
    bridgeLaunch: harness.launch,
    type: "turn.submit",
    environmentId: ENVIRONMENT_ID,
    threadId: args.threadId,
    requestId: nextClientRequestId(),
    input: [{ type: "text", text: args.inputText, mentions: [] }],
    options: {
      model: "fake-model",
      serviceTier: "default",
      reasoningLevel: "medium",
      providerOptions: {},
      permissionMode: "full",
      permissionScope: "full",
      approvalReviewer: null,
      permissionEscalation: null,
    },
    resumeContext: {
      bridgeLaunch: harness.launch,
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
    intent: "interrupt",
    environmentId: ENVIRONMENT_ID,
    threadId,
  };
}

/** The `thread/stop` requests that reached a bridge process, in order. */
function recordedThreadStops(harness: RaceHarness): Record<string, unknown>[] {
  return harness.record
    .read()
    .filter((request) => request.method === "thread/stop")
    .map((request) => request.params ?? {});
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
      turnSubmitCommand(harness, {
        threadId: "t-race",
        inputText: "delay:60000",
      }),
      harness.dispatchOptions,
    );
    await expect(stopPromise).resolves.toEqual({ providerCheckpointId: null });
    await expect(submitPromise).resolves.toEqual({ appliedAs: "new-turn" });

    // The wire carries the bridge's own turn id, reverse-mapped by the
    // adapter from the assembler-minted id the runtime tracks.
    expect(recordedThreadStops(harness)).toEqual([
      expect.objectContaining({
        threadId: "t-race",
        intent: "interrupt",
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

    await expect(stopPromise).resolves.toEqual({ providerCheckpointId: null });
    // The stop reached the provider as a no-turn stop and released the thread.
    expect(recordedThreadStops(harness)).toEqual([
      expect.objectContaining({
        threadId: "t-idle",
        intent: "release",
        activeTurnId: null,
      }),
    ]);
    expect(runtime.hasThread("t-idle")).toBe(false);
    expect(
      harness.events.filter((event) => event.type === "turn/completed"),
    ).toEqual([]);
  });

  it("clears the active turn when the provider crashes mid-turn so a later stop noops", async () => {
    const harness = await createRaceHarness();
    // A second provider whose bridge dies mid-turn: it acknowledges the turn
    // (turn/started reaches the runtime) and then exits.
    const crasherLaunch = await scriptedEchoDispatchLaunch({
      pluginId: "provider-crasher",
      scripted: { exitAfter: "turn/start" },
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
        bridgeLaunch: crasherLaunch,
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
        providerThreadId: "prov-1",
        activeTurnId: expect.any(String),
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
    ).resolves.toEqual({ providerCheckpointId: null });
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
        expect(runtime.getActiveTurnId("t-double")).not.toBeNull();
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
