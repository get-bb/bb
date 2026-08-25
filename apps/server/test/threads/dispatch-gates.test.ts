import {
  getAppSettings,
  getProjectExecutionDefaults,
  getThread,
  setAppSettings,
  listDispatchHolds,
  listEvents,
  listQueuedThreadMessages,
} from "@bb/db";
import type { PluginInputs } from "@bb/domain";
import type {
  PluginDispatchGateStage,
  PluginThreadCreateGateContext,
  PluginTurnSubmitGateContext,
} from "@get-bb/plugin-sdk";
import { afterEach, describe, expect, it } from "vitest";
import { ApiError } from "../../src/errors.js";
import {
  setDispatchGateProvider,
  type DispatchGateRegistration,
} from "../../src/services/plugins/dispatch-gate-registry.js";
import { releaseDispatchHoldAndDispatch } from "../../src/services/threads/dispatch-hold-release.js";
import { parseDispatchHoldPayload } from "../../src/services/threads/dispatch-holds.js";
import { createQueuedMessageForThread } from "../../src/services/threads/queued-messages.js";
import { sendNextQueuedMessageIfPresent } from "../../src/services/threads/queued-messages.js";
import { acceptThreadSendRequest } from "../../src/services/threads/thread-send-request.js";
import { createThreadFromRequest } from "../../src/services/threads/thread-create.js";
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
  return { "thread.create": [], "turn.submit": [] };
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

function liveHolds(harness: TestAppHarness, threadId: string) {
  return listDispatchHolds(harness.db, { threadId, liveOnly: true });
}

function inlineHoldPayload(harness: TestAppHarness, threadId: string) {
  const hold = liveHolds(harness, threadId)[0];
  if (hold === undefined) throw new Error("expected a live hold");
  const payload = parseDispatchHoldPayload(hold);
  if (payload.kind !== "inline") throw new Error("expected an inline payload");
  return { hold, payload };
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
      registry["thread.create"].push(
        {
          pluginId: "first",
          handler: (context: PluginThreadCreateGateContext) => {
            seen.push("first");
            return {
              action: "proceed",
              amend: { model: "amended-by-first" },
            } as const;
          },
        },
        {
          pluginId: "second",
          handler: (context: PluginThreadCreateGateContext) => {
            seen.push("second");
            secondSawModel = context.requestedExecution.model;
            // Holding here parks the dispatch so the frozen tuple is
            // observable without dispatching a real turn.
            return { action: "hold", reason: "checking" } as const;
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
      const { payload } = inlineHoldPayload(harness, thread.id);
      expect(payload.execution.model).toBe("amended-by-first");
    });
  });

  it("collects holds across a full pass so the parked row is fully resolved", async () => {
    await withTestHarness(async (harness) => {
      const registry = emptyRegistry();
      registry["thread.create"].push(
        {
          pluginId: "limiter",
          handler: () =>
            ({ action: "hold", reason: "4 of 4 running" }) as const,
        },
        {
          pluginId: "router",
          handler: () =>
            ({
              action: "proceed",
              amend: { providerId: "claude-code", model: "opus" },
            }) as const,
        },
      );
      installGates(registry);
      const { host, project } = seedGateFixture(harness, "host-gate-collect");

      const thread = await createGatedThread(harness, {
        hostId: host.id,
        projectId: project.id,
      });

      // The router ran even though the limiter already voted to hold, so the
      // provider frozen on the row is the one the whole chain agreed on.
      expect(getThread(harness.db, thread.id)?.providerId).toBe("claude-code");
      const { hold, payload } = inlineHoldPayload(harness, thread.id);
      expect(payload.execution.model).toBe("opus");
      // One row per pass, owned by the first holder; the rest are named in the
      // reason so the user sees one card, not one per gate.
      expect(liveHolds(harness, thread.id)).toHaveLength(1);
      expect(hold.holder).toBe("plugin:limiter");
      expect(hold.reason).toBe("4 of 4 running");
    });
  });

  it("names every holder on the reason when a pass collects several", async () => {
    await withTestHarness(async (harness) => {
      const registry = emptyRegistry();
      registry["thread.create"].push(
        {
          pluginId: "limiter",
          handler: () => ({ action: "hold", reason: "at capacity" }) as const,
        },
        {
          pluginId: "quiet-hours",
          handler: () => ({ action: "hold", reason: "after hours" }) as const,
        },
      );
      installGates(registry);
      const { host, project } = seedGateFixture(harness, "host-gate-multi");

      const thread = await createGatedThread(harness, {
        hostId: host.id,
        projectId: project.id,
      });

      const holds = liveHolds(harness, thread.id);
      expect(holds).toHaveLength(1);
      expect(holds[0]?.holder).toBe("plugin:limiter");
      expect(holds[0]?.reason).toBe(
        "at capacity (also held by quiet-hours: after hours)",
      );
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
      registry["thread.create"].push(record("a"), record("b"), record("c"));
      installGates(registry);
      // The user pinned c first; a and b keep their install order behind it,
      // exactly like `providerOrder`, and an id that names no gate is ignored.
      setAppSettings(harness.db, {
        ...getAppSettings(harness.db),
        dispatchGateOrder: { "thread.create": ["c", "not-installed"] },
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
      registry["thread.create"].push(
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
        stage: "thread.create",
      });
      expect(laterGateRan).toBe(false);
      // Nothing persisted: a rejected create leaves no thread behind.
      expect(
        listDispatchHolds(harness.db, { threadId: "any" }),
      ).toEqual([]);
    });
  });
});

describe("dispatch gate failure model", () => {
  it("fails the dispatch closed when a gate throws", async () => {
    await withTestHarness(async (harness) => {
      const registry = emptyRegistry();
      registry["thread.create"].push({
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
      registry["thread.create"].push({
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

  it("fails the dispatch closed on an amendment it cannot honour", async () => {
    await withTestHarness(async (harness) => {
      const registry = emptyRegistry();
      registry["thread.create"].push({
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

  it("refuses a providerId amendment on an existing thread", async () => {
    await withTestHarness(async (harness) => {
      const registry = emptyRegistry();
      registry["turn.submit"].push({
        pluginId: "router",
        handler: () =>
          // Structurally impossible in TypeScript; a runtime plugin can still
          // do it, and it must fail rather than silently disagree with the row.
          ({
            action: "proceed",
            amend: { providerId: "claude-code" },
          }) as never,
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
      expect(error.body.message).toContain("provider is fixed");
    });
  });
});

describe("dispatch gates and the no-gate path", () => {
  it("leaves creation unchanged when the stage has no gates", async () => {
    await withTestHarness(async (harness) => {
      // A provider is registered, but it declares no `thread.create` gate:
      // the pass must not run, take the lock, or allocate a hold row.
      const registry = emptyRegistry();
      registry["turn.submit"].push({
        pluginId: "send-only",
        handler: () => ({ action: "reject", message: "never" }) as const,
      });
      installGates(registry);
      const { host, project } = seedGateFixture(harness, "host-gate-none");

      const thread = await createGatedThread(harness, {
        hostId: host.id,
        projectId: project.id,
      });

      expect(listDispatchHolds(harness.db, { threadId: thread.id })).toEqual(
        [],
      );
      const types = listEvents(harness.db, { threadId: thread.id }).map(
        (event) => event.type,
      );
      expect(types).toContain("client/turn/requested");
      expect(types).not.toContain("system/dispatch-hold");
    });
  });

  it("exempts a steer into a live turn", async () => {
    await withTestHarness(async (harness) => {
      let gateRan = false;
      const registry = emptyRegistry();
      registry["turn.submit"].push({
        pluginId: "limiter",
        handler: () => {
          gateRan = true;
          return { action: "reject", message: "no" } as const;
        },
      });
      installGates(registry);
      const { thread } = seedRunnableThread(harness, {
        hostId: "host-gate-steer",
        status: "active",
      });

      // A steer joins the turn already running; there is no dispatch decision
      // left to make, so the gate never sees it.
      await acceptThreadSendRequest(harness.deps, {
        payload: { input: textInput("actually, stop"), mode: "steer" },
        thread,
      });

      expect(gateRan).toBe(false);
      expect(liveHolds(harness, thread.id)).toEqual([]);
    });
  });
});

describe("dispatch gates on the queue drain", () => {
  it("consumes the queued message exactly once when the drain is held", async () => {
    await withTestHarness(async (harness) => {
      const registry = emptyRegistry();
      registry["turn.submit"].push({
        pluginId: "limiter",
        handler: () => ({ action: "hold", reason: "at capacity" }) as const,
      });
      installGates(registry);
      const { thread } = seedRunnableThread(harness, {
        hostId: "host-gate-drain",
        status: "idle",
      });
      await createQueuedMessageForThread(harness.deps, {
        payload: { input: textInput("queued work") },
        thread,
      });
      const turnsBefore = turnRequests(harness, thread.id).length;

      const drained = await sendNextQueuedMessageIfPresent(harness.deps, {
        threadId: thread.id,
      });

      expect(drained).toBe(true);
      // Consumed exactly as a successful send would consume it, and converted
      // into the hold rather than left in the queue to drain again.
      expect(listQueuedThreadMessages(harness.db, thread.id)).toEqual([]);
      const { hold, payload } = inlineHoldPayload(harness, thread.id);
      expect(hold.holder).toBe("plugin:limiter");
      expect(payload.input).toEqual(textInput("queued work"));
      expect(turnRequests(harness, thread.id)).toHaveLength(turnsBefore);
    });
  });
});

describe("dispatch gates at release", () => {
  it("re-runs the pass and skips only the owning gate on a user release", async () => {
    await withTestHarness(async (harness) => {
      const owner = { calls: 0 };
      const other = { calls: 0, release: false };
      const registry = emptyRegistry();
      registry["turn.submit"].push(
        {
          pluginId: "limiter",
          handler: () => {
            owner.calls += 1;
            return { action: "hold", reason: "at capacity" } as const;
          },
        },
        {
          pluginId: "auditor",
          handler: (context: PluginTurnSubmitGateContext) => {
            other.calls += 1;
            other.release ||= context.isReleaseReevaluation;
            return { action: "proceed" } as const;
          },
        },
      );
      installGates(registry);
      const { thread } = seedRunnableThread(harness, {
        hostId: "host-gate-release",
        status: "idle",
      });
      await acceptThreadSendRequest(harness.deps, {
        payload: { input: textInput("do it"), mode: "auto" },
        thread,
      });
      const { hold } = inlineHoldPayload(harness, thread.id);
      expect(owner.calls).toBe(1);
      expect(other.calls).toBe(1);

      await releaseDispatchHoldAndDispatch(harness.deps, {
        hold,
        releaseKind: "user",
      });

      // The user overrode the limiter, so it is not re-asked; every other gate
      // still runs once, and sees the pass as a re-evaluation.
      expect(owner.calls).toBe(1);
      expect(other.calls).toBe(2);
      expect(other.release).toBe(true);
      expect(liveHolds(harness, thread.id)).toEqual([]);
    });
  });

  it("re-holds instead of dispatching when the owner releases into a full limiter", async () => {
    await withTestHarness(async (harness) => {
      const registry = emptyRegistry();
      registry["turn.submit"].push({
        pluginId: "limiter",
        handler: () => ({ action: "hold", reason: "still full" }) as const,
      });
      installGates(registry);
      const { thread } = seedRunnableThread(harness, {
        hostId: "host-gate-rehold",
        status: "idle",
      });
      await acceptThreadSendRequest(harness.deps, {
        payload: { input: textInput("do it"), mode: "auto" },
        thread,
      });
      const first = inlineHoldPayload(harness, thread.id).hold;
      const turnsBefore = turnRequests(harness, thread.id).length;

      // An `owner` release keeps the owner's own gate in the pass, so a
      // limiter that is still full parks the turn again instead of exceeding
      // its limit.
      await releaseDispatchHoldAndDispatch(harness.deps, {
        hold: first,
        releaseKind: "owner",
      });

      const live = liveHolds(harness, thread.id);
      expect(live).toHaveLength(1);
      expect(live[0]?.id).not.toBe(first.id);
      expect(live[0]?.reason).toBe("still full");
      expect(turnRequests(harness, thread.id)).toHaveLength(turnsBefore);
    });
  });

  it("paces a thread that just re-held so a release loop cannot spin", async () => {
    await withTestHarness(async (harness) => {
      const registry = emptyRegistry();
      registry["turn.submit"].push({
        pluginId: "limiter",
        handler: () => ({ action: "hold", reason: "still full" }) as const,
      });
      installGates(registry);
      const { thread } = seedRunnableThread(harness, {
        hostId: "host-gate-pace",
        status: "idle",
      });
      await acceptThreadSendRequest(harness.deps, {
        payload: { input: textInput("do it"), mode: "auto" },
        thread,
      });
      const first = inlineHoldPayload(harness, thread.id).hold;
      await releaseDispatchHoldAndDispatch(harness.deps, {
        hold: first,
        releaseKind: "owner",
      });
      const second = inlineHoldPayload(harness, thread.id).hold;

      // The previous release turned straight back into a hold, so the next
      // attempt is refused outright — the hold stays live and nothing settles.
      const paced = await releaseDispatchHoldAndDispatch(harness.deps, {
        hold: second,
        releaseKind: "owner",
      });

      expect(paced).toBeNull();
      expect(liveHolds(harness, thread.id).map((row) => row.id)).toEqual([
        second.id,
      ]);
    });
  });
});

describe("dispatch gate plugin inputs and provenance", () => {
  it("delivers only the matching plugin's input, from the request and from a queued row", async () => {
    await withTestHarness(async (harness) => {
      const seen: Record<string, unknown> = {};
      const registry = emptyRegistry();
      const record =
        (pluginId: string) =>
        (
          context:
            | PluginThreadCreateGateContext
            | PluginTurnSubmitGateContext,
        ) => {
          seen[pluginId] = context.pluginInput;
          return { action: "hold", reason: "inspecting" } as const;
        };
      registry["thread.create"].push(
        { pluginId: "router", handler: record("router") },
        { pluginId: "bystander", handler: record("bystander") },
      );
      registry["turn.submit"].push({
        pluginId: "router",
        handler: record("router-send"),
      });
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
      // the gate that ran when it drained.
      expect(seen["router-send"]).toEqual({ entry: "slow" });
      expect(inlineHoldPayload(harness, thread.id).payload.pluginInputs).toEqual(
        { router: { entry: "slow" } },
      );
    });
  });

  it("never remembers a plugin's amendment as a project execution default", async () => {
    await withTestHarness(async (harness) => {
      const registry = emptyRegistry();
      registry["thread.create"].push({
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
      registry["turn.submit"].push({
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
