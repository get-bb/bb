import { describe, expect, it } from "vitest";
import {
  buildProviderModels,
  describeCatalog,
  isCatalogUsable,
  lookupModel,
  nearestSupportedReasoningLevel,
  type AvailableModel,
  type CatalogModel,
  type ModelCatalog,
} from "./catalog.js";

function catalog(fetchedAt: number | null, providerCount = 1): ModelCatalog {
  const providers = new Map();
  for (let index = 0; index < providerCount; index += 1) {
    providers.set(`p${index}`, new Map());
  }
  return { providers, fetchedAt };
}

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
      nearestSupportedReasoningLevel(["low", "medium", "high"], "high"),
    ).toBe("high");
  });

  it("returns null when the model advertises nothing", () => {
    expect(nearestSupportedReasoningLevel([], "high")).toBeNull();
  });

  it("falls to the nearest rung when the exact level is missing", () => {
    // The real hazard: core fails the whole dispatch when a plugin amends a
    // reasoning level the chosen model does not advertise, so "closest
    // supported" is the difference between routing and a failed send.
    // `high` is absent; `medium` is one rung away and `max` is three.
    expect(nearestSupportedReasoningLevel(["none", "medium", "max"], "high")).toBe(
      "medium",
    );
  });

  it("breaks an equidistant tie downward", () => {
    // `medium` and `xhigh` are both one rung from `high`; spending more effort
    // than was asked for is the more expensive way to be wrong.
    expect(nearestSupportedReasoningLevel(["medium", "xhigh"], "high")).toBe(
      "medium",
    );
  });
});

describe("describeCatalog", () => {
  const model = (
    name: string,
    levels: CatalogModel["supportedReasoningLevels"],
  ): CatalogModel => ({
    model: name,
    displayName: name.toUpperCase(),
    supportedReasoningLevels: levels,
  });
  const twoProviders: ModelCatalog = {
    providers: new Map([
      ["codex", new Map([["gpt-5", model("gpt-5", ["low", "high"])]])],
      ["claude", new Map([["opus", model("opus", [])]])],
    ]),
    fetchedAt: 1,
  };

  it("offers only the locked provider's rows once a thread has one", () => {
    // This is the safety property, not a formatting preference: at turn.submit
    // the thread's provider cannot change, so a row from another provider is
    // an answer that could only ever be discarded.
    const scoped = describeCatalog(twoProviders, "codex");
    expect(scoped).toContain('providerId "codex"');
    expect(scoped).not.toContain("claude");
  });

  it("says so explicitly when a model advertises no reasoning levels", () => {
    // An empty list read as "any level is fine" would produce amendments core
    // refuses, so the prompt must not leave it to inference.
    expect(describeCatalog(twoProviders, "claude")).toContain(
      "no reasoning levels",
    );
  });

  it("is empty when the locked provider is not in the catalog", () => {
    // The caller reads "" as "do not route", so an unknown provider must not
    // silently fall back to listing everything.
    expect(describeCatalog(twoProviders, "gemini")).toBe("");
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
