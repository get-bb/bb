import { describe, expect, it } from "vitest";
import type { AvailableModel } from "@bb/domain";
import {
  resolveModelCatalogSelection,
  resolveModelReasoningLevel,
} from "./model-catalog-selection";

function model(
  levels: readonly string[],
  defaultLevel: string,
): AvailableModel {
  return {
    id: "atlas",
    model: "atlas",
    displayName: "Atlas",
    description: "",
    supportedReasoningEfforts: levels.map((level) => ({
      reasoningEffort: level,
      description: level,
    })),
    defaultReasoningEffort: defaultLevel,
    isDefault: true,
  };
}

describe("resolveModelReasoningLevel", () => {
  it("opens a model whose levels are all provider-specific on the level the provider marked as its default", () => {
    expect(
      resolveModelReasoningLevel(
        model(["off", "think", "think-hard"], "think"),
        "medium",
      ),
    ).toBe("think");
  });

  it("keeps a remembered provider-specific level the model still offers", () => {
    expect(
      resolveModelReasoningLevel(
        model(["off", "think", "think-hard"], "think"),
        "think-hard",
      ),
    ).toBe("think-hard");
  });

  it("still picks the nearest standard level when the model has any", () => {
    expect(
      resolveModelReasoningLevel(
        model(["minimal", "low", "high"], "high"),
        "medium",
      ),
    ).toBe("high");
    expect(
      resolveModelReasoningLevel(
        model(["minimal", "low", "high"], "minimal"),
        "xhigh",
      ),
    ).toBe("high");
  });

  it("keeps the remembered level when the model lists none", () => {
    expect(resolveModelReasoningLevel(model([], "medium"), "xhigh")).toBe(
      "xhigh",
    );
    expect(resolveModelReasoningLevel(undefined, "low")).toBe("low");
  });
});

function daybreakModel(
  id: string,
  daybreak: { value: boolean; fixed: boolean },
  isDefault = false,
): AvailableModel {
  return {
    ...model(["low", "high"], "high"),
    id,
    model: id,
    displayName: id,
    isDefault,
    sessionOptions: [
      { type: "boolean", id: "daybreak", label: "Daybreak", ...daybreak },
    ],
  };
}

function selectWithDaybreak(
  selectedModel: string,
  sessionOptionSelections: Record<string, string | boolean>,
  models: AvailableModel[] = [
    daybreakModel("astra", { value: false, fixed: true }),
    daybreakModel("sol", { value: false, fixed: false }, true),
    daybreakModel("luna", { value: false, fixed: false }),
    daybreakModel("daybreak-only", { value: true, fixed: true }),
  ],
) {
  return resolveModelCatalogSelection({
    models,
    selectedOnlyModels: [],
    selectedModel,
    sessionOptionSelections,
    provider: undefined,
    catalogIsVerified: true,
    formatModelLabel: (name) => name,
  });
}

describe("resolveModelCatalogSelection with agent options", () => {
  it("leaves every model selectable until the user chooses an option", () => {
    const selection = selectWithDaybreak("astra", {});
    expect(selection.selectedModel).toBe("astra");
    expect(selection.modelOptions.map((option) => option.disabled)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
    expect(selection.declaredSessionOptions).toEqual([
      {
        type: "boolean",
        id: "daybreak",
        label: "Daybreak",
        value: false,
        fixed: false,
      },
    ]);
  });

  it("moves off a model the chosen option rules out, preferring the default, and greys that model out", () => {
    const selection = selectWithDaybreak("astra", { daybreak: true });
    expect(selection.selectedModel).toBe("sol");
    expect(selection.activeModel?.model).toBe("sol");
    expect(selection.isUnavailableModelRecovery).toBe(false);
    expect(selection.isSessionOptionModelSwitch).toBe(true);
    expect(
      selection.modelOptions.map((option) => [
        option.value,
        option.disabledReason,
      ]),
    ).toEqual([
      ["astra", "Turn off Daybreak to use this model"],
      ["sol", undefined],
      ["luna", undefined],
      ["daybreak-only", undefined],
    ]);
  });

  it("keeps a compatible model and greys out the one that needs the option on", () => {
    const selection = selectWithDaybreak("luna", { daybreak: false });
    expect(selection.selectedModel).toBe("luna");
    expect(selection.isSessionOptionModelSwitch).toBe(false);
    expect(
      selection.modelOptions.find((option) => option.value === "daybreak-only")
        ?.disabledReason,
    ).toBe("Turn on Daybreak to use this model");
  });

  it("stays on the chosen model when no model fits the options", () => {
    const selection = selectWithDaybreak("astra", { daybreak: true }, [
      daybreakModel("astra", { value: false, fixed: true }, true),
    ]);
    expect(selection.selectedModel).toBe("astra");
  });

  it("drops a remembered choice the provider no longer declares or that has the wrong kind", () => {
    const selection = selectWithDaybreak("astra", {
      daybreak: "yes",
      gone: true,
    });
    expect(selection.sessionOptionSelections).toEqual({});
    expect(selection.selectedModel).toBe("astra");
  });

  it("rules out a model that does not list the chosen value of a select option", () => {
    const depth = (values: string[]): AvailableModel["sessionOptions"] => [
      {
        type: "select",
        id: "depth",
        label: "Search depth",
        value: values[0] ?? "",
        values: values.map((id) => ({ id, label: id })),
      },
    ];
    const selection = resolveModelCatalogSelection({
      models: [
        {
          ...model(["low"], "low"),
          id: "a",
          model: "a",
          sessionOptions: depth(["shallow"]),
        },
        {
          ...model(["low"], "low"),
          id: "b",
          model: "b",
          isDefault: false,
          sessionOptions: depth(["shallow", "deep"]),
        },
      ],
      selectedOnlyModels: [],
      selectedModel: "a",
      sessionOptionSelections: { depth: "deep" },
      provider: undefined,
      catalogIsVerified: true,
      formatModelLabel: (name) => name,
    });
    expect(selection.selectedModel).toBe("b");
    expect(selection.modelOptions[0]?.disabledReason).toBe(
      "Not available with Search depth set to deep",
    );
  });
});
