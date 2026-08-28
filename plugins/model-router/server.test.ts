// End-to-end wiring through the fake plugin host: settings and the provider
// catalog in, a gate that waits, a hidden routing thread spawned and read, and
// a cleared wait — amended or not — out.
//
// Prompt assembly, JSON extraction and answer validation are covered in
// routing.test.ts and the catalog shape in catalog.test.ts. What this file
// checks is the part only the wiring can get wrong: that a row is parked
// exactly when Auto was picked, that the routing thread cannot route itself,
// that every way the route can fail still lets the user's message go, that the
// routing thread is always cleaned up, and that the provider is amended only
// where a provider may still change — the last being a refused amendment if it
// is wrong.

import type {
  BbPluginApi,
  PluginDispatchGateContext,
  PluginThreadEventPayloads,
} from "@get-bb/plugin-sdk";
import {
  createFakePluginHost,
  makeQueueEntry,
  makeThreadResponse,
} from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import plugin, {
  EMPTY_ROUTING_PROMPT,
  readAutoEntry,
  readParkedText,
  ROUTING_WAIT_REASON,
} from "./server.js";

type ThreadResponse = PluginThreadEventPayloads["thread.created"]["thread"];
type QueueEntry = PluginThreadEventPayloads["queue.parked"]["entry"];
type ProviderInfo = Awaited<
  ReturnType<BbPluginApi["sdk"]["providers"]["list"]>
>[number];
type ExecutionOptions = Awaited<
  ReturnType<BbPluginApi["sdk"]["providers"]["models"]>
>;
type AvailableModel = ExecutionOptions["models"][number];

const PLUGIN_ID = "model-router";
const OWN_HOLDER = `plugin:${PLUGIN_ID}` as const;

const PROJECT = {
  id: "proj_1",
  kind: "standard" as const,
  name: "bb",
  gitRemoteUrl: null,
  createdAt: 1,
  updatedAt: 1,
};

const ROUTING_PROMPT = "Cheap model for questions, capable for refactors.";

function providerInfo(id: string): ProviderInfo {
  return {
    id,
    pluginId: id,
    displayName: id,
    logoUrl: null,
    maintenance: { health: false, usage: false, installation: false },
    capabilities: {
      supportsThreadArchive: false,
      supportsThreadRename: false,
      supportsServiceTier: false,
      supportsNativeUserQuestion: false,
      supportsFork: false,
      supportsSessionRewind: false,
      permissionModes: ["full"],
      modelCatalogScope: "host",
    },
    composerActions: [],
    available: true,
  } as ProviderInfo;
}

function availableModel(name: string): AvailableModel {
  return {
    id: name,
    model: name,
    displayName: name,
    description: "",
    supportedReasoningEfforts: [
      { reasoningEffort: "low", description: "" },
      { reasoningEffort: "high", description: "" },
    ],
    defaultReasoningEffort: "low",
    isDefault: false,
  } as AvailableModel;
}

const MODELS: Record<string, string[]> = {
  codex: ["gpt-5-mini", "gpt-5"],
  "claude-code": ["opus"],
};

/** A well-behaved routing answer against MODELS. */
const CHOSE_GPT5 = '```json\n{"providerId":"codex","model":"gpt-5","reasoningLevel":"high"}\n```';

interface ContextOverrides {
  text?: string;
  pluginInput?: PluginDispatchGateContext<"dispatch">["pluginInput"];
  providerId?: string;
  queuedMessage?: QueueEntry | null;
  originPluginId?: string | null;
}

function dispatchContext(
  overrides: ContextOverrides = {},
): PluginDispatchGateContext<"dispatch"> {
  return {
    stage: "dispatch",
    thread: threadResponse(),
    attempt: "start-turn",
    firstDispatch: true,
    queuedMessage: overrides.queuedMessage ?? null,
    project: PROJECT,
    environment: null,
    host: null,
    input: { blocks: [], text: overrides.text ?? "fix typo" },
    requestedExecution: {
      providerId: overrides.providerId ?? "codex",
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
    parentThreadId: null,
    // `??` would be wrong here: `null` is the meaningful "did not pick Auto"
    // value these tests need to pass through.
    pluginInput:
      overrides.pluginInput === undefined
        ? { entry: "default" }
        : overrides.pluginInput,
  };
}

/**
 * The routed thread. `pending` by default — a thread whose first message is
 * parked has no provider session yet, which is exactly the window a provider
 * amendment is legal in.
 */
function threadResponse(overrides: Partial<ThreadResponse> = {}): ThreadResponse {
  return makeThreadResponse({
    id: "thr_1",
    projectId: PROJECT.id,
    providerId: "codex",
    status: "pending",
    ...overrides,
  });
}

/** A row parked on this plugin's wait, as core would announce it. */
function parkedRow(overrides: Partial<QueueEntry> = {}): QueueEntry {
  return makeQueueEntry({
    id: "queued_1",
    threadId: "thr_1",
    content: [
      { type: "text", text: "refactor the dispatch pipeline", mentions: [] },
    ],
    waitingOn: {
      kind: "plugin",
      pluginId: PLUGIN_ID,
      reason: ROUTING_WAIT_REASON,
    },
    ...overrides,
  });
}

interface SetupOptions {
  settings?: Record<string, string | boolean>;
  thread?: Partial<ThreadResponse>;
  /** The routing thread's final output, or a thrower to fail the read. */
  output?: string | null;
  parked?: QueueEntry[];
  spawn?: () => Promise<ThreadResponse>;
  wait?: () => Promise<unknown>;
}

async function setup(options: SetupOptions = {}) {
  const spawned: unknown[][] = [];
  const stopped: string[] = [];
  const deleted: string[] = [];
  const { bb, harness } = createFakePluginHost({
    pluginId: PLUGIN_ID,
    settings: options.settings ?? { routingPrompt: ROUTING_PROMPT },
    sdk: {
      providers: {
        list: async () => Object.keys(MODELS).map(providerInfo),
        models: async ({ providerId }: { providerId?: string } = {}) =>
          ({
            providers: [],
            permissionCeiling: "full",
            models: (MODELS[providerId ?? ""] ?? []).map(availableModel),
            selectedOnlyModels: [],
            modelLoadError: null,
          }) as ExecutionOptions,
      },
      threads: {
        get: async () => threadResponse(options.thread ?? {}),
        queue: {
          list: async () => options.parked ?? [],
        },
        spawn: async (...args: unknown[]) => {
          spawned.push(args);
          if (options.spawn !== undefined) return options.spawn();
          return threadResponse({ id: "thr_routing", visibility: "hidden" });
        },
        wait: async () => {
          if (options.wait !== undefined) return options.wait();
          return { matched: true };
        },
        output: async () => ({
          output: options.output === undefined ? CHOSE_GPT5 : options.output,
        }),
        stop: async ({ threadId }: { threadId: string }) => {
          stopped.push(threadId);
          return { ok: true };
        },
        delete: async ({ threadId }: { threadId: string }) => {
          deleted.push(threadId);
          return { ok: true };
        },
      },
    },
  });
  await plugin(bb);
  return { bb, harness, spawned, stopped, deleted };
}

type Harness = Awaited<ReturnType<typeof setup>>["harness"];

/** Run the catalog service once (which also runs recovery), then stop it. */
async function loadCatalog(harness: Harness): Promise<void> {
  const service = harness.behavior.runService("catalog");
  await flush();
  service.controller.abort();
  await service.done;
}

async function flush(): Promise<void> {
  for (let index = 0; index < 12; index += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

function dispatchGate(harness: Harness) {
  const gate = harness.registrations.dispatchGates.dispatch;
  if (gate === null) throw new Error("the dispatch gate was not registered");
  return gate;
}

/** Drive one parked row through the plugin the way core would. */
async function route(
  harness: Harness,
  entry: QueueEntry = parkedRow(),
): Promise<void> {
  await harness.behavior.emitThreadEvent("queue.parked", { entry });
  await flush();
}

describe("readAutoEntry", () => {
  it("accepts only an object carrying a non-empty string entry", () => {
    // `pluginInput` is freeform JSON off a request body, so every one of these
    // is reachable from a caller that guessed at the convention. Anything but
    // the real shape has to read as "did not pick Auto" rather than as an
    // entry named "undefined".
    expect(readAutoEntry({ entry: "default" })).toBe("default");
    expect(readAutoEntry({ entry: "fast", extra: 1 })).toBe("fast");
    expect(readAutoEntry(null)).toBeNull();
    expect(readAutoEntry("default")).toBeNull();
    expect(readAutoEntry(["default"])).toBeNull();
    expect(readAutoEntry({})).toBeNull();
    expect(readAutoEntry({ entry: "" })).toBeNull();
    expect(readAutoEntry({ entry: "   " })).toBeNull();
    expect(readAutoEntry({ entry: 7 })).toBeNull();
    expect(readAutoEntry({ entry: null })).toBeNull();
  });
});

describe("readParkedText", () => {
  it("joins the text blocks", () => {
    expect(
      readParkedText(
        parkedRow({
          content: [
            { type: "text", text: "one", mentions: [] },
            { type: "text", text: "two", mentions: [] },
          ],
        }),
      ),
    ).toBe("one\ntwo");
  });
});

describe("the gate", () => {
  it("waits only when Auto was picked", async () => {
    const { harness } = await setup();
    await loadCatalog(harness);
    const gate = dispatchGate(harness);

    expect(await gate(dispatchContext({ pluginInput: null }))).toEqual({
      action: "proceed",
    });
    expect(await gate(dispatchContext({ pluginInput: { other: 1 } }))).toEqual({
      action: "proceed",
    });
    expect(await gate(dispatchContext())).toEqual({
      action: "wait",
      reason: ROUTING_WAIT_REASON,
    });
  });

  it("waits without a retryAt, so no timer dispatches mid-decision", async () => {
    // A timer would send the message while the routing thread was still
    // deciding, and the answer would arrive with nothing left to amend.
    const { harness } = await setup();
    await loadCatalog(harness);

    const verdict = await dispatchGate(harness)(dispatchContext());
    expect(verdict).not.toHaveProperty("retryAt");
  });

  it("never routes its own spawn, which is what stops the recursion", async () => {
    // The routing thread's own first message is a dispatch like any other.
    // Without this it would be routed by a routing thread, forever.
    const { harness, spawned } = await setup();
    await loadCatalog(harness);

    expect(
      await dispatchGate(harness)(
        dispatchContext({
          originPluginId: PLUGIN_ID,
          pluginInput: { entry: "default" },
        }),
      ),
    ).toEqual({ action: "proceed" });
    expect(spawned).toHaveLength(0);
  });

  it("proceeds on a re-attempt of a row it already parked", async () => {
    // Clearing a wait re-runs this gate against the dispatch just decided.
    // Waiting again would re-park what was just let go, forever. The row on
    // the context is how that is told from a fresh send.
    const { harness } = await setup();
    await loadCatalog(harness);

    expect(
      await dispatchGate(harness)(
        dispatchContext({ queuedMessage: parkedRow() }),
      ),
    ).toEqual({ action: "proceed" });
  });

  it("proceeds when there is no routing prompt, and says so", async () => {
    const { harness, bb } = await setup({ settings: { routingPrompt: "  " } });
    await loadCatalog(harness);

    expect(await dispatchGate(harness)(dispatchContext())).toEqual({
      action: "proceed",
    });
    expect(harness.needsConfigurationMessages).toContain(EMPTY_ROUTING_PROMPT);
    expect(bb.pluginId).toBe(PLUGIN_ID);
  });

  it("proceeds when no catalog has loaded yet", async () => {
    // Parking a send to then discover there was nothing to choose between is
    // a pause that buys nothing.
    const { harness } = await setup();

    expect(await dispatchGate(harness)(dispatchContext())).toEqual({
      action: "proceed",
    });
  });
});

describe("routing a parked row", () => {
  it("spawns a hidden routing thread and clears the wait with its answer", async () => {
    const { harness, spawned } = await setup();
    await loadCatalog(harness);
    await route(harness);

    const [args] = spawned;
    const request = args?.[0] as Record<string, unknown>;
    expect(request.visibility).toBe("hidden");
    expect(request.projectId).toBe(PROJECT.id);
    // Attribution is what exempts the routing thread from the concurrency
    // limiter; without it a full pool would deadlock every Auto send.
    expect(request.originPluginId).toBe(PLUGIN_ID);
    expect(String(request.prompt)).toContain(ROUTING_PROMPT);
    expect(String(request.prompt)).toContain("refactor the dispatch pipeline");

    // No `providerId`: the answer chose the provider the thread already has,
    // which the "changes nothing" case below covers.
    expect(harness.registrations.clearedQueueWaits).toEqual([
      {
        queuedMessageId: "queued_1",
        amend: { model: "gpt-5", reasoningLevel: "high" },
      },
    ]);
  });

  it("routes a pending thread across providers", async () => {
    // The invariant is that a provider is immutable once a provider SESSION
    // exists — a thread whose first turn is still parked is `pending` and has
    // none.
    const { harness } = await setup({
      thread: { providerId: "claude-code", status: "pending" },
    });
    await loadCatalog(harness);
    await route(harness);

    const [cleared] = harness.registrations.clearedQueueWaits;
    expect(cleared?.amend).toMatchObject({
      providerId: "codex",
      model: "gpt-5",
    });
  });

  it("never amends the provider of a thread that has already run", async () => {
    // An amendment core refuses is a wasted round trip at best, so the menu
    // the routing thread is shown is scoped instead of the answer filtered.
    const { harness, spawned } = await setup({
      thread: { providerId: "claude-code", status: "idle" },
      output: '```json\n{"providerId":"claude-code","model":"opus"}\n```',
    });
    await loadCatalog(harness);
    await route(harness);

    const request = spawned[0]?.[0] as Record<string, unknown>;
    expect(String(request.prompt)).toContain("cannot change provider");
    expect(String(request.prompt)).not.toContain("gpt-5");

    const [cleared] = harness.registrations.clearedQueueWaits;
    expect(cleared?.amend).not.toHaveProperty("providerId");
    expect(cleared?.amend).toMatchObject({ model: "opus" });
  });

  it("omits a providerId that would change nothing", async () => {
    // A provider amendment makes core re-validate the model and rewrite the
    // thread row; asking for the provider the thread already has pays for both
    // to change nothing.
    const { harness } = await setup({ thread: { providerId: "codex" } });
    await loadCatalog(harness);
    await route(harness);

    const [cleared] = harness.registrations.clearedQueueWaits;
    expect(cleared?.amend).not.toHaveProperty("providerId");
  });

  it("reuses the target thread's environment when it has one", async () => {
    const { harness, spawned } = await setup({
      thread: { environmentId: "env_1" },
    });
    await loadCatalog(harness);
    await route(harness);

    const request = spawned[0]?.[0] as Record<string, unknown>;
    expect(request.environment).toEqual({
      type: "reuse",
      environmentId: "env_1",
    });
  });

  it("asks for the project default when the thread has no environment yet", async () => {
    const { harness, spawned } = await setup({ thread: { environmentId: null } });
    await loadCatalog(harness);
    await route(harness);

    const request = spawned[0]?.[0] as Record<string, unknown>;
    expect(request.environment).toEqual({ type: "project-default" });
  });

  it("routes one row once, however many times it is announced", async () => {
    // A restart landing mid-flight fires both the event and the recovery pass
    // for the same row; two flows would spawn twice and race to clear.
    const { harness, spawned } = await setup();
    await loadCatalog(harness);
    const entry = parkedRow();
    await Promise.all([route(harness, entry), route(harness, entry)]);

    expect(spawned).toHaveLength(1);
    expect(harness.registrations.clearedQueueWaits).toHaveLength(1);
  });

  it("ignores rows it does not own", async () => {
    const { harness, spawned } = await setup();
    await loadCatalog(harness);
    await route(
      harness,
      parkedRow({
        waitingOn: {
          kind: "plugin",
          pluginId: "scheduled-send",
          reason: "Sending at 09:00",
        },
      }),
    );
    await route(harness, parkedRow({ waitingOn: { kind: "thread-busy" } }));

    expect(spawned).toHaveLength(0);
    expect(harness.registrations.clearedQueueWaits).toHaveLength(0);
  });
});

describe("failure and cleanup", () => {
  const failures: Array<[string, SetupOptions]> = [
    ["the spawn fails", { spawn: () => Promise.reject(new Error("no host")) }],
    ["the wait times out", { wait: () => Promise.reject(new Error("timed out")) }],
    ["the answer is empty", { output: null }],
    ["the answer is not JSON", { output: "I could not decide." }],
    [
      "the answer names a model nobody offers",
      { output: '```json\n{"providerId":"codex","model":"gpt-9"}\n```' },
    ],
    [
      "the answer names a provider the thread cannot use",
      {
        thread: { status: "idle" },
        output: '```json\n{"providerId":"claude-code","model":"opus"}\n```',
      },
    ],
  ];

  for (const [label, options] of failures) {
    it(`clears the wait unamended when ${label}`, async () => {
      // Auto's documented fallback is bb's own resolved provider and model. A
      // stranded row would be strictly worse than no routing plugin at all.
      const { harness } = await setup(options);
      await loadCatalog(harness);
      await route(harness);

      expect(harness.registrations.clearedQueueWaits).toEqual([
        { queuedMessageId: "queued_1", amend: undefined },
      ]);
    });
  }

  it("deletes the routing thread even when the route fails", async () => {
    // A routing thread that outlives its route is untidy forever, and the
    // timeout path is exactly when one is still running.
    const { harness, stopped, deleted } = await setup({
      wait: () => Promise.reject(new Error("timed out")),
    });
    await loadCatalog(harness);
    await route(harness);

    expect(stopped).toEqual(["thr_routing"]);
    expect(deleted).toEqual(["thr_routing"]);
  });

  it("deletes the routing thread after a successful route", async () => {
    const { harness, deleted } = await setup();
    await loadCatalog(harness);
    await route(harness);

    expect(deleted).toEqual(["thr_routing"]);
  });

  it("clears unamended when core refuses the amended clear", async () => {
    // Core refuses a providerId amendment BEFORE it clears anything, so the
    // row is still parked and the message can still be sent.
    const { harness, bb } = await setup({
      thread: { providerId: "claude-code", status: "pending" },
    });
    await loadCatalog(harness);
    let attempts = 0;
    const realClearWait = bb.experimental_dispatch.clearWait.bind(
      bb.experimental_dispatch,
    );
    bb.experimental_dispatch.clearWait = async (queuedMessageId, options) => {
      attempts += 1;
      if (attempts === 1) throw new Error("provider_not_amendable");
      return realClearWait(queuedMessageId, options);
    };
    await route(harness);

    expect(attempts).toBe(2);
    expect(harness.registrations.clearedQueueWaits).toEqual([
      { queuedMessageId: "queued_1", amend: undefined },
    ]);
  });

  it("does not route a retry row, which carries no prompt to route", async () => {
    const { harness, spawned } = await setup();
    await loadCatalog(harness);
    await route(
      harness,
      parkedRow({
        payload: {
          kind: "retry",
          retryOfTurnRequestId: "creq_aaaaaaaaaa",
          attempt: 2,
        },
      }),
    );

    expect(spawned).toHaveLength(0);
    expect(harness.registrations.clearedQueueWaits).toEqual([
      { queuedMessageId: "queued_1", amend: undefined },
    ]);
  });
});

describe("restart recovery", () => {
  it("re-drives the parked rows it already owns at startup", async () => {
    // A restart between the park and the clear leaves a parked row with
    // nobody deciding about it; core's orphan sweep is the backstop, not the
    // plan.
    const { harness, spawned } = await setup({
      parked: [parkedRow({ id: "queued_restarted" })],
    });
    await loadCatalog(harness);
    await flush();

    expect(harness.inspection.sdk.callsTo("threads.queue.list")[0]?.[0]).toEqual({
      waitHolder: OWN_HOLDER,
    });
    expect(spawned).toHaveLength(1);
    expect(harness.registrations.clearedQueueWaits).toEqual([
      {
        queuedMessageId: "queued_restarted",
        amend: { model: "gpt-5", reasoningLevel: "high" },
      },
    ]);
  });
});
