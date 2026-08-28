// The gate's decision table, driven through the fake plugin host: settings in,
// `listRunning` stubbed, verdicts out.
//
// The plugin is now settings-parse + one query + a comparison, so the table
// below IS the plugin. Settings parsing itself is covered by limits.test.ts.

import type {
  BbPluginApi,
  PluginDispatchAttemptKind,
  PluginDispatchGateContext,
  PluginThreadEventPayloads,
} from "@get-bb/plugin-sdk";
import {
  createFakePluginHost,
  makeThreadResponse,
} from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import plugin from "./server.js";

type ThreadResponse = PluginThreadEventPayloads["thread.created"]["thread"];
type HostRecord = Awaited<
  ReturnType<BbPluginApi["sdk"]["hosts"]["list"]>
>[number];
type RunningThread = Awaited<
  ReturnType<BbPluginApi["sdk"]["threads"]["listRunning"]>
>[number];

const PLUGIN_ID = "concurrency-limit";

function hostRecord(id: string, name = id): HostRecord {
  return {
    id,
    name,
    type: "persistent",
    status: "connected",
    maxPermissionMode: "full",
    lastSeenAt: null,
    lastRejectedProtocolVersion: null,
    createdAt: 1,
    updatedAt: 1,
  };
}

const PROJECT = {
  id: "proj_1",
  kind: "standard" as const,
  name: "bb",
  gitRemoteUrl: null,
  createdAt: 1,
  updatedAt: 1,
};

/** A row of `threads.listRunning()`. */
function running(overrides: Partial<RunningThread> = {}): RunningThread {
  return { id: "thr_running", hostId: "host-a", ...overrides };
}

interface GateContextOverrides {
  hostId?: string | null;
  hostName?: string;
  thread?: Partial<ThreadResponse>;
  attempt?: PluginDispatchAttemptKind;
}

function dispatchContext(
  overrides: GateContextOverrides = {},
): PluginDispatchGateContext<"dispatch"> {
  const hostId = overrides.hostId === undefined ? "host-a" : overrides.hostId;
  const thread = makeThreadResponse({
    id: "thr_1",
    status: "pending",
    ...overrides.thread,
  });
  return {
    stage: "dispatch",
    thread,
    attempt: overrides.attempt ?? "start-turn",
    queuedMessage: null,
    project: PROJECT,
    environment: null,
    host:
      hostId === null ? null : hostRecord(hostId, overrides.hostName ?? hostId),
    input: { blocks: [], text: "go" },
    requestedExecution: {
      providerId: "codex",
      model: null,
      reasoningLevel: null,
      serviceTier: null,
      permissionMode: null,
    },
    executionSources: {
      providerId: null,
      model: null,
      reasoningLevel: null,
      serviceTier: null,
      permissionMode: null,
    },
    origin: null,
    originPluginId: null,
    startedOnBehalfOf: null,
    parentThreadId: null,
  };
}

interface SetupOptions {
  settings?: Record<string, string>;
  running?: RunningThread[];
}

async function setup(options: SetupOptions = {}) {
  const { bb, harness } = createFakePluginHost({
    pluginId: PLUGIN_ID,
    settings: options.settings ?? {},
    sdk: {
      threads: { listRunning: async () => options.running ?? [] },
    },
  });
  await plugin(bb);
  const gate = harness.registrations.dispatchGates.dispatch;
  if (gate === null) throw new Error("the dispatch gate was not registered");
  return { bb, gate, harness };
}

describe("registration", () => {
  it("changes nothing until a limit is configured", async () => {
    const { gate, harness } = await setup({
      running: [running({ id: "a" }), running({ id: "b" })],
    });

    await expect(gate(dispatchContext())).resolves.toEqual({
      action: "proceed",
    });
    // Unconfigured means it must not even ask: installing this plugin cannot
    // put a query on every dispatch in the server.
    expect(harness.sdk.callsTo("threads.listRunning")).toHaveLength(0);
  });

  it("reports an unparseable limit instead of throwing, and enforces the good one", async () => {
    const { gate, harness } = await setup({
      settings: {
        maxConcurrentThreads: "lots",
        maxConcurrentThreadsPerHost: "1",
      },
      running: [running()],
    });

    expect(harness.needsConfigurationMessages).toEqual([
      'Max concurrent threads must be a whole number of threads (for example 4), or empty for no limit. Got "lots".',
    ]);
    await expect(gate(dispatchContext())).resolves.toEqual({
      action: "wait",
      reason: "1 of 1 running on host host-a",
    });
  });
});

describe("the dispatch gate", () => {
  it("waits once the running set has filled the global pool", async () => {
    const { gate } = await setup({
      settings: { maxConcurrentThreads: "2" },
      running: [running({ id: "a" }), running({ id: "b" })],
    });

    await expect(gate(dispatchContext())).resolves.toEqual({
      action: "wait",
      reason: "2 of 2 running on all hosts",
    });
  });

  it("holds at the limit, not one past it", async () => {
    const { gate } = await setup({
      settings: { maxConcurrentThreads: "2" },
      running: [running({ id: "a" })],
    });

    await expect(gate(dispatchContext())).resolves.toEqual({
      action: "proceed",
    });
  });

  it("pauses everything at a limit of zero", async () => {
    const { gate } = await setup({
      settings: { maxConcurrentThreads: "0" },
      running: [],
    });

    await expect(gate(dispatchContext())).resolves.toEqual({
      action: "wait",
      reason: "0 of 0 running on all hosts",
    });
  });

  it("gates a child and a plugin-spawned thread like any other", async () => {
    // The limit is uniform in both directions: provenance changes neither what
    // the pool contains nor who has to wait for it. The user asked for N
    // threads, so N is what runs — a workflow's children queue like everyone
    // else, and a tight limit can wedge a parent that waits on them.
    const { gate } = await setup({
      settings: { maxConcurrentThreads: "1" },
      running: [running({ id: "a" })],
    });

    for (const thread of [
      { parentThreadId: "thr_parent" },
      { originPluginId: "workflows" },
    ]) {
      await expect(gate(dispatchContext({ thread }))).resolves.toEqual({
        action: "wait",
        reason: "1 of 1 running on all hosts",
      });
    }
  });

  it("keeps separate host pools separate", async () => {
    const { gate } = await setup({
      settings: { maxConcurrentThreadsPerHost: "1" },
      running: [running({ id: "a", hostId: "host-a" })],
    });

    await expect(gate(dispatchContext({ hostId: "host-b" }))).resolves.toEqual({
      action: "proceed",
    });
    await expect(gate(dispatchContext({ hostId: "host-a" }))).resolves.toEqual({
      action: "wait",
      reason: "1 of 1 running on host host-a",
    });
  });

  it("skips the host limit entirely when no host is chosen yet", async () => {
    const { gate } = await setup({
      settings: { maxConcurrentThreadsPerHost: "1" },
      running: [running({ id: "a", hostId: "host-a" })],
    });

    await expect(gate(dispatchContext({ hostId: null }))).resolves.toEqual({
      action: "proceed",
    });
  });

  it("reports the global limit when both are full", async () => {
    const { gate } = await setup({
      settings: {
        maxConcurrentThreads: "1",
        maxConcurrentThreadsPerHost: "1",
      },
      running: [running({ id: "a", hostId: "host-a" })],
    });

    await expect(gate(dispatchContext())).resolves.toEqual({
      action: "wait",
      reason: "1 of 1 running on all hosts",
    });
  });

  it("names the host by its display name, falling back to its id", async () => {
    const { gate } = await setup({
      settings: { maxConcurrentThreadsPerHost: "1" },
      running: [running({ id: "a", hostId: "host-a" })],
    });

    await expect(
      gate(dispatchContext({ hostName: "Michael's Mac" })),
    ).resolves.toEqual({
      action: "wait",
      reason: "1 of 1 running on host Michael's Mac",
    });
    await expect(gate(dispatchContext({ hostName: "   " }))).resolves.toEqual({
      action: "wait",
      reason: "1 of 1 running on host host-a",
    });
  });

  it("does not re-admit a thread that is already running", async () => {
    const { gate } = await setup({
      settings: { maxConcurrentThreads: "1" },
      running: [running({ id: "thr_1" })],
    });

    for (const status of ["active", "starting"] as const) {
      await expect(
        gate(dispatchContext({ thread: { status } })),
      ).resolves.toEqual({ action: "proceed" });
    }
  });

  it("lets a join-turn attempt through even when the pool is full", async () => {
    const { gate } = await setup({
      settings: { maxConcurrentThreads: "1" },
      running: [running({ id: "a" })],
    });

    await expect(
      gate(dispatchContext({ attempt: "join-turn", thread: { status: "idle" } })),
    ).resolves.toEqual({ action: "proceed" });
  });

  it("parks a start-turn attempt on an idle thread when the pool is full", async () => {
    const { gate } = await setup({
      settings: { maxConcurrentThreads: "1" },
      running: [running({ id: "a" })],
    });

    await expect(
      gate(dispatchContext({ thread: { status: "idle" } })),
    ).resolves.toEqual({
      action: "wait",
      reason: "1 of 1 running on all hosts",
    });
  });

  it("re-reads the running set on every pass rather than caching it", async () => {
    // The whole point of the collapse: no tally survives between passes, so a
    // thread that finished between two attempts is visible immediately.
    let rows: RunningThread[] = [running({ id: "a" })];
    const { bb, harness } = createFakePluginHost({
      pluginId: PLUGIN_ID,
      settings: { maxConcurrentThreads: "1" },
      sdk: { threads: { listRunning: async () => rows } },
    });
    await plugin(bb);
    const gate = harness.registrations.dispatchGates.dispatch;
    if (gate === null) throw new Error("the dispatch gate was not registered");

    await expect(gate(dispatchContext())).resolves.toMatchObject({
      action: "wait",
    });
    rows = [];
    await expect(gate(dispatchContext())).resolves.toEqual({
      action: "proceed",
    });
  });

  it("registers nothing but the gate", async () => {
    // No lifecycle subscriptions, no queue subscriptions, no background
    // service: a freed slot is core's signal to re-attempt, not the plugin's.
    const { harness } = await setup({
      settings: { maxConcurrentThreads: "1" },
    });

    expect(
      Object.values(harness.registrations.threadEventHandlers).filter(
        (count) => count > 0,
      ),
    ).toEqual([]);
    expect(harness.registrations.services).toEqual([]);
  });
});
