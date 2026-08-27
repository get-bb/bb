// End-to-end wiring through the fake plugin host: settings in, gate verdicts
// out, lifecycle events driving the tally, and a freed slot releasing a hold.
// The arithmetic itself is covered in tally.test.ts / scope.test.ts; what this
// file checks is that the pieces are connected to the right inputs.

import type {
  BbPluginApi,
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
type HoldResponse = PluginThreadEventPayloads["dispatch.held"]["hold"];
type HostRecord = Awaited<
  ReturnType<BbPluginApi["sdk"]["hosts"]["list"]>
>[number];
type ThreadCountResponse = Awaited<
  ReturnType<BbPluginApi["sdk"]["threads"]["count"]>
>;

const PLUGIN_ID = "concurrency-limit";
const HOLDER = `plugin:${PLUGIN_ID}`;

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

function emptyCount(): ThreadCountResponse {
  return { total: 0, groups: [] };
}

function holdResponse(overrides: Partial<HoldResponse> = {}): HoldResponse {
  return {
    id: "hold_1",
    kind: "turn",
    threadId: "thr_held",
    holder: HOLDER,
    userReleasable: true,
    reason: "1 of 1 running on all hosts",
    payload: {
      kind: "inline",
      input: [{ type: "text", text: "hi", mentions: [] }],
      execution: {
        model: "gpt-5",
        permissionMode: "full",
        reasoningLevel: "medium",
        serviceTier: "default",
        source: "client/turn/start",
      },
      editable: true,
    },
    resumeAt: null,
    expectedReleaseAt: null,
    staleAfterMs: null,
    lastReportAt: null,
    createdAt: 1_000,
    releasedAt: null,
    releaseKind: null,
    ...overrides,
  };
}

interface GateContextOverrides {
  hostId?: string | null;
  parentThreadId?: string | null;
  originPluginId?: string | null;
}

function createContext(
  overrides: GateContextOverrides = {},
): PluginDispatchGateContext<"thread.create"> {
  const hostId = overrides.hostId === undefined ? "host-a" : overrides.hostId;
  return {
    stage: "thread.create",
    thread: null,
    project: PROJECT,
    environment: null,
    host: hostId === null ? null : hostRecord(hostId),
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
    originPluginId: overrides.originPluginId ?? null,
    startedOnBehalfOf: null,
    parentThreadId: overrides.parentThreadId ?? null,
    pluginInput: null,
    isReleaseReevaluation: false,
    hold: null,
  };
}

function submitContext(
  thread: ThreadResponse,
  overrides: GateContextOverrides = {},
): PluginDispatchGateContext<"turn.submit"> {
  return { ...createContext(overrides), stage: "turn.submit", thread };
}

interface SetupOptions {
  settings?: Record<string, string>;
  counts?: ThreadCountResponse;
  holds?: HoldResponse[];
  hosts?: HostRecord[];
}

async function setup(options: SetupOptions = {}) {
  const { bb, harness } = createFakePluginHost({
    pluginId: PLUGIN_ID,
    settings: options.settings ?? {},
    sdk: {
      threads: {
        count: async () => options.counts ?? emptyCount(),
        holds: { list: async () => options.holds ?? [] },
      },
      hosts: { list: async () => options.hosts ?? [hostRecord("host-a")] },
      environments: {
        get: async ({ environmentId }: { environmentId: string }) => ({
          id: environmentId,
          hostId: environmentId.replace("env-", "host-"),
        }),
      },
    },
  });
  await plugin(bb);
  return { bb, harness };
}

/** Run the reconciler exactly once, then stop it. */
async function reconcileOnce(
  harness: Awaited<ReturnType<typeof setup>>["harness"],
): Promise<void> {
  const service = harness.behavior.runService("reconciler");
  // The loop awaits its full reconcile before sleeping; yielding past the
  // pending SDK promises is enough to see the seeded state.
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  service.controller.abort();
  await service.done;
}

function createGate(harness: Awaited<ReturnType<typeof setup>>["harness"]) {
  const gate = harness.registrations.dispatchGates["thread.create"];
  if (gate === null) throw new Error("thread.create gate was not registered");
  return gate;
}

function submitGate(harness: Awaited<ReturnType<typeof setup>>["harness"]) {
  const gate = harness.registrations.dispatchGates["turn.submit"];
  if (gate === null) throw new Error("turn.submit gate was not registered");
  return gate;
}

describe("registration", () => {
  it("registers a gate at both stages", async () => {
    const { harness } = await setup();
    expect(harness.registrations.dispatchGates["thread.create"]).not.toBeNull();
    expect(harness.registrations.dispatchGates["turn.submit"]).not.toBeNull();
  });

  it("changes nothing until a limit is configured", async () => {
    // Installing the plugin must not alter dispatch behaviour; every limit
    // defaults to empty, which means unlimited.
    const { harness } = await setup();
    expect(await createGate(harness)(createContext())).toEqual({
      action: "proceed",
    });
    expect(harness.needsConfigurationMessages).toEqual([]);
  });

  it("reports an unparseable limit instead of throwing", async () => {
    // A gate that threw would fail every dispatch in the server with this
    // plugin named — a far worse outcome than an unenforced limit.
    const { harness } = await setup({
      settings: { maxConcurrentThreads: "a few" },
    });
    expect(harness.needsConfigurationMessages).toHaveLength(1);
    expect(harness.needsConfigurationMessages[0]).toContain(
      "Max concurrent threads",
    );
    expect(await createGate(harness)(createContext())).toEqual({
      action: "proceed",
    });
  });
});

describe("the create gate", () => {
  it("holds once its own proceeds have filled the pool", async () => {
    // Nothing is running and no event has fired: the only thing stopping the
    // second dispatch is the plugin counting the `proceed` it just returned.
    const { harness } = await setup({
      settings: { maxConcurrentThreads: "1" },
    });
    const gate = createGate(harness);
    expect(await gate(createContext())).toEqual({ action: "proceed" });
    expect(await gate(createContext())).toEqual({
      action: "hold",
      reason: "1 of 1 running on all hosts",
    });
  });

  it("exempts child and plugin-spawned threads from a full pool", async () => {
    const { harness } = await setup({
      settings: { maxConcurrentThreads: "0" },
    });
    const gate = createGate(harness);
    expect(await gate(createContext())).toEqual({
      action: "hold",
      reason: "0 of 0 running on all hosts",
    });
    expect(await gate(createContext({ parentThreadId: "thr_parent" }))).toEqual(
      { action: "proceed" },
    );
    expect(await gate(createContext({ originPluginId: "workflows" }))).toEqual({
      action: "proceed",
    });
  });

  it("keeps separate host pools separate", async () => {
    const { harness } = await setup({
      settings: { maxConcurrentThreadsPerHost: "1" },
      hosts: [hostRecord("host-a", "mac-mini"), hostRecord("host-b")],
    });
    await reconcileOnce(harness);
    const gate = createGate(harness);
    expect(await gate(createContext({ hostId: "host-a" }))).toEqual({
      action: "proceed",
    });
    expect(await gate(createContext({ hostId: "host-b" }))).toEqual({
      action: "proceed",
    });
    expect(await gate(createContext({ hostId: "host-a" }))).toEqual({
      action: "hold",
      // The reason uses the host's display name, not its id.
      reason: "1 of 1 running on host mac-mini",
    });
  });

  it("seeds from threads.count so threads that predate the plugin count", async () => {
    const { harness } = await setup({
      settings: { maxConcurrentThreads: "2" },
      counts: {
        total: 1,
        groups: [{ key: "host-a", count: 1 }],
      },
    });
    await reconcileOnce(harness);
    // Two count calls: active and starting, each grouped by host.
    expect(harness.inspection.sdk.callsTo("threads.count")).toHaveLength(2);
    const gate = createGate(harness);
    // Seed contributes 2 (one active + one starting from the same stub), so
    // the pool of 2 is already full.
    expect(await gate(createContext())).toEqual({
      action: "hold",
      reason: "2 of 2 running on all hosts",
    });
  });

  it("excludes child threads from the seed, as the gate excludes them", async () => {
    const { harness } = await setup({
      settings: { maxConcurrentThreads: "2" },
    });
    await reconcileOnce(harness);
    const [args] = harness.inspection.sdk.callsTo("threads.count");
    expect(args?.[0]).toMatchObject({ parentThreadId: "none" });
  });
});

describe("the submit gate", () => {
  it("does not re-admit a thread that is already running", async () => {
    // A running thread already occupies its slot; holding its own follow-up
    // would park it behind the pool it is itself filling.
    const { harness } = await setup({
      settings: { maxConcurrentThreads: "0" },
    });
    const active = makeThreadResponse({ id: "thr_1", status: "active" });
    expect(await submitGate(harness)(submitContext(active))).toEqual({
      action: "proceed",
    });
  });

  it("holds an idle thread's follow-up when the pool is full", async () => {
    const { harness } = await setup({
      settings: { maxConcurrentThreads: "0" },
    });
    const idle = makeThreadResponse({ id: "thr_1", status: "idle" });
    expect(await submitGate(harness)(submitContext(idle))).toEqual({
      action: "hold",
      reason: "0 of 0 running on all hosts",
    });
  });

  it("exempts a child thread's follow-up using the thread's own parentage", async () => {
    const { harness } = await setup({
      settings: { maxConcurrentThreads: "0" },
    });
    const child = makeThreadResponse({
      id: "thr_child",
      status: "idle",
      parentThreadId: "thr_parent",
    });
    expect(await submitGate(harness)(submitContext(child))).toEqual({
      action: "proceed",
    });
  });
});

describe("releasing on a freed slot", () => {
  it("releases the oldest hold it owns when a thread goes idle", async () => {
    const { harness } = await setup({
      settings: { maxConcurrentThreads: "1" },
    });
    const gate = createGate(harness);
    await gate(createContext());
    await gate(createContext());

    await harness.behavior.emitThreadEvent("dispatch.held", {
      hold: holdResponse({
        id: "hold_new",
        createdAt: 5_000,
        reason: "1 of 1 running on all hosts",
      }),
    });
    await harness.behavior.emitThreadEvent("dispatch.held", {
      hold: holdResponse({
        id: "hold_old",
        createdAt: 1_000,
        reason: "1 of 1 running on all hosts",
      }),
    });

    await harness.behavior.emitThreadEvent("thread.idle", {
      thread: makeThreadResponse({ id: "thr_running", status: "idle" }),
      lastAssistantText: null,
    });

    expect(
      harness.registrations.releasedDispatchHolds.map((r) => r.holdId),
    ).toEqual(["hold_old"]);
  });

  it("never releases a hold owned by someone else", async () => {
    // A scheduled send and a core reprovision park are both live holds this
    // plugin can see and must not touch.
    const { harness } = await setup({
      settings: { maxConcurrentThreads: "1" },
    });
    await harness.behavior.emitThreadEvent("dispatch.held", {
      hold: holdResponse({ id: "hold_user", holder: "user" }),
    });
    await harness.behavior.emitThreadEvent("thread.idle", {
      thread: makeThreadResponse({ id: "thr_1", status: "idle" }),
      lastAssistantText: null,
    });
    expect(harness.registrations.releasedDispatchHolds).toEqual([]);
  });

  it("does not release the same hold twice for two freed threads", async () => {
    // `dispatch.released` may not arrive before the next thread finishes.
    const { harness } = await setup({
      settings: { maxConcurrentThreads: "1" },
    });
    await harness.behavior.emitThreadEvent("dispatch.held", {
      hold: holdResponse({ id: "hold_1" }),
    });
    for (const id of ["thr_1", "thr_2"]) {
      await harness.behavior.emitThreadEvent("thread.idle", {
        thread: makeThreadResponse({ id, status: "idle" }),
        lastAssistantText: null,
      });
    }
    expect(
      harness.registrations.releasedDispatchHolds.map((r) => r.holdId),
    ).toEqual(["hold_1"]);
  });

  it("frees a slot on failure and archival, not only on idle", async () => {
    const { harness } = await setup({
      settings: { maxConcurrentThreads: "1" },
    });
    await harness.behavior.emitThreadEvent("dispatch.held", {
      hold: holdResponse({ id: "hold_a" }),
    });
    await harness.behavior.emitThreadEvent("thread.failed", {
      thread: makeThreadResponse({ id: "thr_1", status: "error" }),
      error: null,
    });
    await harness.behavior.emitThreadEvent("dispatch.held", {
      hold: holdResponse({ id: "hold_b" }),
    });
    await harness.behavior.emitThreadEvent("thread.archived", {
      thread: makeThreadResponse({ id: "thr_2" }),
    });
    expect(
      harness.registrations.releasedDispatchHolds.map((r) => r.holdId),
    ).toEqual(["hold_a", "hold_b"]);
  });
});

describe("the tally follows lifecycle events", () => {
  it("frees capacity when a running thread goes idle", async () => {
    const { harness } = await setup({
      settings: { maxConcurrentThreads: "1" },
    });
    const gate = createGate(harness);
    await gate(createContext());
    // The created thread takes over the in-flight reservation.
    await harness.behavior.emitThreadEvent("thread.created", {
      thread: makeThreadResponse({
        id: "thr_1",
        status: "starting",
        providerId: "codex",
      }),
    });
    expect((await gate(createContext())).action).toBe("hold");

    await harness.behavior.emitThreadEvent("thread.idle", {
      thread: makeThreadResponse({
        id: "thr_1",
        status: "idle",
        providerId: "codex",
      }),
      lastAssistantText: null,
    });
    expect(await gate(createContext())).toEqual({ action: "proceed" });
  });

  it("ignores an exempt thread's lifecycle so it never consumes a slot", async () => {
    const { harness } = await setup({
      settings: { maxConcurrentThreads: "1" },
    });
    await harness.behavior.emitThreadEvent("thread.active", {
      thread: makeThreadResponse({
        id: "thr_child",
        status: "active",
        parentThreadId: "thr_parent",
      }),
    });
    expect(await createGate(harness)(createContext())).toEqual({
      action: "proceed",
    });
  });

  it("does not hand out capacity when an exempt thread finishes", async () => {
    // Exempt threads must be invisible to the tally in both directions. A
    // child thread never took a slot, so counting its completion as a freed
    // one invents capacity — and under workflows, where children finish
    // constantly, it would keep inventing it until the pool was meaningless.
    const { harness } = await setup({
      settings: { maxConcurrentThreads: "1" },
      counts: { total: 1, groups: [{ key: "host-a", count: 1 }] },
    });
    await reconcileOnce(harness);
    const gate = createGate(harness);
    expect((await gate(createContext())).action).toBe("hold");

    for (const id of ["thr_c1", "thr_c2", "thr_c3"]) {
      await harness.behavior.emitThreadEvent("thread.idle", {
        thread: makeThreadResponse({
          id,
          status: "idle",
          parentThreadId: "thr_parent",
        }),
        lastAssistantText: null,
      });
    }
    expect((await gate(createContext())).action).toBe("hold");
    // And nothing was released on the strength of a slot that never freed.
    expect(harness.registrations.releasedDispatchHolds).toEqual([]);
  });

  it("resolves a thread's host through its environment", async () => {
    // Thread events carry environmentId, never hostId, so the per-host pool
    // depends on this lookup being made and cached.
    const { harness } = await setup({
      settings: { maxConcurrentThreadsPerHost: "1" },
      hosts: [hostRecord("host-a"), hostRecord("host-b")],
    });
    await reconcileOnce(harness);
    await harness.behavior.emitThreadEvent("thread.active", {
      thread: makeThreadResponse({ id: "thr_1", environmentId: "env-b" }),
    });
    const gate = createGate(harness);
    expect((await gate(createContext({ hostId: "host-b" }))).action).toBe(
      "hold",
    );
    expect((await gate(createContext({ hostId: "host-a" }))).action).toBe(
      "proceed",
    );
    expect(harness.inspection.sdk.callsTo("environments.get")).toHaveLength(1);
  });
});

describe("gate latency", () => {
  it("decides synchronously, without awaiting any I/O", async () => {
    // The property that keeps a gate inside its decision box under core's
    // server-wide lock: every input is already in memory when it runs.
    const { harness } = await setup({
      settings: { maxConcurrentThreadsPerHost: "0" },
      hosts: [hostRecord("host-a", "mac-mini")],
    });
    await reconcileOnce(harness);
    expect(createGate(harness)(createContext({ hostId: "host-a" }))).toEqual({
      action: "hold",
      reason: "0 of 0 running on host mac-mini",
    });
  });
});
