import type { ModelInfo } from "@anthropic-ai/claude-agent-sdk";
import { describe, expect, it } from "vitest";
import { buildClaudeCodeModels } from "./model-list.js";

const DISCOVERED_MODELS: ModelInfo[] = [
  {
    value: "default",
    resolvedModel: "claude-opus-4-8[1m]",
    displayName: "Default (recommended)",
    description: "Opus 4.8 with 1M context",
  },
  {
    value: "opus[1m]",
    resolvedModel: "claude-opus-4-8[1m]",
    displayName: "Opus",
    description: "Opus 4.8 with 1M context",
  },
  {
    value: "claude-fable-5[1m]",
    resolvedModel: "claude-fable-5",
    displayName: "Fable",
    description: "Fable 5",
  },
  {
    value: "sonnet",
    resolvedModel: "claude-sonnet-5",
    displayName: "Sonnet",
    description: "Sonnet 5",
  },
  {
    value: "haiku",
    resolvedModel: "claude-haiku-4-5-20251001",
    displayName: "Haiku",
    description: "Haiku 4.5",
  },
];

describe("buildClaudeCodeModels", () => {
  it("only exposes curated identifiers covered by account-scoped discovery", () => {
    const result = buildClaudeCodeModels(DISCOVERED_MODELS);

    expect(result.models.map((model) => model.model)).toEqual([
      "claude-fable-5",
      "claude-opus-4-8[1m]",
      "claude-sonnet-5",
      "claude-haiku-4-5-20251001",
    ]);
    expect(result.models.find((model) => model.isDefault)?.model).toBe(
      "claude-opus-4-8[1m]",
    );
    expect(result.selectedOnlyModels.map((model) => model.model)).toEqual([
      "opus[1m]",
      "sonnet",
      "haiku",
    ]);
    expect(
      [...result.models, ...result.selectedOnlyModels].some(
        (model) => model.model === "claude-mythos-5",
      ),
    ).toBe(false);
  });

  it("returns an empty catalog when the provider reports no models", () => {
    expect(buildClaudeCodeModels([])).toEqual({
      models: [],
      selectedOnlyModels: [],
    });
  });

  it("keeps authoritative models that do not have curated metadata yet", () => {
    const result = buildClaudeCodeModels([
      {
        value: "future",
        resolvedModel: "claude-future-6",
        displayName: "Future 6",
        description: "Newly discovered model",
        supportsEffort: true,
        supportedEffortLevels: ["low", "high"],
      },
    ]);

    expect(result.models).toEqual([
      expect.objectContaining({
        model: "claude-future-6",
        displayName: "Future 6",
        isDefault: true,
        defaultReasoningEffort: "high",
      }),
    ]);
  });
});
