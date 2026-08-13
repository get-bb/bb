import { describe, expect, it } from "vitest";
import { buildPrimeAgentAvailableModels } from "./model-list.js";

describe("Prime Agent model list", () => {
  it("maps native models and their explicit thinking levels", () => {
    const result = buildPrimeAgentAvailableModels({
      models: [
        {
          id: "gpt-5.6-sol",
          name: "GPT-5.6 Sol",
          provider: "openai-codex",
          reasoning: true,
          input: ["text", "image"],
          thinkingLevelMap: {
            xhigh: "xhigh",
            max: null,
          },
        },
      ],
    });

    expect(result.models).toHaveLength(1);
    expect(result.models[0]).toMatchObject({
      id: "openai-codex/gpt-5.6-sol",
      routeProviderId: "openai-codex",
      description: expect.stringContaining("via Prime Agent"),
      supportedReasoningEfforts: [
        { reasoningEffort: "low" },
        { reasoningEffort: "medium" },
        { reasoningEffort: "high" },
        { reasoningEffort: "xhigh" },
      ],
    });
  });
});
