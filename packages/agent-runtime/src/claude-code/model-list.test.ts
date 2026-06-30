import { describe, expect, it } from "vitest";
import { listClaudeCodeModels } from "./model-list.js";

describe("listClaudeCodeModels", () => {
  it("returns the full static Claude Code catalog with version-pinned models", () => {
    const { models } = listClaudeCodeModels();
    expect(models.map((model) => model.model)).toEqual([
      "claude-fable-5",
      "claude-mythos-5",
      "claude-opus-4-8[1m]",
      "claude-opus-4-7[1m]",
      "claude-sonnet-5",
    ]);
  });

  it("defaults to Opus 1M", () => {
    const { models } = listClaudeCodeModels();
    expect(models.find((model) => model.isDefault)).toEqual(
      expect.objectContaining({
        id: "claude-opus-4-8[1m]",
        model: "claude-opus-4-8[1m]",
        defaultReasoningEffort: "high",
        isDefault: true,
      }),
    );
  });

  it("routes secondary and non-active Claude models to the selected-only bucket", () => {
    const { models, selectedOnlyModels } = listClaudeCodeModels();
    expect(models.map((model) => model.model)).not.toContain(
      "claude-sonnet-4-6[1m]",
    );
    expect(models.map((model) => model.model)).not.toContain(
      "claude-sonnet-4-6",
    );
    expect(models.map((model) => model.model)).not.toContain(
      "claude-haiku-4-5",
    );
    expect(models.map((model) => model.model)).not.toContain("claude-opus-4-8");
    expect(models.map((model) => model.model)).not.toContain("claude-opus-4-7");
    expect(models.map((model) => model.model)).not.toContain("claude-opus-4-6");
    expect(models.map((model) => model.model)).not.toContain(
      "claude-opus-4-6[1m]",
    );
    expect(selectedOnlyModels).toContainEqual(
      expect.objectContaining({
        id: "claude-opus-4-8",
        model: "claude-opus-4-8",
        displayName: "Opus 4.8 (Legacy)",
      }),
    );
    expect(selectedOnlyModels).toContainEqual(
      expect.objectContaining({
        id: "claude-opus-4-7",
        model: "claude-opus-4-7",
        displayName: "Opus 4.7 (Legacy)",
      }),
    );
    expect(selectedOnlyModels).toContainEqual(
      expect.objectContaining({
        id: "claude-opus-4-6",
        model: "claude-opus-4-6",
        displayName: "Opus 4.6 (Legacy)",
      }),
    );
    expect(selectedOnlyModels).toContainEqual(
      expect.objectContaining({
        id: "claude-opus-4-6[1m]",
        model: "claude-opus-4-6[1m]",
        displayName: "Opus 4.6 (1M, Legacy)",
      }),
    );
  });

  it("advertises Claude Code max effort for supported models", () => {
    const { models } = listClaudeCodeModels();
    const effortLevelsByModel = new Map(
      models.map((model) => [
        model.model,
        model.supportedReasoningEfforts.map((effort) => effort.reasoningEffort),
      ]),
    );

    expect(effortLevelsByModel.get("claude-opus-4-8[1m]")).toEqual([
      "low",
      "medium",
      "high",
      "xhigh",
      "ultracode",
      "max",
    ]);
    expect(effortLevelsByModel.get("claude-fable-5")).toEqual([
      "low",
      "medium",
      "high",
      "xhigh",
      "ultracode",
      "max",
    ]);
    expect(effortLevelsByModel.get("claude-mythos-5")).toEqual([
      "low",
      "medium",
      "high",
      "xhigh",
      "ultracode",
      "max",
    ]);
    expect(effortLevelsByModel.get("claude-opus-4-7[1m]")).toEqual([
      "low",
      "medium",
      "high",
      "xhigh",
      "ultracode",
      "max",
    ]);
    expect(effortLevelsByModel.get("claude-sonnet-5")).toEqual([
      "low",
      "medium",
      "high",
      "xhigh",
      "ultracode",
      "max",
    ]);
  });

  it("routes inactive models and moving aliases to the selected-only bucket", () => {
    const { models, selectedOnlyModels } = listClaudeCodeModels();
    const activeIds = models.map((model) => model.model);
    const selectedOnlyIds = selectedOnlyModels.map((model) => model.model);
    for (const selectedOnlyModel of [
      "claude-sonnet-4-6[1m]",
      "claude-sonnet-4-6",
      "claude-haiku-4-5",
      "claude-opus-4-8",
      "claude-opus-4-7",
      "claude-opus-4-6[1m]",
      "claude-opus-4-6",
      "best",
      "fable",
      "opus[1m]",
      "opus",
      "sonnet[1m]",
      "sonnet",
      "haiku",
    ]) {
      expect(activeIds).not.toContain(selectedOnlyModel);
      expect(selectedOnlyIds).toContain(selectedOnlyModel);
    }
    expect(
      selectedOnlyModels.find((model) => model.model === "opus[1m]"),
    ).toEqual(
      expect.objectContaining({
        displayName: "Opus Alias (1M, Legacy)",
      }),
    );
    expect(selectedOnlyModels.find((model) => model.model === "opus")).toEqual(
      expect.objectContaining({
        displayName: "Opus Alias (Current)",
        defaultReasoningEffort: "high",
        supportedReasoningEfforts: expect.arrayContaining([
          expect.objectContaining({ reasoningEffort: "xhigh" }),
          expect.objectContaining({ reasoningEffort: "ultracode" }),
        ]),
      }),
    );
    expect(
      selectedOnlyModels.find((model) => model.model === "claude-sonnet-4-6"),
    ).toEqual(
      expect.objectContaining({
        displayName: "Sonnet 4.6",
        defaultReasoningEffort: "medium",
        supportedReasoningEfforts: expect.arrayContaining([
          expect.objectContaining({ reasoningEffort: "max" }),
        ]),
      }),
    );
    expect(
      selectedOnlyModels.find((model) => model.model === "claude-haiku-4-5"),
    ).toEqual(
      expect.objectContaining({
        displayName: "Haiku 4.5",
        defaultReasoningEffort: "low",
        supportedReasoningEfforts: [
          expect.objectContaining({ reasoningEffort: "low" }),
        ],
      }),
    );
  });
});
