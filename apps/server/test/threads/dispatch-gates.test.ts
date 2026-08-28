import {
  getThread,
  listEvents,
  listQueuedThreadMessages,
  listQueuedThreadMessagesForApi,
  listRunningThreads,
} from "@bb/db";
import type { ThreadQueuedMessage } from "@bb/domain";
import type { PluginDispatchGateStage } from "@get-bb/plugin-sdk";
import { afterEach, describe, expect, it } from "vitest";
import { ApiError } from "../../src/errors.js";
import {
  setDispatchGateProvider,
  type DispatchGateRegistration,
} from "../../src/services/plugins/dispatch-gate-registry.js";
import {
  createQueuedMessageForThread,
  sendNextQueuedMessageIfPresent,
} from "../../src/services/threads/queued-messages.js";
import { acceptThreadSendRequest } from "../../src/services/threads/thread-send-request.js";
import { createThreadFromRequest } from "../../src/services/threads/thread-create.js";
import { toThreadQueuedMessage } from "../../src/services/threads/thread-queued-messages.js";
import { textInput } from "../helpers/prompt-input.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
  seedThreadRuntimeState,
  seedTurnStarted,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

const WORKSPACE_PATH = "/tmp/dispatch-gates-project";

/**
 * The gate registry, per stage. Reading a mapped type through a generic key is
 * sound, which is what lets the fake provider satisfy `listGates<S>` with no
 * cast — the same shape the real registry uses on the plugin handle.
 */
type GateRegistry = {
  [S in PluginDispatchGateStage]: DispatchGateRegistration<S>[];
};

function emptyRegistry(): GateRegistry {
  return { dispatch: [], "turn.failed": [] };
}

/**
 * Installs fake gates through the same seam createApp registers the plugin
 * service through, so these tests exercise the real runner (order, lock, box,
 * validation, provenance) without loading plugins.
 */
function installGates(
  registry: GateRegistry,
  options: { decisionTimeoutMs?: number } = {},
): void {
  setDispatchGateProvider({
    listGates: (stage) => registry[stage],
    // Mirrors the plugin service's failure isolation: a throw is reported, not
    // propagated, and the runner is what turns it into a failed dispatch.
    invokeGate: async (_pluginId, _label, run) => {
      try {
        return { ok: true, value: await run() };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
    decisionTimeoutMs: options.decisionTimeoutMs ?? 10_000,
  });
}

afterEach(() => {
  setDispatchGateProvider(undefined);
});

function seedGateFixture(harness: TestAppHarness, hostId: string) {
  const { host } = seedHostSession(harness.deps, { id: hostId });
  const { project } = seedProjectWithSource(harness.deps, {
    hostId: host.id,
    path: WORKSPACE_PATH,
  });
  const environment = seedEnvironment(harness.deps, {
    hostId: host.id,
    projectId: project.id,
    path: WORKSPACE_PATH,
  });
  return { environment, host, project };
}

function createGatedThread(
  harness: TestAppHarness,
  args: {
    hostId: string;
    projectId: string;
    origin?: "app" | "cli" | "sdk";
    model?: string;
  },
) {
  return createThreadFromRequest(harness.deps, {
    environment: {
      type: "host",
      hostId: args.hostId,
      workspace: { type: "unmanaged", path: WORKSPACE_PATH },
    },
    input: textInput("Do the thing"),
    origin: args.origin ?? "app",
    projectId: args.projectId,
    providerId: "codex",
    ...(args.model !== undefined ? { model: args.model } : {}),
    startedOnBehalfOf: null,
  });
}

/**
 * The turn requests on a thread. The runtime-state seed plants one, so tests
 * about "did a turn dispatch" compare counts rather than expecting an empty
 * list.
 */
function turnRequests(harness: TestAppHarness, threadId: string) {
  return listEvents(harness.db, { threadId }).filter(
    (event) => event.type === "client/turn/requested",
  );
}

/**
 * A thread's parked rows: a live queued row carrying a wait. This is the queue
 * shape that replaced the hold table — the row IS the parked dispatch.
 */
function parkedRows(
  harness: TestAppHarness,
  threadId: string,
): ThreadQueuedMessage[] {
  return listQueuedThreadMessages(harness.db, threadId)
    .map(toThreadQueuedMessage)
    .filter((entry) => entry.waitingOn !== null);
}

function onlyParkedRow(
  harness: TestAppHarness,
  threadId: string,
): ThreadQueuedMessage {
  const rows = parkedRows(harness, threadId);
  if (rows.length !== 1 || rows[0] === undefined) {
    throw new Error(`expected exactly one parked row, found ${rows.length}`);
  }
  return rows[0];
}

/** A live thread that can take a follow-up send. */
function seedRunnableThread(
  harness: TestAppHarness,
  args: { hostId: string; status: "idle" | "active" },
) {
  const { environment, project } = seedGateFixture(harness, args.hostId);
  const thread = seedThread(harness.deps, {
    environmentId: environment.id,
    projectId: project.id,
    status: args.status,
  });
  seedThreadRuntimeState(harness.deps, {
    environmentId: environment.id,
    providerThreadId: `provider-${args.hostId}`,
    threadId: thread.id,
  });
  if (args.status === "active") {
    seedTurnStarted(harness.deps, {
      environmentId: environment.id,
      threadId: thread.id,
      turnId: `turn-${args.hostId}`,
      providerThreadId: `provider-${args.hostId}`,
    });
  }
  return { environment, project, thread };
}

async function expectApiError(
  run: () => Promise<unknown>,
): Promise<ApiError> {
  try {
    await run();
  } catch (error) {
    if (error instanceof ApiError) return error;
    throw error;
  }
  throw new Error("expected the operation to fail");
}

describe("dispatch gate composition", () => {
  it("runs every gate in install order and freezes the resolved tuple", async () => {
    await withTestHarness(async (harness) => {
      const seen: string[] = [];
      let secondSawModel: string | null = null;
      const registry = emptyRegistry();
      registry.dispatch.push(
        {
          pluginId: "first",
          handler: () => {
            seen.push("first");
            return { action: "proceed" } as const;
          },
        },
        {
          pluginId: "second",
          handler: (context) => {
            seen.push("second");
            secondSawModel = context.requestedExecution.model;
            // Waiting here parks the dispatch so the frozen tuple is
            // observable without dispatching a real turn.
            return { action: "wait", reason: "checking" } as const;
          },
        },
      );
      installGates(registry);
      const { host, project } = seedGateFixture(harness, "host-gate-order");

      const thread = await createGatedThread(harness, {
        hostId: host.id,
        projectId: project.id,
        model: "requested-model",
      });

      expect(seen).toEqual(["first", "second"]);
      // Every gate decides about the same resolved request, and that is the
      // tuple the parked row freezes.
      expect(secondSawModel).toBe("requested-model");
      expect(onlyParkedRow(harness, thread.id).model).toBe("requested-model");
    });
  });

  it("names every waiter on the reason when a pass collects several", async () => {
    await withTestHarness(async (harness) => {
      const registry = emptyRegistry();
      registry.dispatch.push(
        {
          pluginId: "limiter",
          handler: () => ({ action: "wait", reason: "at capacity" }) as const,
        },
        {
          pluginId: "quiet-hours",
          handler: () => ({ action: "wait", reason: "after hours" }) as const,
        },
      );
      installGates(registry);
      const { host, project } = seedGateFixture(harness, "host-gate-multi");

      const thread = await createGatedThread(harness, {
        hostId: host.id,
        projectId: project.id,
      });

      expect(onlyParkedRow(harness, thread.id).waitingOn).toEqual({
        kind: "plugin",
        pluginId: "limiter",
        reason: "at capacity (also waiting on quiet-hours: after hours)",
      });
    });
  });

  it("short-circuits the pass on reject with a 409 naming the plugin", async () => {
    await withTestHarness(async (harness) => {
      let laterGateRan = false;
      const registry = emptyRegistry();
      registry.dispatch.push(
        {
          pluginId: "dlp",
          handler: () =>
            ({ action: "reject", message: "Contains a secret" }) as const,
        },
        {
          pluginId: "never",
          handler: () => {
            laterGateRan = true;
            return { action: "proceed" } as const;
          },
        },
      );
      installGates(registry);
      const { host, project } = seedGateFixture(harness, "host-gate-reject");

      const error = await expectApiError(() =>
        createGatedThread(harness, { hostId: host.id, projectId: project.id }),
      );

      expect(error.status).toBe(409);
      expect(error.body.code).toBe("dispatch_rejected");
      expect(error.body.message).toBe("Contains a secret");
      expect(error.body.details).toEqual({
        pluginId: "dlp",
        stage: "dispatch",
      });
      expect(laterGateRan).toBe(false);
      // Nothing persisted: a rejected create leaves no thread and no row.
      expect(listQueuedThreadMessagesForApi(harness.db, {})).toEqual([]);
    });
  });

  it("runs one pass at a time so a counting gate never sees itself interleaved", async () => {
    await withTestHarness(async (harness) => {
      let inFlight = 0;
      let maxInFlight = 0;
      const registry = emptyRegistry();
      registry.dispatch.push({
        pluginId: "limiter",
        handler: async () => {
          // A gate that tallies its own in-flight work is only correct if the
          // server-wide evaluation lock holds; without it both passes would
          // see zero running and both would proceed.
          inFlight += 1;
          maxInFlight = Math.max(maxInFlight, inFlight);
          await new Promise((resolve) => setTimeout(resolve, 5));
          inFlight -= 1;
          return { action: "wait", reason: "counting" } as const;
        },
      });
      installGates(registry);
      const { host, project } = seedGateFixture(harness, "host-gate-lock");

      await Promise.all([
        createGatedThread(harness, { hostId: host.id, projectId: project.id }),
        createGatedThread(harness, { hostId: host.id, projectId: project.id }),
      ]);

      expect(maxInFlight).toBe(1);
    });
  });
});

describe("dispatch gate admission visibility", () => {
  it("commits a cleared first dispatch before the lock releases, so the next pass sees it", async () => {
    // The invariant `sdk.threads.listRunning()` rests on. The evaluation lock
    // already serializes the QUESTIONS; this pins that the ANSWERS land inside
    // it too. Without the flip-before-unlock ordering both passes below read an
    // empty running set and a limit of one admits two threads — the exact race
    // that made the limiter keep its own tally of in-flight `proceed`s.
    await withTestHarness(async (harness) => {
      const seen: string[][] = [];
      const registry = emptyRegistry();
      registry.dispatch.push({
        pluginId: "limiter",
        handler: async () => {
          // Precisely what the concurrency limiter does: ask the server what
          // is running, at the moment the gate runs.
          const running = listRunningThreads(harness.db);
          seen.push(running.map((row) => row.id));
          return running.length >= 1
            ? ({ action: "wait", reason: "1 of 1 running on all hosts" } as const)
            : ({ action: "proceed" } as const);
        },
      });
      installGates(registry);
      const { host, project } = seedGateFixture(harness, "host-admission");

      const created = await Promise.all([
        createGatedThread(harness, { hostId: host.id, projectId: project.id }),
        createGatedThread(harness, { hostId: host.id, projectId: project.id }),
      ]);

      expect(seen).toHaveLength(2);
      expect(seen[0]).toEqual([]);
      expect(seen[1]).toHaveLength(1);

      const admittedId = seen[1]![0]!;
      const parked = created.find((thread) => thread.id !== admittedId)!;
      expect(created.map((thread) => thread.id)).toContain(admittedId);
      // One admitted and started, one still pending with its message parked.
      expect(getThread(harness.db, admittedId)?.status).not.toBe("pending");
      expect(getThread(harness.db, parked.id)?.status).toBe("pending");
      expect(onlyParkedRow(harness, parked.id).waitingOn).toEqual({
        kind: "plugin",
        pluginId: "limiter",
        reason: "1 of 1 running on all hosts",
      });
    });
  });

  it("shows a warm follow-up's admission only after its send lands, not inside the pass", async () => {
    // The honest boundary on the exactness contract. A first dispatch commits
    // `pending -> starting` inside the lock; a follow-up on an already-live
    // thread commits `idle -> active` inside the send transaction, which needs
    // a prepared host command and therefore cannot run under the lock. So a
    // gate deciding about an idle thread does not yet see it, and sees it on
    // the next attempt. Pinned here so a future change that closes the gap
    // fails loudly and takes the doc comment with it.
    await withTestHarness(async (harness) => {
      const seen: string[][] = [];
      const registry = emptyRegistry();
      registry.dispatch.push({
        pluginId: "limiter",
        handler: () => {
          seen.push(listRunningThreads(harness.db).map((row) => row.id));
          return { action: "proceed" } as const;
        },
      });
      installGates(registry);
      const { thread } = seedRunnableThread(harness, {
        hostId: "host-warm-admission",
        status: "idle",
      });

      await acceptThreadSendRequest(harness.deps, {
        payload: { input: textInput("first follow-up"), mode: "auto" },
        thread,
      });
      // Not visible to its own pass: an idle thread occupies nothing, and the
      // activation is still ahead of it.
      expect(seen).toEqual([[]]);
      // It IS committed by the time the send returns, so the next attempt —
      // and every other reader — sees it.
      expect(listRunningThreads(harness.db).map((row) => row.id)).toEqual([
        thread.id,
      ]);

      await acceptThreadSendRequest(harness.deps, {
        payload: { input: textInput("a steer"), mode: "steer" },
        thread: getThread(harness.db, thread.id)!,
      });
      expect(seen[1]).toEqual([thread.id]);
    });
  });
});

describe("dispatch gates and the no-gate path", () => {
  it("leaves creation unchanged when the dispatch stage has no gates", async () => {
    await withTestHarness(async (harness) => {
      // A provider is registered, but it declares no `dispatch` gate: the pass
      // must not run, take the lock, or allocate a queued row.
      const registry = emptyRegistry();
      registry["turn.failed"].push({
        pluginId: "failure-only",
        handler: () => ({ action: "none" }) as const,
      });
      installGates(registry);
      const { host, project } = seedGateFixture(harness, "host-gate-none");

      const thread = await createGatedThread(harness, {
        hostId: host.id,
        projectId: project.id,
      });

      expect(listQueuedThreadMessages(harness.db, thread.id)).toEqual([]);
      const types = listEvents(harness.db, { threadId: thread.id }).map(
        (event) => event.type,
      );
      expect(types).toContain("client/turn/requested");
      expect(types).not.toContain("system/queue-state");
    });
  });

  it("gates a steer into a live turn like any other dispatch", async () => {
    // Steers used to be exempt because they joined a decision already made.
    // With one checkpoint they are gated uniformly, distinguished only by
    // `attempt` — which is what lets a limiter or a DLP gate cover them.
    await withTestHarness(async (harness) => {
      const attempts: string[] = [];
      const registry = emptyRegistry();
      registry.dispatch.push({
        pluginId: "limiter",
        handler: (context) => {
          attempts.push(context.attempt);
          return { action: "reject", message: "no steering right now" } as const;
        },
      });
      installGates(registry);
      const { thread } = seedRunnableThread(harness, {
        hostId: "host-gate-steer",
        status: "active",
      });

      const error = await expectApiError(() =>
        acceptThreadSendRequest(harness.deps, {
          payload: { input: textInput("actually, stop"), mode: "steer" },
          thread,
        }),
      );

      expect(error.status).toBe(409);
      expect(error.body.code).toBe("dispatch_rejected");
      expect(attempts).toEqual(["join-turn"]);
    });
  });
});

describe("dispatch gates on the queue drain", () => {
  it("returns the claimed row to the queue instead of consuming it when the pass waits", async () => {
    await withTestHarness(async (harness) => {
      const registry = emptyRegistry();
      registry.dispatch.push({
        pluginId: "limiter",
        handler: () => ({ action: "wait", reason: "at capacity" }) as const,
      });
      installGates(registry);
      const { thread } = seedRunnableThread(harness, {
        hostId: "host-gate-drain",
        status: "idle",
      });
      const queued = await createQueuedMessageForThread(harness.deps, {
        payload: { input: textInput("queued work") },
        thread,
      });
      const turnsBefore = turnRequests(harness, thread.id).length;

      const drained = await sendNextQueuedMessageIfPresent(harness.deps, {
        threadId: thread.id,
      });

      expect(drained).toBe(true);
      // The claim is handed back rather than consumed: it is the SAME row, now
      // parked, so the user still has one card for one message.
      const parked = onlyParkedRow(harness, thread.id);
      expect(parked.id).toBe(queued.id);
      expect(parked.content).toEqual(textInput("queued work"));
      expect(parked.waitingOn).toEqual({
        kind: "plugin",
        pluginId: "limiter",
        reason: "at capacity",
      });
      expect(turnRequests(harness, thread.id)).toHaveLength(turnsBefore);
    });
  });
});
