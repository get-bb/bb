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

  it("does not reach the network when PI_OFFLINE is set", async () => {
    process.env.PI_OFFLINE = "1";
    getAvailable.mockResolvedValue([]);
    getSupportedThinkingLevels.mockReturnValue(["off"]);

    await listPiBridgeModels(modelRuntime);

    expect(refresh).not.toHaveBeenCalled();
    expect(getAvailable).toHaveBeenCalledOnce();
  });
});
