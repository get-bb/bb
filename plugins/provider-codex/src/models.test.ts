import { describe, expect, it } from "vitest";
import {
  codexDaybreakProgram,
  parseModelsResponse,
  splitDaybreakAliasModels,
} from "./models.js";

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

  it("skips unknown reasoning efforts without rejecting the model", () => {
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
    ).toEqual(["low", "high"]);
    expect(models[0]?.defaultReasoningEffort).toBe("low");
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

  it("falls back to default efforts when every effort is unknown", () => {
    const models = parseModelsResponse({
      data: [
        {
          id: "odd-model",
          model: "odd-model",
          supportedReasoningEfforts: [
            { reasoningEffort: "quantum", description: "Brand new" },
          ],
          defaultReasoningEffort: "quantum",
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
        experimental_supportedModelOptions: { daybreak: ["off"] },
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

function catalogEntry(model: string, cyber: string[] | null) {
  return {
    id: model,
    model,
    displayName: model,
    supportedReasoningEfforts: [
      { reasoningEffort: "medium", description: "Medium" },
    ],
    defaultReasoningEffort: "medium",
    isDefault: model === "gpt-6-astra",
    ...(cyber === null ? {} : { availableAccessPrograms: { cyber } }),
  };
}

describe("Daybreak model options", () => {
  const models = parseModelsResponse({
    data: [
      catalogEntry("gpt-6-astra", ["standard"]),
      catalogEntry("gpt-6-sol", ["standard", "daybreakBlue"]),
      catalogEntry("gpt-cyber-red", ["daybreakRed"]),
      catalogEntry("gpt-daybreak-blue-latest", ["daybreakBlue"]),
      catalogEntry("gpt-legacy", null),
    ],
  });

  it("maps each model's cyber access programs to Daybreak values", () => {
    expect(
      Object.fromEntries(
        models.map((model) => [
          model.model,
          model.experimental_supportedModelOptions?.daybreak,
        ]),
      ),
    ).toEqual({
      "gpt-6-astra": ["off"],
      "gpt-6-sol": ["off", "on"],
      "gpt-cyber-red": ["on"],
      "gpt-daybreak-blue-latest": ["on"],
      "gpt-legacy": ["off"],
    });
  });

  it("prefers Daybreak Blue and reports no program without a Daybreak entry", () => {
    expect(codexDaybreakProgram(["daybreakRed", "daybreakBlue"])).toBe(
      "daybreakBlue",
    );
    expect(codexDaybreakProgram(["daybreakRed"])).toBe("daybreakRed");
    expect(codexDaybreakProgram(["standard"])).toBeNull();
    expect(codexDaybreakProgram(null)).toBeNull();
  });

  it("moves the Daybreak alias models to selected-only once the switch can replace them", () => {
    const split = splitDaybreakAliasModels(models);
    expect(split.models.map((model) => model.model)).toEqual([
      "gpt-6-astra",
      "gpt-6-sol",
      "gpt-cyber-red",
      "gpt-legacy",
    ]);
    expect(split.selectedOnlyModels.map((model) => model.model)).toEqual([
      "gpt-daybreak-blue-latest",
    ]);
  });

  it("keeps the aliases listed when no other model offers Daybreak", () => {
    const aliasOnly = parseModelsResponse({
      data: [
        catalogEntry("gpt-6-astra", ["standard"]),
        catalogEntry("gpt-daybreak-blue-latest", ["daybreakBlue"]),
      ],
    });
    expect(splitDaybreakAliasModels(aliasOnly)).toEqual({
      models: aliasOnly,
      selectedOnlyModels: [],
    });
  });
});
