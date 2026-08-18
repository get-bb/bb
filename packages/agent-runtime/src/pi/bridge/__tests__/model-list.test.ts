import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";

const { getAvailable, getSupportedThinkingLevels, refresh } = vi.hoisted(
  () => ({
    getAvailable: vi.fn(),
    getSupportedThinkingLevels: vi.fn(),
    refresh: vi.fn(async () => ({ aborted: false, errors: new Map() })),
  }),
);

vi.mock("@earendil-works/pi-ai", () => ({
  getSupportedThinkingLevels,
}));

import { createPiModelContextWindowResolverFrom } from "../../delta-translation.js";
import {
  listPiBridgeModels,
  resetPiModelNetworkRefreshForTests,
} from "../model-list.js";

const modelRuntime = { getAvailable, refresh } as unknown as ModelRuntime;

describe("pi bridge model list", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetPiModelNetworkRefreshForTests();
    delete process.env.PI_OFFLINE;
  });

  it("builds available models from the shared Pi model runtime", async () => {
    getAvailable.mockResolvedValue([
      {
        id: "claude-sonnet-5",
        input: ["text", "image"],
        name: "Claude Sonnet 5",
        provider: "anthropic",
        reasoning: true,
      },
    ]);
    getSupportedThinkingLevels.mockReturnValue([
      "off",
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ]);

    await expect(listPiBridgeModels(modelRuntime)).resolves.toEqual({
      models: [
        {
          id: "anthropic/claude-sonnet-5",
          model: "anthropic/claude-sonnet-5",
          displayName: "Claude Sonnet 5",
          routeProviderId: "anthropic",
          description: "Anthropic reasoning, multimodal model via Pi",
          supportedReasoningEfforts: [
            {
              reasoningEffort: "none",
              description: "No extended thinking",
            },
            { reasoningEffort: "low", description: "Low reasoning effort" },
            {
              reasoningEffort: "medium",
              description: "Medium reasoning effort",
            },
            { reasoningEffort: "high", description: "High reasoning effort" },
            {
              reasoningEffort: "xhigh",
              description: "Extra high reasoning effort",
            },
            {
              reasoningEffort: "max",
              description: "Maximum reasoning effort",
            },
          ],
          defaultReasoningEffort: "medium",
          isDefault: true,
        },
      ],
      selectedOnlyModels: [],
    });
    expect(refresh).toHaveBeenCalledWith({
      allowNetwork: true,
      signal: expect.any(AbortSignal),
    });
    expect(getAvailable).toHaveBeenCalledOnce();
  });

  // An extension registers its models from plain JavaScript, so Pi's required
  // `input` can be missing at runtime. Reading it blindly threw and dropped
  // every other provider's models with it.
  it("lists an extension model that omits its input types", async () => {
    getAvailable.mockResolvedValue([
      {
        id: "deepseek-v4",
        name: "DeepSeek V4",
        provider: "commandcode",
        reasoning: false,
      },
      {
        id: "claude-sonnet-5",
        input: ["text", "image"],
        name: "Claude Sonnet 5",
        provider: "anthropic",
        reasoning: false,
      },
    ]);
    getSupportedThinkingLevels.mockReturnValue(["off"]);

    const result = await listPiBridgeModels(modelRuntime);

    expect(result.models.map((model) => model.id)).toEqual([
      "commandcode/deepseek-v4",
      "anthropic/claude-sonnet-5",
    ]);
    expect(result.models[0]?.description).toBe(
      "Commandcode non-reasoning model via Pi",
    );
    expect(result.models[0]?.supportedReasoningEfforts).toEqual([
      { reasoningEffort: "none", description: "No extended thinking" },
    ]);
  });

  // `id` is equally extension-supplied. Without it the list builder called
  // `id.endsWith()` and threw, which dropped every other provider's models.
  it("skips a model without an id and keeps the rest", async () => {
    const write = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    getAvailable.mockResolvedValue([
      { input: ["text"], name: "Nameless", provider: "commandcode" },
      {
        id: "claude-sonnet-5",
        input: ["text"],
        name: "Claude Sonnet 5",
        provider: "anthropic",
        reasoning: false,
      },
    ]);
    getSupportedThinkingLevels.mockReturnValue(["off"]);

    const result = await listPiBridgeModels(modelRuntime);

    expect(result.models.map((model) => model.id)).toEqual([
      "anthropic/claude-sonnet-5",
    ]);
    expect(write).toHaveBeenCalledWith(
      'pi bridge: skipped an incomplete model from provider "commandcode"\n',
    );
    write.mockRestore();
  });

  it("preserves Pi's provider-verified thinking-level holes", async () => {
    getAvailable.mockResolvedValue([
      {
        id: "reasoner",
        input: ["text"],
        name: "Reasoner",
        provider: "custom",
        reasoning: true,
      },
    ]);
    getSupportedThinkingLevels.mockReturnValue(["off", "high", "max"]);

    const result = await listPiBridgeModels(modelRuntime);

    expect(result.models[0]?.supportedReasoningEfforts).toEqual([
      { reasoningEffort: "none", description: "No extended thinking" },
      { reasoningEffort: "high", description: "High reasoning effort" },
      { reasoningEffort: "max", description: "Maximum reasoning effort" },
    ]);
    expect(result.models[0]?.defaultReasoningEffort).toBe("high");
  });

  it("still returns the catalog when the network refresh times out", async () => {
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    refresh.mockResolvedValueOnce({ aborted: true, errors: new Map() });
    getAvailable.mockResolvedValue([
      {
        id: "claude-sonnet-5",
        input: ["text"],
        name: "Claude Sonnet 5",
        provider: "anthropic",
        reasoning: true,
      },
    ]);
    getSupportedThinkingLevels.mockReturnValue(["off", "low", "medium"]);

    const result = await listPiBridgeModels(modelRuntime);

    expect(result.models).toHaveLength(1);
    expect(stderr).toHaveBeenCalled();

    // An aborted refresh must not pin the process to the stale catalog.
    await listPiBridgeModels(modelRuntime);
    expect(refresh).toHaveBeenCalledTimes(2);

    stderr.mockRestore();
  });

  it("does not block later callers on a retry after the first attempt fails", async () => {
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    getAvailable.mockResolvedValue([]);
    getSupportedThinkingLevels.mockReturnValue(["off"]);

    refresh.mockResolvedValueOnce({ aborted: true, errors: new Map() });
    await listPiBridgeModels(modelRuntime);

    // A host with no route to pi.dev would otherwise pay the full timeout on
    // every early picker render. The retry must run in the background.
    let retrySettled = false;
    refresh.mockImplementationOnce(
      () =>
        new Promise(() => {
          retrySettled = true;
        }),
    );

    await listPiBridgeModels(modelRuntime);

    expect(refresh).toHaveBeenCalledTimes(2);
    expect(retrySettled).toBe(true); // retry started...
    // ...and the call returned without awaiting it.

    stderr.mockRestore();
  });

  it("refreshes over the network at most once per process after it succeeds", async () => {
    getAvailable.mockResolvedValue([]);
    getSupportedThinkingLevels.mockReturnValue(["off"]);

    await Promise.all([
      listPiBridgeModels(modelRuntime),
      listPiBridgeModels(modelRuntime),
    ]);
    await listPiBridgeModels(modelRuntime);

    expect(refresh).toHaveBeenCalledOnce();
  });

  // #1033: an aggregator names a model after the vendor that serves it, so the
  // id already contains a slash. Dropping the provider prefix in that case
  // collapsed `openrouter/deepseek/deepseek-v4-flash-0731` to
  // `deepseek/deepseek-v4-flash-0731`, which resolves against the *direct*
  // DeepSeek provider — different credentials, different billing, and for the
  // reported model no match at all (`thread.start` failed outright).
  it("keeps the provider prefix on an aggregator model whose id has a slash", async () => {
    getAvailable.mockResolvedValue([
      {
        id: "deepseek/deepseek-v4-flash-0731",
        input: ["text"],
        name: "DeepSeek V4 Flash",
        provider: "openrouter",
        reasoning: true,
      },
      {
        id: "openai/gpt-5.1-codex",
        input: ["text"],
        name: "GPT-5.1 Codex",
        provider: "openrouter",
        reasoning: true,
      },
      {
        id: "accounts/fireworks/models/deepseek-v4-flash",
        input: ["text"],
        name: "DeepSeek V4 Flash",
        provider: "fireworks",
        reasoning: false,
      },
    ]);
    getSupportedThinkingLevels.mockReturnValue(["low", "medium", "high"]);

    const result = await listPiBridgeModels(modelRuntime);

    expect(result.models.map((model) => model.id)).toEqual([
      "openrouter/deepseek/deepseek-v4-flash-0731",
      "openrouter/openai/gpt-5.1-codex",
      "fireworks/accounts/fireworks/models/deepseek-v4-flash",
    ]);
    // `routeProviderId` is what picks credentials and billing, so it must stay
    // the aggregator rather than the vendor named inside the id.
    expect(result.models[0]?.routeProviderId).toBe("openrouter");
    // The per-provider default is itself a slashed id, so it only matches once
    // the prefix survives.
    expect(result.models.find((model) => model.isDefault)?.id).toBe(
      "openrouter/openai/gpt-5.1-codex",
    );
  });

  // The same #1033 collision seen from the context-window side: an aggregator
  // and the direct vendor publish the same model under ids that differ only by
  // prefix, and they disagree on the window. Compaction reads this number, so
  // borrowing the other provider's figure silently mis-sizes every turn.
  it("resolves the context window of the provider that served the message", () => {
    const resolveContextWindow = createPiModelContextWindowResolverFrom([
      {
        id: "deepseek/deepseek-v4-flash",
        provider: "openrouter",
        contextWindow: 1_048_575,
      },
      {
        id: "deepseek-v4-flash",
        provider: "deepseek",
        contextWindow: 1_000_000,
      },
    ]);
    const assistant = (provider: string | undefined, model: string) => ({
      role: "assistant" as const,
      content: [],
      ...(provider === undefined ? {} : { provider }),
      model,
    });

    expect(
      resolveContextWindow(
        assistant("openrouter", "deepseek/deepseek-v4-flash"),
      ),
    ).toBe(1_048_575);
    expect(
      resolveContextWindow(assistant("deepseek", "deepseek-v4-flash")),
    ).toBe(1_000_000);
    // A known provider the catalog does not cover reports nothing rather than
    // borrowing the window another provider published for the same bare id.
    expect(
      resolveContextWindow(assistant("openrouter", "deepseek-v4-flash")),
    ).toBeNull();
  });

  it("does not reach the network when PI_OFFLINE is set", async () => {
    process.env.PI_OFFLINE = "1";
    getAvailable.mockResolvedValue([]);
    getSupportedThinkingLevels.mockReturnValue(["off"]);

    await listPiBridgeModels(modelRuntime);

    expect(refresh).not.toHaveBeenCalled();
    expect(getAvailable).toHaveBeenCalledOnce();
  });
});
