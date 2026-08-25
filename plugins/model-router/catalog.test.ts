import { describe, expect, it } from "vitest";
import {
  buildProviderModels,
  isCatalogUsable,
  lookupModel,
  nearestSupportedReasoningLevel,
  parseModelSlot,
  type AvailableModel,
  type ModelCatalog,
} from "./catalog.js";

function catalog(fetchedAt: number | null, providerCount = 1): ModelCatalog {
  const providers = new Map();
  for (let index = 0; index < providerCount; index += 1) {
    providers.set(`p${index}`, new Map());
  }
  return { providers, fetchedAt };
}

describe("parseModelSlot", () => {
  it("splits on the first slash so a model id may contain slashes", () => {
    // The real reason this matters: aggregating providers list models like
    // `openai/gpt-5`, so splitting on the last slash would invent a provider.
    expect(parseModelSlot("pi/openai/gpt-5", "Fast model")).toEqual({
      kind: "slot",
      slot: { providerId: "pi", model: "openai/gpt-5" },
    });
  });

  it("reads an empty setting as unset rather than invalid", () => {
    expect(parseModelSlot("   ", "Fast model")).toEqual({ kind: "unset" });
  });

  it("rejects values that name no provider or no model", () => {
    for (const raw of ["gpt-5", "/gpt-5", "codex/", "code x/gpt-5"]) {
      const parsed = parseModelSlot(raw, "Fast model");
      expect(parsed.kind, raw).toBe("invalid");
    }
  });

  it("names the setting and the offending value in the problem message", () => {
    const parsed = parseModelSlot("gpt-5", "Fast model");
    expect(parsed.kind === "invalid" && parsed.message).toContain("Fast model");
    expect(parsed.kind === "invalid" && parsed.message).toContain('"gpt-5"');
  });

  it("tolerates surrounding whitespace", () => {
    expect(parseModelSlot("  codex / gpt-5  ", "Fast model")).toEqual({
      kind: "slot",
      slot: { providerId: "codex", model: "gpt-5" },
    });
  });
});

describe("isCatalogUsable", () => {
  it("refuses a catalog that was never fetched or came back empty", () => {
    expect(isCatalogUsable(catalog(null), 1_000, 10_000)).toBe(false);
    expect(isCatalogUsable(catalog(1_000, 0), 1_000, 10_000)).toBe(false);
  });

  it("refuses a catalog older than the TTL and accepts one exactly at it", () => {
    expect(isCatalogUsable(catalog(1_000), 11_000, 10_000)).toBe(true);
    expect(isCatalogUsable(catalog(1_000), 11_001, 10_000)).toBe(false);
  });
});

describe("nearestSupportedReasoningLevel", () => {
  it("returns the exact level when the model offers it", () => {
    expect(
      nearestSupportedReasoningLevel(["low", "medium", "high"], "high", "higher"),
    ).toBe("high");
  });

  it("returns null when the model advertises nothing", () => {
    expect(nearestSupportedReasoningLevel([], "high", "higher")).toBeNull();
  });

  it("falls to the nearest rung when the exact level is missing", () => {
    // `high` is absent; `medium` is one rung away and `max` is three.
    expect(
      nearestSupportedReasoningLevel(["none", "medium", "max"], "high", "higher"),
    ).toBe("medium");
  });

  it("breaks an equidistant tie in the direction routing was reaching", () => {
    // `medium` and `xhigh` are both one rung from `high`.
    expect(
      nearestSupportedReasoningLevel(["medium", "xhigh"], "high", "higher"),
    ).toBe("xhigh");
    expect(
      nearestSupportedReasoningLevel(["medium", "xhigh"], "high", "lower"),
    ).toBe("medium");
  });
});

describe("buildProviderModels", () => {
  const model = (overrides: Partial<AvailableModel>): AvailableModel =>
    ({
      id: "m",
      model: "gpt-5",
      displayName: "GPT-5",
      description: "",
      supportedReasoningEfforts: [
        { reasoningEffort: "low", description: "" },
        { reasoningEffort: "high", description: "" },
      ],
      defaultReasoningEffort: "low",
      isDefault: false,
      ...overrides,
    }) as AvailableModel;

  it("keys entries by the wire model string, not the catalog id", () => {
    // `model` is what lands on the request; `id` is picker bookkeeping. Keying
    // on the wrong one would make every configured slot look missing.
    const built = buildProviderModels([model({ id: "codex:gpt-5" })]);
    expect([...built.keys()]).toEqual(["gpt-5"]);
    expect(built.get("gpt-5")?.supportedReasoningLevels).toEqual([
      "low",
      "high",
    ]);
  });

  it("finds a built entry through lookupModel", () => {
    const built = buildProviderModels([model({})]);
    const built_catalog: ModelCatalog = {
      providers: new Map([["codex", built]]),
      fetchedAt: 1,
    };
    expect(
      lookupModel(built_catalog, { providerId: "codex", model: "gpt-5" })?.model,
    ).toBe("gpt-5");
    expect(
      lookupModel(built_catalog, { providerId: "codex", model: "gpt-4" }),
    ).toBeNull();
  });
});
