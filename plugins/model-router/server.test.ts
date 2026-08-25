// End-to-end wiring through the fake plugin host: settings in, catalog
// fetched by the background service, gate verdicts out.
//
// The routing arithmetic is covered in routing.test.ts and the catalog shape
// in catalog.test.ts; what this file checks is that the pieces are connected
// to the right inputs — that the gate reads `pluginInput` and the execution
// sources it claims to, that the catalog reaches it, and that neither stage
// produces an amendment the server would reject.

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
type ProviderInfo = Awaited<
  ReturnType<BbPluginApi["sdk"]["providers"]["list"]>
>[number];
type ExecutionOptions = Awaited<
  ReturnType<BbPluginApi["sdk"]["providers"]["models"]>
>;
type AvailableModel = ExecutionOptions["models"][number];

const PLUGIN_ID = "model-router";

const PROJECT = {
  id: "proj_1",
  kind: "standard" as const,
  name: "bb",
  gitRemoteUrl: null,
  createdAt: 1,
  updatedAt: 1,
};

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
  model?: string | null;
  modelSource?: "explicit" | null;
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
      model: overrides.model ?? null,
      reasoningLevel: null,
      serviceTier: null,
      permissionMode: null,
    },
    executionSources: {
      providerId: null,
      model: overrides.modelSource ?? null,
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

const CONFIGURED = {
  fastModel: "codex/gpt-5-mini",
  capableModel: "claude-code/opus",
  lengthThreshold: "100",
  capableKeywords: "refactor",
};

async function setup(settings: Record<string, string | boolean> = {}) {
  const { bb, harness } = createFakePluginHost({
    pluginId: PLUGIN_ID,
    settings,
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
    },
  });
  await plugin(bb);
  return { bb, harness };
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

describe("registration", () => {
  it("registers a gate at both stages", async () => {
    const { harness } = await setup(CONFIGURED);
    expect(harness.registrations.dispatchGates["thread.create"]).not.toBeNull();
    expect(harness.registrations.dispatchGates["turn.submit"]).not.toBeNull();
  });

  it("reports unconfigured slots and changes nothing", async () => {
    // Installing the plugin must not alter dispatch behaviour before it is
    // configured — and must say so rather than throw, because a gate that
    // threw would fail every dispatch in the server with this plugin named.
    const { harness } = await setup();
    await loadCatalog(harness);
    expect(harness.needsConfigurationMessages.length).toBeGreaterThan(0);
    expect(await createGate(harness)(createContext())).toEqual({
      action: "proceed",
    });
  });

  it("reports a slot that no available provider offers", async () => {
    const { harness } = await setup({
      ...CONFIGURED,
      fastModel: "codex/gpt-4",
    });
    await loadCatalog(harness);
    expect(harness.needsConfigurationMessages.join(" ")).toContain(
      "codex/gpt-4",
    );
  });

  it("proceeds unamended before the catalog has loaded", async () => {
    // The service has not run, so there is nothing to route with. An Auto
    // request falls back to the project default rather than holding.
    const { harness } = await setup(CONFIGURED);
    expect(await createGate(harness)(createContext())).toEqual({
      action: "proceed",
    });
  });
});

describe("the create gate", () => {
  it("amends provider, model and reasoning level for an Auto request", async () => {
    const { harness } = await setup(CONFIGURED);
    await loadCatalog(harness);
    expect(await createGate(harness)(createContext({ text: "fix typo" }))).toEqual(
      {
        action: "proceed",
        amend: {
          providerId: "codex",
          model: "gpt-5-mini",
          reasoningLevel: "low",
        },
      },
    );
  });

  it("promotes a keyword prompt to the capable provider", async () => {
    const { harness } = await setup(CONFIGURED);
    await loadCatalog(harness);
    expect(
      await createGate(harness)(createContext({ text: "refactor this" })),
    ).toEqual({
      action: "proceed",
      amend: {
        providerId: "claude-code",
        model: "opus",
        reasoningLevel: "high",
      },
    });
  });

  it("ignores a request that did not select Auto", async () => {
    const { harness } = await setup(CONFIGURED);
    await loadCatalog(harness);
    expect(
      await createGate(harness)(createContext({ pluginInput: null })),
    ).toEqual({ action: "proceed" });
  });

  it("never amends the provider while releasing a hold", async () => {
    // The thread row already carries its provider; amending it here fails the
    // dispatch outright, so the provider is as fixed as it is at submit.
    const { harness } = await setup(CONFIGURED);
    await loadCatalog(harness);
    const verdict = await createGate(harness)(
      createContext({ text: "refactor this", isReleaseReevaluation: true }),
    );
    expect(verdict).toEqual({
      action: "proceed",
      amend: { model: "gpt-5-mini", reasoningLevel: "high" },
    });
  });
});

describe("the submit gate", () => {
  it("amends the model within the thread's provider and never the provider", async () => {
    const { harness } = await setup(CONFIGURED);
    await loadCatalog(harness);
    const thread = makeThreadResponse({ id: "thr_1", providerId: "codex" });
    const verdict = await submitGate(harness)(
      submitContext(thread, { text: "refactor this" }),
    );
    // `claude-code/opus` is the capable slot, but this thread runs on codex —
    // so the codex model runs the prompt, at capable effort.
    expect(verdict).toEqual({
      action: "proceed",
      amend: { model: "gpt-5-mini", reasoningLevel: "high" },
    });
  });

  it("leaves an explicitly chosen model alone in defaulted mode", async () => {
    const { harness } = await setup({
      ...CONFIGURED,
      routeDefaultedFields: true,
    });
    await loadCatalog(harness);
    const thread = makeThreadResponse({ id: "thr_1", providerId: "codex" });
    const verdict = await submitGate(harness)(
      submitContext(thread, {
        text: "refactor this",
        pluginInput: null,
        model: "gpt-5",
        modelSource: "explicit",
      }),
    );
    expect(verdict).toEqual({
      action: "proceed",
      amend: { reasoningLevel: "high" },
    });
  });
});
