import { describe, expect, it } from "vitest";
import type { PiCatalogModel } from "../model-list.js";
import {
  buildScopedPiAvailableModels,
  resolvePiEnabledModelIds,
  resolvePiModelScope,
} from "./model-scope.js";

function model(provider: string, id: string, name = id): PiCatalogModel {
  return { provider, id, name, input: ["text"], reasoning: true, supportedThinkingLevels: ["off", "low"] };
}

const catalog = [
  model("anthropic", "claude-sonnet-5", "Claude Sonnet 5"),
  model("anthropic", "claude-opus-4-8", "Claude Opus 4.8"),
  model("anthropic", "claude-opus-4-8-20260101", "Claude Opus 4.8 (dated)"),
  model("openai", "gpt-5.5", "GPT-5.5"),
  model("openrouter", "zai/glm-5.1", "GLM 5.1"),
];

describe("pi's enabled-model patterns", () => {
  it("resolves exact references, globs, partial names, and thinking suffixes in pattern order", () => {
    expect(
      resolvePiModelScope(
        ["OPENAI/gpt-5.5:high", "anthropic/*opus*", "sonnet", "openrouter/zai/glm-5.1", "missing"],
        catalog,
      ).map((entry) => `${entry.provider}/${entry.id}`),
    ).toEqual([
      "openai/gpt-5.5",
      "anthropic/claude-opus-4-8",
      "anthropic/claude-opus-4-8-20260101",
      "anthropic/claude-sonnet-5",
      "openrouter/zai/glm-5.1",
    ]);
  });

  it("prefers an alias over a dated version on a partial match, as pi does", () => {
    expect(resolvePiModelScope(["opus"], catalog).map((entry) => entry.id)).toEqual([
      "claude-opus-4-8",
    ]);
  });

  it("treats an absent, empty, or unmatched scope as every model", () => {
    expect(resolvePiEnabledModelIds(undefined, catalog)).toBeNull();
    expect(resolvePiEnabledModelIds([], catalog)).toBeNull();
    expect(resolvePiEnabledModelIds(["nothing-like-this"], catalog)).toBeNull();
  });
});

describe("the scoped picker", () => {
  it("leads with the enabled models in cycling order and keeps the rest selectable only", () => {
    const scoped = buildScopedPiAvailableModels({
      models: catalog,
      enabledModelIds: ["openai/gpt-5.5", "anthropic/claude-sonnet-5"],
    });
    expect(scoped.models.map((entry) => entry.id)).toEqual([
      "openai/gpt-5.5",
      "anthropic/claude-sonnet-5",
    ]);
    expect(scoped.models.filter((entry) => entry.isDefault).map((entry) => entry.id)).toEqual([
      "openai/gpt-5.5",
    ]);
    expect(scoped.selectedOnlyModels.map((entry) => entry.id)).toEqual([
      "anthropic/claude-opus-4-8",
      "openrouter/zai/glm-5.1",
      "anthropic/claude-opus-4-8-20260101",
    ]);
    expect(scoped.selectedOnlyModels.some((entry) => entry.isDefault)).toBe(false);
  });

  it("keeps a picker when only dated ids are enabled, with a default", () => {
    const scoped = buildScopedPiAvailableModels({
      models: catalog,
      enabledModelIds: ["anthropic/claude-opus-4-8-20260101"],
    });
    expect(scoped.models.map((entry) => entry.id)).toEqual(["anthropic/claude-opus-4-8-20260101"]);
    expect(scoped.models[0]?.isDefault).toBe(true);
    expect(scoped.selectedOnlyModels.map((entry) => entry.id)).toEqual([
      "anthropic/claude-sonnet-5",
      "anthropic/claude-opus-4-8",
      "openai/gpt-5.5",
      "openrouter/zai/glm-5.1",
    ]);
  });

  it("is the plain catalog without a scope", () => {
    const unscoped = buildScopedPiAvailableModels({ models: catalog, enabledModelIds: null });
    expect(unscoped.models.map((entry) => entry.id)).toEqual([
      "anthropic/claude-sonnet-5",
      "anthropic/claude-opus-4-8",
      "openai/gpt-5.5",
      "openrouter/zai/glm-5.1",
    ]);
  });
});
