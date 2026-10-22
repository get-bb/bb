import { describe, expect, it } from "vitest";
import { loadPluginApp } from "@get-bb/plugin-sdk/testing/app";

const app = await loadPluginApp(() => import("./app"));

describe("Live Markdown app", () => {
  it("registers paint-only rules, hiding symbols off the caret line", () => {
    const [customization] = app.composerCustomizations;
    const effects = customization?.richText?.effects ?? [];
    expect(
      effects
        .filter((effect) => effect.experimental_skipAtCaret === "line")
        .map((effect) => effect.id),
    ).toEqual(["marker"]);
    const strong = effects.find((effect) => effect.id === "strong");
    expect(strong?.match("a **b**")).toEqual([{ from: 4, to: 5 }]);
  });
});
