import type { AvailableModel } from "@bb/domain";
import { describe, expect, it } from "vitest";
import { resolveModelCatalogSelection } from "./model-catalog-selection";

function model(value: string, displayName: string): AvailableModel {
  return {
    id: value,
    model: value,
    displayName,
    description: "",
    supportedReasoningEfforts: [],
    defaultReasoningEffort: "medium",
    isDefault: false,
  };
}

describe("resolveModelCatalogSelection", () => {
  it("labels OMP models with their backing source", () => {
    const selection = resolveModelCatalogSelection({
      models: [
        model("cursor/cursor-grok-4.6-fast", "Grok 4.6 Fast"),
        model("openrouter/x-ai/grok-4.6", "Grok 4.6"),
        model("xai-oauth/grok-4.6", "Grok 4.6"),
      ],
      selectedOnlyModels: [],
      selectedModel: "cursor/cursor-grok-4.6-fast",
      provider: { id: "acp-omp" },
      catalogIsVerified: true,
      formatModelLabel: (value) => value,
    });

    expect(selection.modelOptions).toEqual([
      {
        value: "cursor/cursor-grok-4.6-fast",
        label: "Grok 4.6 Fast",
        qualifier: "Cursor",
      },
      {
        value: "openrouter/x-ai/grok-4.6",
        label: "Grok 4.6",
        qualifier: "OpenRouter",
      },
      {
        value: "xai-oauth/grok-4.6",
        label: "Grok 4.6",
        qualifier: "xAI OAuth",
      },
    ]);
  });

  it("does not label namespaced models from other agent providers", () => {
    const selection = resolveModelCatalogSelection({
      models: [model("vendor/model", "Model")],
      selectedOnlyModels: [],
      selectedModel: "vendor/model",
      provider: { id: "another-provider" },
      catalogIsVerified: true,
      formatModelLabel: (value) => value,
    });

    expect(selection.modelOptions).toEqual([
      { value: "vendor/model", label: "Model" },
    ]);
  });
});
