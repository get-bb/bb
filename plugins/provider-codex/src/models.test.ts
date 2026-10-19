import { describe, expect, it } from "vitest";
import {
  cyberProgramForTurn,
  mapBbReasoningLevelToCodex,
  parseModelCatalog,
} from "./models.js";

function parseModelsResponse(result: unknown) {
  return parseModelCatalog(result).models;
}

describe("parseModelsResponse", () => {
  it("parses a live-shaped Codex payload with max and ultra", () => {
    const models = parseModelsResponse({
      data: [
        {
          id: "gpt-5.5",
          model: "gpt-5.5",
          displayName: "GPT-5.5",
          description: "Frontier model",
          supportedReasoningEfforts: [
            { reasoningEffort: "low", description: "Low" },
            { reasoningEffort: "medium", description: "Medium" },
            { reasoningEffort: "high", description: "High" },
            { reasoningEffort: "xhigh", description: "XHigh" },
          ],
          defaultReasoningEffort: "medium",
          isDefault: true,
        },
        {
          id: "gpt-5.6-sol",
          model: "gpt-5.6-sol",
          displayName: "GPT-5.6-Sol",
          description: "Latest frontier",
          supportedReasoningEfforts: [
            { reasoningEffort: "low", description: "Low" },
            { reasoningEffort: "medium", description: "Medium" },
            { reasoningEffort: "high", description: "High" },
            { reasoningEffort: "xhigh", description: "XHigh" },
            { reasoningEffort: "max", description: "Max" },
            {
              reasoningEffort: "ultra",
              description: "Maximum with delegation",
            },
          ],
          defaultReasoningEffort: "low",
          isDefault: false,
        },
      ],
    });

    expect(models).toHaveLength(2);
    expect(models[0]?.id).toBe("gpt-5.5");
    expect(
      models[1]?.supportedReasoningEfforts.map((e) => e.reasoningEffort),
    ).toEqual(["low", "medium", "high", "xhigh", "max", "ultra"]);
    expect(models[1]?.defaultReasoningEffort).toBe("low");
  });

  it("keeps reasoning efforts outside the standard ladder under the ids Codex gave them", () => {
    const models = parseModelsResponse({
      data: [
        {
          id: "future-model",
          model: "future-model",
          supportedReasoningEfforts: [
            { reasoningEffort: "low", description: "Low" },
            { reasoningEffort: "quantum", description: "Brand new" },
            { reasoningEffort: "high", description: "High" },
          ],
          defaultReasoningEffort: "quantum",
        },
      ],
    });

    expect(models).toHaveLength(1);
    expect(
      models[0]?.supportedReasoningEfforts.map((e) => e.reasoningEffort),
    ).toEqual(["low", "quantum", "high"]);
    expect(models[0]?.defaultReasoningEffort).toBe("quantum");
    expect(mapBbReasoningLevelToCodex("quantum")).toBe("quantum");
  });

  it("skips effort entries without a string level and defaults to the first effort when none is named", () => {
    const models = parseModelsResponse({
      data: [
        {
          id: "sparse-model",
          model: "sparse-model",
          supportedReasoningEfforts: [
            { reasoningEffort: "high", description: "High" },
            { reasoningEffort: 42, description: "Numeric" },
            { description: "Missing" },
          ],
        },
      ],
    });

    expect(
      models[0]?.supportedReasoningEfforts.map((e) => e.reasoningEffort),
    ).toEqual(["high"]);
    expect(models[0]?.defaultReasoningEffort).toBe("high");
  });

  it("falls back to default efforts when no effort carries a usable id", () => {
    const models = parseModelsResponse({
      data: [
        {
          id: "odd-model",
          model: "odd-model",
          supportedReasoningEfforts: [
            { reasoningEffort: "", description: "Blank" },
            { reasoningEffort: 7, description: "Numeric" },
          ],
          defaultReasoningEffort: "",
        },
      ],
    });

    expect(models).toHaveLength(1);
    expect(
      models[0]?.supportedReasoningEfforts.map((e) => e.reasoningEffort),
    ).toEqual(["low", "medium", "high", "xhigh"]);
    expect(models[0]?.defaultReasoningEffort).toBe("low");
  });

  it("skips malformed model entries and keeps valid ones", () => {
    const models = parseModelsResponse({
      data: [
        { notAModel: true },
        null,
        "garbage",
        {
          id: "good",
          model: "good",
          displayName: "Good",
          supportedReasoningEfforts: [
            { reasoningEffort: "medium", description: "Medium" },
          ],
          defaultReasoningEffort: "medium",
          isDefault: true,
        },
      ],
    });

    expect(models).toEqual([
      {
        id: "good",
        model: "good",
        displayName: "Good",
        description: "",
        supportedReasoningEfforts: [
          { reasoningEffort: "medium", description: "Medium" },
        ],
        defaultReasoningEffort: "medium",
        supportedServiceTiers: [{ id: "fast" }],
        isDefault: true,
      },
    ]);
  });

  it("uses defaults when supportedReasoningEfforts is empty", () => {
    const models = parseModelsResponse({
      data: [
        {
          id: "codex-mini",
          model: "codex-mini",
          supportedReasoningEfforts: [],
          defaultReasoningEffort: "medium",
          isDefault: true,
        },
      ],
    });

    expect(
      models[0]?.supportedReasoningEfforts.map((e) => e.reasoningEffort),
    ).toEqual(["low", "medium", "high", "xhigh"]);
    expect(models[0]?.defaultReasoningEffort).toBe("medium");
  });

  it("throws when the envelope is not a model list", () => {
    expect(() => parseModelsResponse(null)).toThrow(
      "Invalid response from codex model/list.",
    );
    expect(() => parseModelsResponse({})).toThrow(
      "Invalid response from codex model/list.",
    );
    expect(() => parseModelsResponse({ data: "nope" })).toThrow(
      "Invalid response from codex model/list.",
    );
  });

  it("throws when every model entry is unusable", () => {
    expect(() =>
      parseModelsResponse({
        data: [{ missing: "id" }, null, 3],
      }),
    ).toThrow("Codex model/list returned no supported models.");
  });

  describe("service tiers", () => {
    function tiersFor(model: Record<string, unknown>) {
      return parseModelsResponse({
        data: [{ id: "gpt-6-astra", model: "gpt-6-astra", ...model }],
      })[0]?.supportedServiceTiers;
    }

    it("reports the tiers Codex lists, naming its priority tier fast", () => {
      expect(
        tiersFor({
          additionalSpeedTiers: ["fast"],
          serviceTiers: [
            {
              id: "priority",
              name: "Fast",
              description: "1.5x speed, increased usage",
            },
            { id: "ultrafast", name: "Ultrafast", description: "" },
          ],
        }),
      ).toEqual([
        {
          id: "fast",
          label: "Fast",
          description: "1.5x speed, increased usage",
        },
        { id: "ultrafast", label: "Ultrafast" },
      ]);
    });

    it("reports no tiers for a model Codex lists none for", () => {
      expect(tiersFor({ serviceTiers: [] })).toEqual([]);
    });

    it("falls back to the legacy speed tiers, then to fast alone", () => {
      expect(tiersFor({ additionalSpeedTiers: ["fast"] })).toEqual([
        { id: "fast" },
      ]);
      expect(tiersFor({ additionalSpeedTiers: [] })).toEqual([]);
      expect(tiersFor({})).toEqual([{ id: "fast" }]);
    });

    it("skips malformed and repeated tier entries", () => {
      expect(
        tiersFor({
          serviceTiers: [
            { name: "No id" },
            null,
            { id: "priority" },
            { id: "fast", name: "Duplicate of priority" },
          ],
        }),
      ).toEqual([{ id: "fast" }]);
    });
  });
});

describe("parseModelCatalog Daybreak", () => {
  const entry = (model: string, cyber?: string[], isDefault = false) => ({
    id: model,
    model,
    isDefault,
    ...(cyber === undefined ? {} : { availableAccessPrograms: { cyber } }),
  });
  const optionOf = (model: { sessionOptions?: unknown }) => {
    const option = (
      model.sessionOptions as { value: boolean; fixed?: boolean }[]
    )[0];
    return [option?.value, option?.fixed === true];
  };

  it("adds no option when no model advertises a Daybreak program", () => {
    const catalog = parseModelCatalog({
      data: [entry("gpt-6-astra", ["standard"], true), entry("gpt-5.5")],
    });
    expect(catalog.daybreakAvailable).toBe(false);
    expect(catalog.models.map((model) => model.sessionOptions)).toEqual([
      undefined,
      undefined,
    ]);
    expect(catalog.selectedOnlyModels).toEqual([]);
  });

  it("marks each model with whether it runs with Daybreak, without it, or both", () => {
    const catalog = parseModelCatalog({
      data: [
        entry("gpt-6-astra", ["standard"], true),
        entry("gpt-6-sol", ["standard", "daybreakBlue"]),
        entry("gpt-legacy"),
        entry("gpt-red-only", ["daybreakRed"]),
        entry("gpt-daybreak-blue-latest", ["daybreakBlue"]),
      ],
    });
    expect(catalog.daybreakAvailable).toBe(true);
    expect(
      catalog.models.map((model) => [model.model, ...optionOf(model)]),
    ).toEqual([
      ["gpt-6-astra", false, true],
      ["gpt-6-sol", false, false],
      ["gpt-legacy", false, true],
      ["gpt-red-only", true, true],
    ]);
    expect(
      catalog.selectedOnlyModels.map((model) => [
        model.model,
        ...optionOf(model),
      ]),
    ).toEqual([["gpt-daybreak-blue-latest", true, true]]);
  });

  it("keeps the alias as a regular model when it is the only way to reach Daybreak", () => {
    const catalog = parseModelCatalog({
      data: [
        entry("gpt-6-astra", ["standard"], true),
        entry("gpt-daybreak-blue-latest", ["daybreakBlue"]),
      ],
    });
    expect(catalog.models.map((model) => model.model)).toEqual([
      "gpt-6-astra",
      "gpt-daybreak-blue-latest",
    ]);
    expect(catalog.selectedOnlyModels).toEqual([]);
  });

  it("ignores programs it does not know", () => {
    const catalog = parseModelCatalog({
      data: [entry("gpt-6-sol", ["standard", "daybreakGreen"], true)],
    });
    expect(catalog.daybreakAvailable).toBe(false);
    expect(catalog.cyberProgramsByModel.get("gpt-6-sol")).toEqual(["standard"]);
  });
});

describe("cyberProgramForTurn", () => {
  it("prefers blue over red with Daybreak on and asks for standard with it off", () => {
    expect(
      cyberProgramForTurn(["standard", "daybreakBlue", "daybreakRed"], true),
    ).toBe("daybreakBlue");
    expect(cyberProgramForTurn(["standard", "daybreakRed"], true)).toBe(
      "daybreakRed",
    );
    expect(cyberProgramForTurn(["standard", "daybreakBlue"], false)).toBe(
      "standard",
    );
  });

  it("asks for nothing when the model cannot run in the chosen state", () => {
    expect(cyberProgramForTurn(["standard"], true)).toBeNull();
    expect(cyberProgramForTurn(["daybreakBlue"], false)).toBeNull();
    expect(cyberProgramForTurn([], false)).toBeNull();
  });
});
