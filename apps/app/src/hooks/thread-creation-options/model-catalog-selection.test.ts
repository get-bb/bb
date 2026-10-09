import { describe, expect, it } from "vitest";
import type { AvailableModel } from "@bb/domain";
import { resolveModelReasoningLevel } from "./model-catalog-selection";

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
