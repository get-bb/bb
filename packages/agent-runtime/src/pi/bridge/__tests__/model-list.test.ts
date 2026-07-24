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

import { listPiBridgeModels } from "../model-list.js";

const modelRuntime = { getAvailable, refresh } as unknown as ModelRuntime;

describe("pi bridge model list", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
          description: "Anthropic reasoning, multimodal model via Pi",
          supportedReasoningEfforts: [
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
      { reasoningEffort: "high", description: "High reasoning effort" },
      { reasoningEffort: "max", description: "Maximum reasoning effort" },
    ]);
    expect(result.models[0]?.defaultReasoningEffort).toBe("high");
  });
});
