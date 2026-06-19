import { describe, expect, it } from "vitest";
import {
  buildAgentModelCatalog,
  parseAgentModelLines,
  splitPrimaryModels,
} from "./model-catalog.js";

const SAMPLE_LIST = [
  "Available models",
  "",
  "auto - Auto",
  "gpt-5.3-codex-low - Codex 5.3 Low",
  "gpt-5.3-codex-low-fast - Codex 5.3 Low Fast",
  "gpt-5.3-codex - Codex 5.3",
  "gpt-5.3-codex-fast - Codex 5.3 Fast",
  "gpt-5.3-codex-high - Codex 5.3 High",
  "gpt-5.3-codex-xhigh - Codex 5.3 Extra High",
  "gpt-5.1-codex-max-low - Codex 5.1 Max Low",
  "gpt-5.1-codex-max-medium - Codex 5.1 Max",
  "gpt-5.1-codex-max-high - Codex 5.1 Max High",
  "gpt-5.5-low - GPT-5.5 1M Low",
  "gpt-5.5-medium - GPT-5.5 1M",
  "gpt-5.5-extra-high - GPT-5.5 1M Extra High",
  "gpt-5.5-none - GPT-5.5 1M None",
  "claude-4.6-opus-high - Opus 4.6 1M",
  "claude-4.6-opus-max - Opus 4.6 1M Max",
  "claude-4.6-opus-high-thinking - Opus 4.6 1M Thinking",
  "Tip: use --model <id> to switch.",
].join("\n");

function catalogFromSample() {
  const catalog = buildAgentModelCatalog(parseAgentModelLines(SAMPLE_LIST));
  if (!catalog) {
    throw new Error("expected a catalog from the sample list");
  }
  return catalog;
}

describe("acp model catalog", () => {
  it("parses id - name lines and skips chatter", () => {
    expect(parseAgentModelLines("header\n\na-1 - Model A\nnoise")).toEqual([
      { id: "a-1", displayName: "Model A" },
    ]);
  });

  it("groups effort variants into families keyed by the default variant", () => {
    const catalog = catalogFromSample();
    const codex = catalog.models.find((m) => m.id === "gpt-5.3-codex");
    expect(codex).toMatchObject({
      model: "gpt-5.3-codex",
      displayName: "Codex 5.3",
      defaultReasoningEffort: "medium",
    });
    expect(
      codex?.supportedReasoningEfforts.map((e) => e.reasoningEffort),
    ).toEqual(["low", "medium", "high", "xhigh"]);
  });

  it("keeps -fast variants as their own family", () => {
    const catalog = catalogFromSample();
    const fast = catalog.models.find((m) => m.id === "gpt-5.3-codex-fast");
    expect(
      fast?.supportedReasoningEfforts.map((e) => e.reasoningEffort),
    ).toEqual(["low", "medium"]);
  });

  it("maps the extra-high spelling onto xhigh and resolves it back exactly", () => {
    const catalog = catalogFromSample();
    const gpt55 = catalog.models.find((m) => m.id === "gpt-5.5-medium");
    expect(
      gpt55?.supportedReasoningEfforts.map((e) => e.reasoningEffort),
    ).toEqual(["low", "medium", "xhigh"]);
    expect(
      catalog.resolveVariant({ model: "gpt-5.5-medium", reasoningLevel: "xhigh" }),
    ).toBe("gpt-5.5-extra-high");
  });

  it("uses the explicit -medium variant id as the family id", () => {
    const catalog = catalogFromSample();
    expect(
      catalog.models.find((m) => m.id === "gpt-5.1-codex-max-medium"),
    ).toBeDefined();
    expect(
      catalog.resolveVariant({
        model: "gpt-5.1-codex-max-medium",
        reasoningLevel: "high",
      }),
    ).toBe("gpt-5.1-codex-max-high");
  });

  it("strips the default variant's effort word from the family name", () => {
    const catalog = buildAgentModelCatalog(
      parseAgentModelLines(
        [
          "claude-opus-4-8-medium - Opus 4.8 1M Medium",
          "claude-opus-4-8-high - Opus 4.8 1M",
          "claude-fable-5-thinking-medium - Fable 5 1M Medium Thinking (NO ZDR)",
        ].join("\n"),
      ),
    );
    expect(catalog?.models.map((m) => m.displayName)).toEqual([
      "Opus 4.8 1M",
      "Fable 5 1M Thinking (NO ZDR)",
    ]);
    // The raw variant names survive as per-effort descriptions.
    expect(
      catalog?.models[0]?.supportedReasoningEfforts.map((e) => e.description),
    ).toEqual(["Opus 4.8 1M Medium", "Opus 4.8 1M"]);
  });

  it("orders reasoning efforts low → max regardless of listing order", () => {
    const catalog = buildAgentModelCatalog(
      parseAgentModelLines(
        [
          "thinky-medium - Thinky Medium",
          "thinky-high - Thinky High",
          "thinky-extra-high - Thinky Extra High",
          "thinky-low - Thinky Low",
          "thinky-max - Thinky Max",
        ].join("\n"),
      ),
    );
    expect(
      catalog?.models[0]?.supportedReasoningEfforts.map(
        (e) => e.reasoningEffort,
      ),
    ).toEqual(["low", "medium", "high", "xhigh", "max"]);
  });

  it("keeps brand words that collide with effort spellings", () => {
    const catalog = catalogFromSample();
    expect(
      catalog.models.find((m) => m.id === "gpt-5.1-codex-max-medium")
        ?.displayName,
    ).toBe("Codex 5.1 Max");
  });

  it("defaults effort-less and unrecognized ids to standalone models", () => {
    const catalog = catalogFromSample();
    const none = catalog.models.find((m) => m.id === "gpt-5.5-none");
    expect(
      none?.supportedReasoningEfforts.map((e) => e.reasoningEffort),
    ).toEqual(["medium"]);
    // `…-high-thinking` does not follow base[-effort][-fast]; stays standalone.
    const thinking = catalog.models.find(
      (m) => m.id === "claude-4.6-opus-high-thinking",
    );
    expect(
      thinking?.supportedReasoningEfforts.map((e) => e.reasoningEffort),
    ).toEqual(["medium"]);
  });

  it("falls back to the first variant when a family has no medium", () => {
    const catalog = catalogFromSample();
    const opus = catalog.models.find((m) => m.id === "claude-4.6-opus-high");
    expect(opus).toMatchObject({ defaultReasoningEffort: "high" });
    expect(
      opus?.supportedReasoningEfforts.map((e) => e.reasoningEffort),
    ).toEqual(["high", "max"]);
    expect(
      catalog.resolveVariant({
        model: "claude-4.6-opus-high",
        reasoningLevel: "max",
      }),
    ).toBe("claude-4.6-opus-max");
  });

  it("marks only the first listed family as default", () => {
    const catalog = catalogFromSample();
    expect(catalog.models.filter((m) => m.isDefault).map((m) => m.id)).toEqual([
      "auto",
    ]);
  });

  it("returns undefined for unknown families and unavailable efforts", () => {
    const catalog = catalogFromSample();
    expect(
      catalog.resolveVariant({ model: "unknown", reasoningLevel: "high" }),
    ).toBeUndefined();
    expect(
      catalog.resolveVariant({ model: "auto", reasoningLevel: "high" }),
    ).toBeUndefined();
  });

  it("returns null for an empty list", () => {
    expect(buildAgentModelCatalog([])).toBeNull();
  });
});

describe("acp primary model split", () => {
  it("splits families into primary and selected-only pools", () => {
    const catalog = catalogFromSample();
    const split = splitPrimaryModels(catalog.models, [
      "auto",
      "gpt-5.5-medium",
    ]);
    expect(split.models.map((m) => m.id)).toEqual(["auto", "gpt-5.5-medium"]);
    expect(split.selectedOnlyModels.map((m) => m.id)).toContain(
      "gpt-5.3-codex",
    );
    expect(split.models.filter((m) => m.isDefault).map((m) => m.id)).toEqual([
      "auto",
    ]);
    expect(split.selectedOnlyModels.some((m) => m.isDefault)).toBe(false);
  });

  it("re-anchors the default flag when the default family is not primary", () => {
    const catalog = catalogFromSample();
    const split = splitPrimaryModels(catalog.models, ["gpt-5.5-medium"]);
    expect(split.models.map((m) => m.id)).toEqual(["gpt-5.5-medium"]);
    expect(split.models[0]?.isDefault).toBe(true);
    expect(split.selectedOnlyModels.some((m) => m.isDefault)).toBe(false);
  });

  it("serves everything as primary when no name matches", () => {
    const catalog = catalogFromSample();
    const split = splitPrimaryModels(catalog.models, ["renamed-away"]);
    expect(split.models).toEqual(catalog.models);
    expect(split.selectedOnlyModels).toEqual([]);
  });
});
