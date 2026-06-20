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

  it("folds -fast variants into the family as a service tier", () => {
    const catalog = catalogFromSample();
    // No standalone `-fast` family is offered in the picker anymore.
    expect(catalog.models.some((m) => m.id.endsWith("-fast"))).toBe(false);
    expect(
      catalog.models.find((m) => m.id === "gpt-5.3-codex-fast"),
    ).toBeUndefined();
    // The family's reasoning ladder comes from the non-fast members.
    const codex = catalog.models.find((m) => m.id === "gpt-5.3-codex");
    expect(
      codex?.supportedReasoningEfforts.map((e) => e.reasoningEffort),
    ).toEqual(["low", "medium", "high", "xhigh"]);
    // The fast tail is reachable through serviceTier instead of a new entry.
    expect(
      catalog.resolveVariant({
        model: "gpt-5.3-codex",
        reasoningLevel: "low",
        serviceTier: "fast",
      }),
    ).toBe("gpt-5.3-codex-low-fast");
    // The default tier resolves to the normal id.
    expect(
      catalog.resolveVariant({
        model: "gpt-5.3-codex",
        reasoningLevel: "low",
        serviceTier: "default",
      }),
    ).toBe("gpt-5.3-codex-low");
    // An effort with no fast twin falls back to the normal id under fast.
    expect(
      catalog.resolveVariant({
        model: "gpt-5.3-codex",
        reasoningLevel: "high",
        serviceTier: "fast",
      }),
    ).toBe("gpt-5.3-codex-high");
  });

  it("resolves fast at the default effort when no reasoning level is given", () => {
    const catalog = buildAgentModelCatalog(
      parseAgentModelLines(
        [
          "composer-2.5 - Composer 2.5",
          "composer-2.5-fast - Composer 2.5 Fast",
        ].join("\n"),
      ),
    );
    // composer's `-fast` twin folds in — one family, fast id reachable as a tier.
    expect(catalog?.models.map((m) => m.id)).toEqual(["composer-2.5"]);
    expect(
      catalog?.resolveVariant({ model: "composer-2.5", serviceTier: "fast" }),
    ).toBe("composer-2.5-fast");
    expect(catalog?.resolveVariant({ model: "composer-2.5" })).toBe(
      "composer-2.5",
    );
  });

  it("maps the extra-high spelling onto xhigh and resolves it back exactly", () => {
    const catalog = catalogFromSample();
    const gpt55 = catalog.models.find((m) => m.id === "gpt-5.5-medium");
    // The explicit `gpt-5.5-none` id contributes the "none" level.
    expect(
      gpt55?.supportedReasoningEfforts.map((e) => e.reasoningEffort),
    ).toEqual(["none", "low", "medium", "xhigh"]);
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

  it("strips the effort word and picker noise from the family name", () => {
    const catalog = buildAgentModelCatalog(
      parseAgentModelLines(
        [
          "claude-opus-4-8-medium - Opus 4.8 1M Medium",
          "claude-opus-4-8-high - Opus 4.8 1M",
          "claude-fable-5-thinking-medium - Fable 5 1M Medium Thinking (NO ZDR)",
        ].join("\n"),
      ),
    );
    // 1M, the (NO ZDR) marker, the "Thinking" marker, and the default
    // variant's effort word are all stripped.
    expect(catalog?.models.map((m) => m.displayName)).toEqual([
      "Opus 4.8",
      "Fable 5",
    ]);
    // The raw variant names survive as per-effort descriptions.
    expect(
      catalog?.models[0]?.supportedReasoningEfforts.map((e) => e.description),
    ).toEqual(["Opus 4.8 1M Medium", "Opus 4.8 1M"]);
  });

  it("strips 1M, NO ZDR, and Cursor's default/current annotations", () => {
    const catalog = buildAgentModelCatalog(
      parseAgentModelLines(
        [
          "composer-2.5 - Composer 2.5 (current)",
          "composer-2.5-fast - Composer 2.5 Fast (default)",
          "gpt-5.5-medium - GPT-5.5 1M",
          "claude-fable-5-high - Fable 5 1M (NO ZDR)",
        ].join("\n"),
      ),
    );
    expect(catalog?.models.map((m) => m.displayName)).toEqual([
      "Composer 2.5",
      "GPT-5.5",
      "Fable 5",
    ]);
    // The family id stays the non-fast variant; fast is the opt-in tier.
    expect(catalog?.models.map((m) => m.id)).toEqual([
      "composer-2.5",
      "gpt-5.5-medium",
      "claude-fable-5-high",
    ]);
  });

  it("merges infix-thinking variants into one entry with a none level", () => {
    const catalog = buildAgentModelCatalog(
      parseAgentModelLines(
        [
          "claude-opus-4-8-low - Opus 4.8 1M Low",
          "claude-opus-4-8-medium - Opus 4.8 1M Medium",
          "claude-opus-4-8-thinking-low - Opus 4.8 1M Low Thinking",
          "claude-opus-4-8-thinking-medium - Opus 4.8 1M Medium Thinking",
        ].join("\n"),
      ),
    );
    // One clean entry, defaulting to the thinking medium, with "none" at the
    // bottom of the ladder.
    expect(catalog?.models).toHaveLength(1);
    const opus = catalog?.models[0];
    expect(opus?.id).toBe("claude-opus-4-8-thinking-medium");
    expect(opus?.displayName).toBe("Opus 4.8");
    expect(opus?.defaultReasoningEffort).toBe("medium");
    expect(
      opus?.supportedReasoningEfforts.map((e) => e.reasoningEffort),
    ).toEqual(["none", "low", "medium"]);
    // "none" picks the medium-effort non-thinking representative; thinking
    // efforts resolve to the thinking ids.
    expect(
      catalog?.resolveVariant({
        model: "claude-opus-4-8-thinking-medium",
        reasoningLevel: "none",
      }),
    ).toBe("claude-opus-4-8-medium");
    expect(
      catalog?.resolveVariant({
        model: "claude-opus-4-8-thinking-medium",
        reasoningLevel: "low",
      }),
    ).toBe("claude-opus-4-8-thinking-low");
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

  it("folds an explicit -none id into the family's none level", () => {
    const catalog = catalogFromSample();
    // gpt-5.5-none is no longer offered as its own standalone model.
    expect(catalog.models.find((m) => m.id === "gpt-5.5-none")).toBeUndefined();
    expect(
      catalog.resolveVariant({
        model: "gpt-5.5-medium",
        reasoningLevel: "none",
      }),
    ).toBe("gpt-5.5-none");
  });

  it("merges thinking with its non-thinking twins, defaulting to a thinking effort when there is no medium", () => {
    const catalog = catalogFromSample();
    // claude-4.6-opus-high / -max (non-thinking) and -high-thinking (suffix
    // thinking) collapse into one family. With no medium, the default is the
    // thinking effort, never the bottom "none" rung.
    const opus = catalog.models.find(
      (m) => m.id === "claude-4.6-opus-high-thinking",
    );
    expect(opus).toMatchObject({ defaultReasoningEffort: "high" });
    expect(
      opus?.supportedReasoningEfforts.map((e) => e.reasoningEffort),
    ).toEqual(["none", "high"]);
    // The thinking effort resolves to the thinking id; "none" resolves to a
    // non-thinking twin.
    expect(
      catalog.resolveVariant({
        model: "claude-4.6-opus-high-thinking",
        reasoningLevel: "high",
      }),
    ).toBe("claude-4.6-opus-high-thinking");
    expect(
      catalog.resolveVariant({
        model: "claude-4.6-opus-high-thinking",
        reasoningLevel: "none",
      }),
    ).toBe("claude-4.6-opus-high");
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
