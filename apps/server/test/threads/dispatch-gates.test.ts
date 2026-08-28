import {
  getAppSettings,
  getProjectExecutionDefaults,
  getThread,
  setAppSettings,
  listEvents,
  listQueuedThreadMessages,
  listQueuedThreadMessagesForApi,
} from "@bb/db";
import type { PluginInputs, ThreadQueuedMessage } from "@bb/domain";
import type {
  PluginDispatchAttemptContext,
  PluginDispatchGateStage,
} from "@get-bb/plugin-sdk";
import { afterEach, describe, expect, it } from "vitest";
import { ApiError } from "../../src/errors.js";
import {
  setDispatchGateProvider,
  type DispatchGateRegistration,
} from "../../src/services/plugins/dispatch-gate-registry.js";
import {
  createQueuedMessageForThread,
  parseQueuedMessagePluginInputs,
  sendNextQueuedMessageIfPresent,
  sendQueuedMessage,
} from "../../src/services/threads/queued-messages.js";
import { clearQueuedMessageWait } from "../../src/services/threads/queue-parking.js";
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
    pluginInputs?: PluginInputs;
    origin?: "app" | "cli" | "sdk";
    providerId?: string;
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
    providerId: args.providerId ?? "codex",
    ...(args.model !== undefined ? { model: args.model } : {}),
    ...(args.pluginInputs !== undefined
      ? { pluginInputs: args.pluginInputs }
      : {}),
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

/**
 * Re-attempts a parked row exactly as a drain does: drop the wait that is no
 * longer holding it, then run the row back through the checkpoint. The full
 * gate pass re-runs, which is the whole point of clearing rather than sending.
 */
async function reattemptParkedRow(
  harness: TestAppHarness,
  args: { queuedMessageId: string; threadId: string },
): Promise<void> {
  clearQueuedMessageWait(harness.deps, args);
  await sendQueuedMessage(harness.deps, {
    mode: "auto",
    queuedMessageId: args.queuedMessageId,
    threadId: args.threadId,
    // Not an override: a drain's re-attempt is gated like any other.
    sendNow: false,
  });
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
  it("runs gates in install order and accumulates their amendments", async () => {
    await withTestHarness(async (harness) => {
      const seen: string[] = [];
      let secondSawModel: string | null = null;
      const registry = emptyRegistry();
      registry.dispatch.push(
        {
          pluginId: "first",
          handler: () => {
            seen.push("first");
            return {
              action: "proceed",
              amend: { model: "amended-by-first" },
            } as const;
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
      });

      expect(seen).toEqual(["first", "second"]);
      // The second gate saw its predecessor's amendment, not the request's.
      expect(secondSawModel).toBe("amended-by-first");
      expect(onlyParkedRow(harness, thread.id).model).toBe("amended-by-first");
    });
  });

  it("collects waits across a full pass so the parked row is fully resolved", async () => {
    await withTestHarness(async (harness) => {
      const registry = emptyRegistry();
      registry.dispatch.push(
        {
          pluginId: "limiter",
          handler: () =>
            ({ action: "wait", reason: "4 of 4 running" }) as const,
        },
        {
          pluginId: "router",
          handler: () =>
            ({
              action: "proceed",
              amend: { model: "opus" },
            }) as const,
        },
      );
      installGates(registry);
      const { host, project } = seedGateFixture(harness, "host-gate-collect");

      const thread = await createGatedThread(harness, {
        hostId: host.id,
        projectId: project.id,
      });

      // The router ran even though the limiter already voted to wait, so the
      // tuple frozen on the row is the one the whole chain agreed on.
      const parked = onlyParkedRow(harness, thread.id);
      expect(parked.model).toBe("opus");
      // One row per pass, owned by the first waiter; the rest are named in the
      // reason so the user sees one card, not one per gate.
      expect(parked.waitingOn).toEqual({
        kind: "plugin",
        pluginId: "limiter",
        reason: "4 of 4 running",
      });
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

  it("leads the chain with the plugin ids the user pinned in settings", async () => {
    await withTestHarness(async (harness) => {
      const seen: string[] = [];
      const registry = emptyRegistry();
      const record = (pluginId: string) => ({
        pluginId,
        handler: () => {
          seen.push(pluginId);
          return { action: "proceed" } as const;
        },
      });
      // Install order is a, b, c.
      registry.dispatch.push(record("a"), record("b"), record("c"));
      installGates(registry);
      // The user pinned c first; a and b keep their install order behind it,
      // exactly like `providerOrder`, and an id that names no gate is ignored.
      setAppSettings(harness.db, {
        ...getAppSettings(harness.db),
        dispatchGateOrder: { dispatch: ["c", "not-installed"] },
      });
      const { host, project } = seedGateFixture(harness, "host-gate-settings");

      await createGatedThread(harness, {
        hostId: host.id,
        projectId: project.id,
      });

      expect(seen).toEqual(["c", "a", "b"]);
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

describe("dispatch gate failure model", () => {
  it("fails the dispatch closed when a gate throws", async () => {
    await withTestHarness(async (harness) => {
      const registry = emptyRegistry();
      registry.dispatch.push({
        pluginId: "broken",
        handler: () => {
          throw new Error("kaboom");
        },
      });
      installGates(registry);
      const { host, project } = seedGateFixture(harness, "host-gate-throw");

      const error = await expectApiError(() =>
        createGatedThread(harness, { hostId: host.id, projectId: project.id }),
      );

      expect(error.status).toBe(502);
      expect(error.body.code).toBe("dispatch_gate_failed");
      expect(error.body.message).toContain('"broken"');
      expect(error.body.message).toContain("kaboom");
    });
  });

  it("fails the dispatch closed when a gate misses its decision box", async () => {
    await withTestHarness(async (harness) => {
      const registry = emptyRegistry();
      registry.dispatch.push({
        pluginId: "slow",
        // Never settles, which is exactly what the box exists for: the
        // dispatch must not wait on it.
        handler: () => new Promise(() => {}),
      });
      installGates(registry, { decisionTimeoutMs: 20 });
      const { host, project } = seedGateFixture(harness, "host-gate-timeout");

      const error = await expectApiError(() =>
        createGatedThread(harness, { hostId: host.id, projectId: project.id }),
      );

      expect(error.status).toBe(502);
      expect(error.body.code).toBe("dispatch_gate_failed");
      expect(error.body.message).toContain('"slow"');
      expect(error.body.message).toContain("did not decide within 20ms");
    });
  });

  it("fails the dispatch closed on a verdict that does not match the schema", async () => {
    await withTestHarness(async (harness) => {
      const registry = emptyRegistry();
      registry.dispatch.push({
        pluginId: "vague",
        // Structurally a `wait`, but a wait with no reason is not a verdict a
        // user could ever be shown — a plugin's TypeScript is a promise, not a
        // guarantee, so the runner re-parses everything at the boundary.
        handler: () => ({ action: "wait", reason: "" }) as const,
      });
      installGates(registry);
      const { host, project } = seedGateFixture(harness, "host-gate-schema");

      const error = await expectApiError(() =>
        createGatedThread(harness, { hostId: host.id, projectId: project.id }),
      );

      expect(error.status).toBe(502);
      expect(error.body.code).toBe("dispatch_gate_failed");
      expect(error.body.message).toContain('"vague"');
      expect(error.body.message).toContain("returned an invalid verdict");
      expect(error.body.message).toContain("reason");
    });
  });

  it("fails the dispatch closed on an amendment it cannot honour", async () => {
    await withTestHarness(async (harness) => {
      const registry = emptyRegistry();
      registry.dispatch.push({
        pluginId: "router",
        handler: () =>
          ({
            action: "proceed",
            amend: { providerId: "not-a-provider" },
          }) as const,
      });
      installGates(registry);
      const { host, project } = seedGateFixture(harness, "host-gate-invalid");

      const error = await expectApiError(() =>
        createGatedThread(harness, { hostId: host.id, projectId: project.id }),
      );

      expect(error.status).toBe(502);
      expect(error.body.message).toContain('"router"');
      expect(error.body.message).toContain("not-a-provider");
    });
  });

  it("lets a gate repoint a never-started thread as its wait clears", async () => {
    // The re-attempt decides about a thread whose ROW exists but whose SESSION
    // does not, and the provider is immutable only once the session is. So the
    // amendment lands, on the row, and the thread starts where the second pass
    // said rather than where the first one did.
    await withTestHarness(async (harness) => {
      const registry = emptyRegistry();
      let pass = 0;
      registry.dispatch.push({
        pluginId: "router",
        handler: (context) => {
          pass += 1;
          if (pass === 1) {
            return { action: "wait", reason: "Choosing a model…" } as const;
          }
          // Still the thread's first dispatch even though it has been parked
          // for a while: that is the window the repoint is legal in.
          expect(context.firstDispatch).toBe(true);
          return {
            action: "proceed",
            amend: { providerId: "claude-code", model: "opus" },
          } as const;
        },
      });
      installGates(registry);
      const { host, project } = seedGateFixture(harness, "host-gate-repoint");

      const thread = await createGatedThread(harness, {
        hostId: host.id,
        projectId: project.id,
        providerId: "codex",
      });
      expect(getThread(harness.db, thread.id)?.providerId).toBe("codex");
      const parked = onlyParkedRow(harness, thread.id);

      await reattemptParkedRow(harness, {
        queuedMessageId: parked.id,
        threadId: thread.id,
      });

      expect(getThread(harness.db, thread.id)?.providerId).toBe("claude-code");
      expect(listQueuedThreadMessages(harness.db, thread.id)).toEqual([]);
    });
  });

  it("refuses an environment amendment once the creating attempt is over", async () => {
    // Re-resolving an environment intent means re-running most of thread
    // creation, which only the attempt that created the thread has in hand —
    // so the window is narrower than `firstDispatch` and closes at the park.
    await withTestHarness(async (harness) => {
      const registry = emptyRegistry();
      let pass = 0;
      registry.dispatch.push({
        pluginId: "placer",
        handler: () => {
          pass += 1;
          if (pass === 1) {
            return { action: "wait", reason: "Picking a machine…" } as const;
          }
          return {
            action: "proceed",
            amend: {
              environment: {
                type: "host",
                hostId: "host-gate-env-late",
                workspace: { type: "unmanaged", path: WORKSPACE_PATH },
              },
            },
          } as const;
        },
      });
      installGates(registry);
      const { host, project } = seedGateFixture(harness, "host-gate-env-late");

      const thread = await createGatedThread(harness, {
        hostId: host.id,
        projectId: project.id,
      });
      const parked = onlyParkedRow(harness, thread.id);

      const error = await expectApiError(() =>
        reattemptParkedRow(harness, {
          queuedMessageId: parked.id,
          threadId: thread.id,
        }),
      );

      expect(error.status).toBe(502);
      expect(error.body.message).toContain('"placer"');
      expect(error.body.message).toContain(
        "chosen on the attempt that creates it",
      );
      expect(turnRequests(harness, thread.id)).toHaveLength(0);
    });
  });

  it("refuses a providerId amendment on a thread that has already dispatched", async () => {
    await withTestHarness(async (harness) => {
      const registry = emptyRegistry();
      registry.dispatch.push({
        pluginId: "router",
        handler: () =>
          ({
            action: "proceed",
            amend: { providerId: "claude-code" },
          }) as const,
      });
      installGates(registry);
      const { thread } = seedRunnableThread(harness, {
        hostId: "host-gate-provider-lock",
        status: "idle",
      });

      const error = await expectApiError(() =>
        acceptThreadSendRequest(harness.deps, {
          payload: { input: textInput("hello"), mode: "auto" },
          thread,
        }),
      );

      expect(error.status).toBe(502);
      expect(error.body.message).toContain(
        "immutable once a provider session exists",
      );
    });
  });

  it("refuses an execution amendment on a join-turn attempt", async () => {
    // A steer joins a turn that is already running, so its execution tuple is
    // settled — the provider is mid-request with the model it was given.
    await withTestHarness(async (harness) => {
      const registry = emptyRegistry();
      registry.dispatch.push({
        pluginId: "router",
        handler: (context) => {
          expect(context.attempt).toBe("join-turn");
          return { action: "proceed", amend: { model: "opus" } } as const;
        },
      });
      installGates(registry);
      const { thread } = seedRunnableThread(harness, {
        hostId: "host-gate-steer-model",
        status: "active",
      });

      const error = await expectApiError(() =>
        acceptThreadSendRequest(harness.deps, {
          payload: { input: textInput("actually, stop"), mode: "steer" },
          thread,
        }),
      );

      expect(error.status).toBe(502);
      expect(error.body.message).toContain('"router"');
      expect(error.body.message).toContain("join-turn attempt");
    });
  });

  it("still lets a gate rewrite the input of a steer", async () => {
    // The one amendment that stays legal while joining: a steer's CONTENT is
    // still being decided at this moment, which is what lets a content-policy
    // gate cover steers instead of only covering sends.
    await withTestHarness(async (harness) => {
      const registry = emptyRegistry();
      registry.dispatch.push({
        pluginId: "rewriter",
        handler: () =>
          ({
            action: "proceed",
            amend: { input: textInput("redacted steer") },
          }) as const,
      });
      installGates(registry);
      const { thread } = seedRunnableThread(harness, {
        hostId: "host-gate-steer-input",
        status: "active",
      });

      await acceptThreadSendRequest(harness.deps, {
        payload: { input: textInput("my api key is hunter2"), mode: "steer" },
        thread,
      });

      const requested = turnRequests(harness, thread.id).at(-1);
      expect(requested).toBeDefined();
      const data = JSON.parse(requested!.data) as {
        amendedByPluginId?: string;
        input: unknown;
        originalInput?: unknown;
      };
      expect(data.amendedByPluginId).toBe("rewriter");
      expect(data.input).toEqual(textInput("redacted steer"));
      expect(data.originalInput).toEqual(textInput("my api key is hunter2"));
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

describe("dispatch gate plugin inputs and provenance", () => {
  it("delivers only the matching plugin's input, from the request and from a queued row", async () => {
    await withTestHarness(async (harness) => {
      const seen: Record<string, unknown> = {};
      const registry = emptyRegistry();
      const record =
        (key: string) => (context: PluginDispatchAttemptContext) => {
          seen[key] = context.pluginInput;
          return { action: "wait", reason: "inspecting" } as const;
        };
      registry.dispatch.push(
        { pluginId: "router", handler: record("router") },
        { pluginId: "bystander", handler: record("bystander") },
      );
      installGates(registry);
      const { host, project } = seedGateFixture(harness, "host-gate-inputs");

      await createGatedThread(harness, {
        hostId: host.id,
        projectId: project.id,
        pluginInputs: { router: { entry: "fast" } },
      });

      expect(seen.router).toEqual({ entry: "fast" });
      // A plugin nobody addressed sees null, never another plugin's entry.
      expect(seen.bystander).toBeNull();

      const { thread } = seedRunnableThread(harness, {
        hostId: "host-gate-inputs-send",
        status: "idle",
      });
      registry.dispatch.length = 0;
      registry.dispatch.push({
        pluginId: "router",
        handler: record("router-send"),
      });
      await createQueuedMessageForThread(harness.deps, {
        payload: {
          input: textInput("queued"),
          pluginInputs: { router: { entry: "slow" } },
        },
        thread,
      });
      await sendNextQueuedMessageIfPresent(harness.deps, {
        threadId: thread.id,
      });

      // The row carried the input from the send that queued it all the way to
      // the gate that ran when it drained...
      expect(seen["router-send"]).toEqual({ entry: "slow" });
      const parkedRow = listQueuedThreadMessages(harness.db, thread.id)[0];
      if (parkedRow === undefined) throw new Error("expected a parked row");
      // ...and survives the re-park, so the next attempt reaches the gate with
      // the input the message was sent with rather than an empty map.
      expect(parseQueuedMessagePluginInputs(parkedRow)).toEqual({
        router: { entry: "slow" },
      });
    });
  });

  it("never remembers a plugin's amendment as a project execution default", async () => {
    await withTestHarness(async (harness) => {
      const registry = emptyRegistry();
      registry.dispatch.push({
        pluginId: "router",
        handler: () =>
          ({ action: "proceed", amend: { model: "router-choice" } }) as const,
      });
      installGates(registry);
      const { host, project } = seedGateFixture(harness, "host-gate-defaults");

      // `origin: "app"` is the one origin that DOES reshape project defaults,
      // so this is the case where a leak would happen if it could.
      await createGatedThread(harness, {
        hostId: host.id,
        projectId: project.id,
        origin: "app",
        model: "user-choice",
      });

      const defaults = getProjectExecutionDefaults(harness.db, {
        projectId: project.id,
      });
      expect(defaults?.model).not.toBe("router-choice");
    });
  });

  it("records the amending plugin on the turn it amended", async () => {
    await withTestHarness(async (harness) => {
      const registry = emptyRegistry();
      registry.dispatch.push({
        pluginId: "rewriter",
        handler: () =>
          ({
            action: "proceed",
            amend: { input: textInput("rewritten by the plugin") },
          }) as const,
      });
      installGates(registry);
      const { thread } = seedRunnableThread(harness, {
        hostId: "host-gate-provenance",
        status: "idle",
      });

      await acceptThreadSendRequest(harness.deps, {
        payload: { input: textInput("what the user typed"), mode: "auto" },
        thread,
      });

      const requested = turnRequests(harness, thread.id).at(-1);
      expect(requested).toBeDefined();
      const data = JSON.parse(requested!.data) as {
        amendedByPluginId?: string;
        input: unknown;
        originalInput?: unknown;
      };
      expect(data.amendedByPluginId).toBe("rewriter");
      expect(data.input).toEqual(textInput("rewritten by the plugin"));
      // The user's words survive on the event, so a silent rewriter stays
      // debuggable after the fact.
      expect(data.originalInput).toEqual(textInput("what the user typed"));
    });
  });
});
