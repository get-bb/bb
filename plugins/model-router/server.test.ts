// End-to-end wiring through the fake plugin host: settings and system config
// in, the catalog fetched by the background service, one stubbed structured
// completion, gate verdicts out.
//
// The prompt assembly and answer validation are covered in routing.test.ts and
// the catalog shape in catalog.test.ts. What this file checks is the part only
// the wiring can get wrong: that a completion is asked for exactly when Auto
// was picked, that every way it can fail still leaves the dispatch untouched,
// and that the provider is amended only where a provider may still change —
// each of the last two being a fail-closed dispatch failure if it is wrong.

import type {
  BbPluginApi,
  JsonValue,
  PluginDispatchGateContext,
  PluginThreadEventPayloads,
} from "@get-bb/plugin-sdk";
import {
  createFakePluginHost,
  FakeAiCompletionError,
  makeThreadResponse,
  type ExperimentalFakeAiCompletionRequest,
} from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import plugin, {
  EMPTY_ROUTING_PROMPT,
  NO_INFERENCE_SERVICE,
  readAutoEntry,
} from "./server.js";

type ThreadResponse = PluginThreadEventPayloads["thread.created"]["thread"];
type ProviderInfo = Awaited<
  ReturnType<BbPluginApi["sdk"]["providers"]["list"]>
>[number];
type ExecutionOptions = Awaited<
  ReturnType<BbPluginApi["sdk"]["providers"]["models"]>
>;
type AvailableModel = ExecutionOptions["models"][number];
type SystemConfig = Awaited<ReturnType<BbPluginApi["sdk"]["system"]["config"]>>;

const PLUGIN_ID = "model-router";

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

interface ContextOverrides {
  text?: string;
  pluginInput?: PluginDispatchGateContext<"thread.create">["pluginInput"];
  providerId?: string;
  isReleaseReevaluation?: boolean;
}

function createContext(
  overrides: ContextOverrides = {},
): PluginDispatchGateContext<"thread.create"> {
  return {
    stage: "thread.create",
    thread: null,
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
    originPluginId: null,
    startedOnBehalfOf: null,
    parentThreadId: null,
    // `??` would be wrong here: `null` is the meaningful "did not pick Auto"
    // value these tests need to pass through.
    pluginInput:
      overrides.pluginInput === undefined
        ? { entry: "default" }
        : overrides.pluginInput,
    isReleaseReevaluation: overrides.isReleaseReevaluation ?? false,
    hold: null,
  };
}

function submitContext(
  thread: ThreadResponse,
  overrides: ContextOverrides = {},
): PluginDispatchGateContext<"turn.submit"> {
  return { ...createContext(overrides), stage: "turn.submit", thread };
}

interface SetupOptions {
  settings?: Record<string, string | boolean>;
  inferenceEnabled?: boolean;
  complete?: (
    request: ExperimentalFakeAiCompletionRequest,
  ) => Record<string, JsonValue> | Promise<Record<string, JsonValue>>;
}

async function setup(options: SetupOptions = {}) {
  const requests: ExperimentalFakeAiCompletionRequest[] = [];
  const { bb, harness } = createFakePluginHost({
    pluginId: PLUGIN_ID,
    settings: options.settings ?? { routingPrompt: ROUTING_PROMPT },
    sdk: {
      system: {
        // Only `aiServices` is read here, and SystemConfig has eighteen other
        // fields whose values this plugin never looks at; the empty spread is
        // the one cast, rather than eighteen invented values that would go
        // stale the moment the response grows a field.
        config: async (): Promise<SystemConfig> => ({
          ...({} as SystemConfig),
          aiServices: {
            inference: "codex/gpt-5",
            inferenceFallback: "codex/gpt-5",
            transcription: "openai/whisper-1",
            services: [],
            inferenceEnabled: options.inferenceEnabled ?? true,
          },
        }),
      },
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
    },
    ...(options.complete === undefined
      ? {}
      : {
          experimental_completeAiRequest: (request) => {
            requests.push(request);
            return options.complete!(request);
          },
        }),
  });
  await plugin(bb);
  return { bb, harness, requests };
}

/** Run the catalog service exactly once, then stop it. */
async function loadCatalog(
  harness: Awaited<ReturnType<typeof setup>>["harness"],
): Promise<void> {
  const service = harness.behavior.runService("catalog");
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

/** The answer a well-behaved routing model gives against MODELS. */
const CHOSE_GPT5 = { providerId: "codex", model: "gpt-5", reasoningLevel: "high" };

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

describe("trigger detection", () => {
  it("asks for a completion only when Auto was picked", async () => {
    const { harness, requests } = await setup({ complete: () => CHOSE_GPT5 });
    await loadCatalog(harness);
    const gate = createGate(harness);

    expect(await gate(createContext({ pluginInput: null }))).toEqual({
      action: "proceed",
    });
    expect(await gate(createContext({ pluginInput: { other: 1 } }))).toEqual({
      action: "proceed",
    });
    // Not merely "no amendment": a dispatch that did not pick Auto must not
    // pay for an inference call at all, since this gate runs on every send.
    expect(requests).toHaveLength(0);

    await gate(createContext());
    expect(requests).toHaveLength(1);
  });

  it("sends the rules, the request and a budget inside the gate box", async () => {
    const { harness, requests } = await setup({ complete: () => CHOSE_GPT5 });
    await loadCatalog(harness);
    await createGate(harness)(createContext({ text: "refactor the pipeline" }));

    const request = requests[0];
    expect(request.prompt).toContain(ROUTING_PROMPT);
    expect(request.prompt).toContain("refactor the pipeline");
    expect(request.prompt).toContain('model "opus"');
    // A gate is boxed at 10s and fail-closed, so the budget has to leave the
    // rest of the pass room to finish.
    expect(request.timeoutMs).toBeLessThan(10_000);
  });

  it("never asks before a catalog exists", async () => {
    // The gate must not query anything, so an unfetched catalog means there is
    // nothing to route with — not that it should go and find out.
    const { harness, requests } = await setup({ complete: () => CHOSE_GPT5 });
    expect(await createGate(harness)(createContext())).toEqual({
      action: "proceed",
    });
    expect(requests).toHaveLength(0);
  });

  it("never asks without a routing prompt", async () => {
    const { harness, requests } = await setup({
      settings: { routingPrompt: "   " },
      complete: () => CHOSE_GPT5,
    });
    await loadCatalog(harness);
    expect(await createGate(harness)(createContext())).toEqual({
      action: "proceed",
    });
    expect(requests).toHaveLength(0);
  });
});

describe("amendments", () => {
  it("amends provider, model and level when a thread is being created", async () => {
    const { harness } = await setup({ complete: () => CHOSE_GPT5 });
    await loadCatalog(harness);
    expect(await createGate(harness)(createContext())).toEqual({
      action: "proceed",
      amend: { providerId: "codex", model: "gpt-5", reasoningLevel: "high" },
    });
  });

  it("never amends providerId at submit or on a release re-evaluation", async () => {
    // Both would fail the dispatch outright: a thread's provider is fixed when
    // its row is inserted. This is the guard, and it is the one mistake in
    // this plugin that produces a user-visible outage rather than a no-op.
    const { harness } = await setup({
      complete: () => ({ providerId: "codex", model: "gpt-5-mini" }),
    });
    await loadCatalog(harness);
    const thread = makeThreadResponse({ id: "thr_1", projectId: PROJECT.id });

    expect(await submitGate(harness)(submitContext(thread))).toEqual({
      action: "proceed",
      amend: { model: "gpt-5-mini" },
    });
    expect(
      await createGate(harness)(createContext({ isReleaseReevaluation: true })),
    ).toEqual({ action: "proceed", amend: { model: "gpt-5-mini" } });
  });

  it("offers a locked thread only its own provider's models", async () => {
    const { harness, requests } = await setup({
      complete: () => ({ providerId: "codex", model: "gpt-5" }),
    });
    await loadCatalog(harness);
    const thread = makeThreadResponse({ id: "thr_1", projectId: PROJECT.id });
    await submitGate(harness)(submitContext(thread, { providerId: "codex" }));
    expect(requests[0].prompt).not.toContain("opus");
  });

  it("clamps a level the chosen model does not advertise", async () => {
    // The fixture models advertise only low and high; `ultra` would be an
    // amendment core refuses, so it must never leave this plugin.
    const { harness } = await setup({
      complete: () => ({
        providerId: "codex",
        model: "gpt-5",
        reasoningLevel: "ultra",
      }),
    });
    await loadCatalog(harness);
    expect(await createGate(harness)(createContext())).toEqual({
      action: "proceed",
      amend: { providerId: "codex", model: "gpt-5", reasoningLevel: "high" },
    });
  });
});

describe("fallbacks", () => {
  const cases: Array<[string, SetupOptions["complete"]]> = [
    [
      "a model that is not in the catalog",
      () => ({ providerId: "codex", model: "gpt-9" }),
    ],
    [
      "a provider that is not in the catalog",
      () => ({ providerId: "gemini", model: "gpt-5" }),
    ],
    [
      "a reasoning level bb does not have",
      () => ({
        providerId: "codex",
        model: "gpt-5",
        reasoningLevel: "turbo",
      }),
    ],
    [
      "a timeout",
      () => {
        throw new FakeAiCompletionError("timeout");
      },
    ],
    [
      "no inference service",
      () => {
        throw new FakeAiCompletionError("no-service-configured");
      },
    ],
    [
      "an upstream failure",
      () => {
        throw new FakeAiCompletionError("request-failed");
      },
    ],
    [
      "a rejection that is not bb's at all",
      () => {
        throw new Error("boom");
      },
    ],
  ];

  for (const [label, complete] of cases) {
    it(`proceeds unamended on ${label}`, async () => {
      // `proceed` with no `amend` key at all: an `amend: {}` would still be an
      // amendment record core has to validate and attribute to this plugin.
      const { harness } = await setup({ complete });
      await loadCatalog(harness);
      const thread = makeThreadResponse({ id: "thr_1", projectId: PROJECT.id });
      expect(await createGate(harness)(createContext())).toEqual({
        action: "proceed",
      });
      expect(await submitGate(harness)(submitContext(thread))).toEqual({
        action: "proceed",
      });
    });
  }

  it("proceeds unamended when no completion API is available at all", async () => {
    // An unstubbed fake host rejects with `no-service-configured`, which is
    // what an unconfigured bb does — the plugin must survive it.
    const { harness } = await setup();
    await loadCatalog(harness);
    expect(await createGate(harness)(createContext())).toEqual({
      action: "proceed",
    });
  });
});

describe("status", () => {
  it("asks for a routing prompt when there is none", async () => {
    const { harness } = await setup({ settings: { routingPrompt: "" } });
    expect(harness.needsConfigurationMessages.join(" ")).toContain(
      EMPTY_ROUTING_PROMPT,
    );
  });

  it("stays quiet once the prompt is set and inference is available", async () => {
    const { harness } = await setup();
    await loadCatalog(harness);
    expect(harness.needsConfigurationMessages).toEqual([]);
  });

  it("reports a missing inference service found by the startup probe", async () => {
    const { harness } = await setup({ inferenceEnabled: false });
    await loadCatalog(harness);
    expect(harness.needsConfigurationMessages.join(" ")).toContain(
      NO_INFERENCE_SERVICE,
    );
  });

  it("reports a missing inference service a real call proved", async () => {
    // The probe can be stale — a service can be disabled between refreshes —
    // so the call that failed is the more current answer and must be believed.
    const { harness } = await setup({
      complete: () => {
        throw new FakeAiCompletionError("no-service-configured");
      },
    });
    await loadCatalog(harness);
    expect(harness.needsConfigurationMessages).toEqual([]);

    await createGate(harness)(createContext());
    expect(harness.needsConfigurationMessages.join(" ")).toContain(
      NO_INFERENCE_SERVICE,
    );
  });
});
