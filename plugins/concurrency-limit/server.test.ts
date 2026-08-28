// End-to-end wiring through the fake plugin host: settings in, gate verdicts
// out, lifecycle events driving the tally, and a freed slot clearing a wait.
// The arithmetic itself is covered in tally.test.ts / scope.test.ts; what this
// file checks is that the pieces are connected to the right inputs.

import type {
  BbPluginApi,
  PluginDispatchAttemptKind,
  PluginDispatchGateContext,
  PluginThreadEventPayloads,
} from "@get-bb/plugin-sdk";
import {
  createFakePluginHost,
  makeQueueEntry,
  makeThreadResponse,
} from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import plugin from "./server.js";

type ThreadResponse = PluginThreadEventPayloads["thread.created"]["thread"];
type QueueEntry = PluginThreadEventPayloads["queue.parked"]["entry"];
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

/** A row parked on this plugin's wait, as `queue.list` and `queue.parked` give it. */
function parkedRow(overrides: Partial<QueueEntry> = {}): QueueEntry {
  return makeQueueEntry({
    id: "queued_1",
    threadId: "thr_parked",
    createdAt: 1_000,
    waitingOn: {
      kind: "plugin",
      pluginId: PLUGIN_ID,
      reason: "1 of 1 running on all hosts",
    },
    ...overrides,
  });
}

interface GateContextOverrides {
  hostId?: string | null;
  thread?: Partial<ThreadResponse>;
  attempt?: PluginDispatchAttemptKind;
  firstDispatch?: boolean;
  queuedMessage?: QueueEntry | null;
}

/**
 * The one dispatch checkpoint's context. The thread is never null now — a new
 * thread is inserted `pending` before its first message is decided about — so
 * every case here names the thread it is dispatching for.
 */
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
    firstDispatch: overrides.firstDispatch ?? true,
    queuedMessage: overrides.queuedMessage ?? null,
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
    originPluginId: null,
    startedOnBehalfOf: null,
    parentThreadId: null,
    pluginInput: null,
  };
}

interface SetupOptions {
  settings?: Record<string, string>;
  counts?: ThreadCountResponse;
  parked?: QueueEntry[];
  hosts?: HostRecord[];
}

async function setup(options: SetupOptions = {}) {
  const { bb, harness } = createFakePluginHost({
    pluginId: PLUGIN_ID,
    settings: options.settings ?? {},
    sdk: {
      threads: {
        count: async () => options.counts ?? emptyCount(),
        queue: { list: async () => options.parked ?? [] },
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

type Harness = Awaited<ReturnType<typeof setup>>["harness"];

async function flush(): Promise<void> {
  for (let index = 0; index < 8; index += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

/** Run the reconciler exactly once, then stop it. */
async function reconcileOnce(harness: Harness): Promise<void> {
  const service = harness.behavior.runService("reconciler");
  // The loop awaits its full reconcile before sleeping; yielding past the
  // pending SDK promises is enough to see the seeded state.
  await flush();
  service.controller.abort();
  await service.done;
}

function dispatchGate(harness: Harness) {
  const gate = harness.registrations.dispatchGates.dispatch;
  if (gate === null) throw new Error("the dispatch gate was not registered");
  return gate;
}

function clearedIds(harness: Harness): string[] {
  return harness.registrations.clearedQueueWaits.map(
    (entry) => entry.queuedMessageId,
  );
}

describe("registration", () => {
  it("registers a gate at the dispatch checkpoint", async () => {
    const { harness } = await setup();
    expect(harness.registrations.dispatchGates.dispatch).not.toBeNull();
  });

  it("changes nothing until a limit is configured", async () => {
    // Installing the plugin must not alter dispatch behaviour; every limit
    // defaults to empty, which means unlimited.
    const { harness } = await setup();
    expect(await dispatchGate(harness)(dispatchContext())).toEqual({
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
    expect(await dispatchGate(harness)(dispatchContext())).toEqual({
      action: "proceed",
    });
  });
});

describe("the dispatch gate", () => {
  it("waits once its own proceeds have filled the pool", async () => {
    // Nothing is running and no event has fired: the only thing stopping the
    // second dispatch is the plugin counting the `proceed` it just returned.
    const { harness } = await setup({
      settings: { maxConcurrentThreads: "1" },
    });
    const gate = dispatchGate(harness);
    expect(
      await gate(dispatchContext({ thread: { id: "thr_1" } })),
    ).toEqual({ action: "proceed" });
    expect(
      await gate(dispatchContext({ thread: { id: "thr_2" } })),
    ).toEqual({
      action: "wait",
      reason: "1 of 1 running on all hosts",
    });
  });

  it("exempts child and plugin-spawned threads from a full pool", async () => {
    // Both are read off the thread now, which is the only place they live.
    const { harness } = await setup({
      settings: { maxConcurrentThreads: "0" },
    });
    const gate = dispatchGate(harness);
    expect(await gate(dispatchContext())).toEqual({
      action: "wait",
      reason: "0 of 0 running on all hosts",
    });
    expect(
      await gate(
        dispatchContext({ thread: { parentThreadId: "thr_parent" } }),
      ),
    ).toEqual({ action: "proceed" });
    expect(
      await gate(dispatchContext({ thread: { originPluginId: "workflows" } })),
    ).toEqual({ action: "proceed" });
  });

  it("keeps separate host pools separate", async () => {
    const { harness } = await setup({
      settings: { maxConcurrentThreadsPerHost: "1" },
      hosts: [hostRecord("host-a", "mac-mini"), hostRecord("host-b")],
    });
    await reconcileOnce(harness);
    const gate = dispatchGate(harness);
    expect(
      await gate(dispatchContext({ hostId: "host-a", thread: { id: "thr_1" } })),
    ).toEqual({ action: "proceed" });
    expect(
      await gate(dispatchContext({ hostId: "host-b", thread: { id: "thr_2" } })),
    ).toEqual({ action: "proceed" });
    expect(
      await gate(dispatchContext({ hostId: "host-a", thread: { id: "thr_3" } })),
    ).toEqual({
      action: "wait",
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
    const gate = dispatchGate(harness);
    // Seed contributes 2 (one active + one starting from the same stub), so
    // the pool of 2 is already full.
    expect(await gate(dispatchContext())).toEqual({
      action: "wait",
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

  it("does not re-admit a thread that is already running", async () => {
    // A running thread already occupies its slot; parking its own follow-up
    // would put it behind the pool it is itself filling.
    const { harness } = await setup({
      settings: { maxConcurrentThreads: "0" },
    });
    const gate = dispatchGate(harness);
    for (const status of ["active", "starting"] as const) {
      expect(
        await gate(
          dispatchContext({
            firstDispatch: false,
            thread: { id: "thr_1", status },
          }),
        ),
      ).toEqual({ action: "proceed" });
    }
  });

  it("parks a start-turn attempt on an idle thread when the pool is full", async () => {
    const { harness } = await setup({
      settings: { maxConcurrentThreads: "0" },
    });
    expect(
      await dispatchGate(harness)(
        dispatchContext({
          attempt: "start-turn",
          firstDispatch: false,
          thread: { id: "thr_1", status: "idle" },
        }),
      ),
    ).toEqual({ action: "wait", reason: "0 of 0 running on all hosts" });
  });

  it("lets a join-turn attempt through even when the pool is full", async () => {
    // A steer joins a turn whose slot this thread already holds. Parking it
    // would strand the user mid-turn behind a pool the turn is itself filling
    // — and the thread's status is not evidence either way, because the row is
    // only written after the turn starts.
    const { harness } = await setup({
      settings: { maxConcurrentThreads: "0" },
    });
    expect(
      await dispatchGate(harness)(
        dispatchContext({
          attempt: "join-turn",
          firstDispatch: false,
          thread: { id: "thr_1", status: "idle" },
        }),
      ),
    ).toEqual({ action: "proceed" });
  });
});

describe("clearing a wait when a slot frees", () => {
  it("clears the oldest wait it owns when a thread goes idle", async () => {
    const { harness } = await setup({
      settings: { maxConcurrentThreads: "1" },
    });
    const gate = dispatchGate(harness);
    await gate(dispatchContext({ thread: { id: "thr_1" } }));
    await gate(dispatchContext({ thread: { id: "thr_2" } }));

    await harness.behavior.emitThreadEvent("queue.parked", {
      entry: parkedRow({ id: "queued_new", createdAt: 5_000 }),
    });
    await harness.behavior.emitThreadEvent("queue.parked", {
      entry: parkedRow({ id: "queued_old", createdAt: 1_000 }),
    });

    await harness.behavior.emitThreadEvent("thread.idle", {
      thread: makeThreadResponse({ id: "thr_running", status: "idle" }),
      lastAssistantText: null,
    });

    expect(clearedIds(harness)).toEqual(["queued_old"]);
  });

  it("never clears a wait owned by someone else", async () => {
    // A scheduled send and a core wait are both parked rows this plugin can
    // see and must not touch.
    const { harness } = await setup({
      settings: { maxConcurrentThreads: "1" },
    });
    await harness.behavior.emitThreadEvent("queue.parked", {
      entry: parkedRow({
        id: "queued_other",
        waitingOn: {
          kind: "plugin",
          pluginId: "scheduled-send",
          reason: "Sending at 09:00",
        },
      }),
    });
    await harness.behavior.emitThreadEvent("queue.parked", {
      entry: parkedRow({ id: "queued_core", waitingOn: { kind: "thread-busy" } }),
    });
    await harness.behavior.emitThreadEvent("thread.idle", {
      thread: makeThreadResponse({ id: "thr_1", status: "idle" }),
      lastAssistantText: null,
    });
    expect(harness.registrations.clearedQueueWaits).toEqual([]);
  });

  it("does not clear the same wait twice for two freed threads", async () => {
    // `queue.dispatched` may not arrive before the next thread finishes.
    const { harness } = await setup({
      settings: { maxConcurrentThreads: "1" },
    });
    await harness.behavior.emitThreadEvent("queue.parked", {
      entry: parkedRow({ id: "queued_1" }),
    });
    for (const id of ["thr_1", "thr_2"]) {
      await harness.behavior.emitThreadEvent("thread.idle", {
        thread: makeThreadResponse({ id, status: "idle" }),
        lastAssistantText: null,
      });
    }
    expect(clearedIds(harness)).toEqual(["queued_1"]);
  });

  it("frees a slot on failure and archival, not only on idle", async () => {
    const { harness } = await setup({
      settings: { maxConcurrentThreads: "1" },
    });
    await harness.behavior.emitThreadEvent("queue.parked", {
      entry: parkedRow({ id: "queued_a" }),
    });
    await harness.behavior.emitThreadEvent("thread.failed", {
      thread: makeThreadResponse({ id: "thr_1", status: "error" }),
      error: null,
    });
    await harness.behavior.emitThreadEvent("queue.parked", {
      entry: parkedRow({ id: "queued_b" }),
    });
    await harness.behavior.emitThreadEvent("thread.archived", {
      thread: makeThreadResponse({ id: "thr_2" }),
    });
    expect(clearedIds(harness)).toEqual(["queued_a", "queued_b"]);
  });

  it("stops offering a row once it has dispatched", async () => {
    const { harness } = await setup({
      settings: { maxConcurrentThreads: "1" },
    });
    const entry = parkedRow({ id: "queued_1" });
    await harness.behavior.emitThreadEvent("queue.parked", { entry });
    await harness.behavior.emitThreadEvent("queue.dispatched", { entry });
    await harness.behavior.emitThreadEvent("thread.idle", {
      thread: makeThreadResponse({ id: "thr_1", status: "idle" }),
      lastAssistantText: null,
    });
    expect(harness.registrations.clearedQueueWaits).toEqual([]);
  });
});

describe("adopting parked rows after a restart", () => {
  it("asks only for the rows it is holding, and clears one when a slot frees", async () => {
    // Rows this plugin parked outlive the process that parked them, and the
    // wait-holder filter is what keeps the query indexed instead of listing
    // the whole queue and filtering client-side.
    const { harness } = await setup({
      settings: { maxConcurrentThreads: "1" },
      parked: [
        parkedRow({ id: "queued_restarted", createdAt: 2_000 }),
        parkedRow({
          id: "queued_someone_else",
          createdAt: 1_000,
          waitingOn: { kind: "provisioning" },
        }),
      ],
    });
    await reconcileOnce(harness);

    const [args] = harness.inspection.sdk.callsTo("threads.queue.list");
    expect(args?.[0]).toEqual({ waitHolder: HOLDER });

    await harness.behavior.emitThreadEvent("thread.idle", {
      thread: makeThreadResponse({ id: "thr_1", status: "idle" }),
      lastAssistantText: null,
    });
    expect(clearedIds(harness)).toEqual(["queued_restarted"]);
  });
});

describe("the tally follows lifecycle events", () => {
  it("frees capacity when a running thread goes idle", async () => {
    const { harness } = await setup({
      settings: { maxConcurrentThreads: "1" },
    });
    const gate = dispatchGate(harness);
    await gate(dispatchContext({ thread: { id: "thr_1" } }));
    await harness.behavior.emitThreadEvent("thread.active", {
      thread: makeThreadResponse({
        id: "thr_1",
        status: "active",
        providerId: "codex",
      }),
    });
    expect(
      (await gate(dispatchContext({ thread: { id: "thr_2" } }))).action,
    ).toBe("wait");

    await harness.behavior.emitThreadEvent("thread.idle", {
      thread: makeThreadResponse({
        id: "thr_1",
        status: "idle",
        providerId: "codex",
      }),
      lastAssistantText: null,
    });
    expect(
      await gate(dispatchContext({ thread: { id: "thr_3" } })),
    ).toEqual({ action: "proceed" });
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
    expect(await dispatchGate(harness)(dispatchContext())).toEqual({
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
    const gate = dispatchGate(harness);
    expect((await gate(dispatchContext())).action).toBe("wait");

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
    expect((await gate(dispatchContext())).action).toBe("wait");
    // And nothing was cleared on the strength of a slot that never freed.
    expect(harness.registrations.clearedQueueWaits).toEqual([]);
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
    const gate = dispatchGate(harness);
    expect(
      (await gate(dispatchContext({ hostId: "host-b", thread: { id: "thr_2" } })))
        .action,
    ).toBe("wait");
    expect(
      (await gate(dispatchContext({ hostId: "host-a", thread: { id: "thr_3" } })))
        .action,
    ).toBe("proceed");
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
    expect(dispatchGate(harness)(dispatchContext({ hostId: "host-a" }))).toEqual({
      action: "wait",
      reason: "0 of 0 running on host mac-mini",
    });
  });
});
