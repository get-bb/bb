import { describe, expect, it } from "vitest";
import {
  getUiPreferenceDefault,
  parseUiPreferenceValue,
} from "../src/ui-preferences.js";

describe.each([
  "sidebar.threadLifecycles",
  "palette.threadLifecycles",
] as const)("%s", (key) => {
  it("defaults to Active and accepts a nonempty distinct lifecycle selection", () => {
    expect(getUiPreferenceDefault(key)).toEqual(["active"]);
    expect(parseUiPreferenceValue(key, ["draft", "archived"])).toEqual({
      success: true,
      value: ["active", "archived"],
    });
  });

  it.each(
    [[], ["draft", "draft"], ["unknown"], "active", null].map((value) => ({
      value,
    })),
  )("rejects invalid selection $value", ({ value }) => {
    expect(parseUiPreferenceValue(key, value).success).toBe(false);
  });
});
