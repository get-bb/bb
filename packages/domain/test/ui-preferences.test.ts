import { describe, expect, it } from "vitest";
import {
  getUiPreferenceDefault,
  parseUiPreferenceValue,
} from "../src/ui-preferences.js";

describe("sidebar lifecycle preference", () => {
  it("defaults to Active and accepts a nonempty distinct lifecycle selection", () => {
    expect(getUiPreferenceDefault("sidebar.threadLifecycles")).toEqual([
      "active",
    ]);
    expect(
      parseUiPreferenceValue("sidebar.threadLifecycles", ["draft", "archived"]),
    ).toEqual({
      success: true,
      value: ["draft", "archived"],
    });
  });

  it.each(
    [[], ["draft", "draft"], ["unknown"], "active", null].map((value) => ({
      value,
    })),
  )("rejects invalid selection $value", ({ value }) => {
    expect(
      parseUiPreferenceValue("sidebar.threadLifecycles", value).success,
    ).toBe(false);
  });
});
