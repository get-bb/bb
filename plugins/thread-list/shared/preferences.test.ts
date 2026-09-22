import { describe, expect, it } from "vitest";
import { getPreferenceDefault, parsePreferenceValue } from "./preferences.js";

describe("provider icon color preferences", () => {
  it("default to brand colors with no custom colors", () => {
    expect(getPreferenceDefault("providerIconColor")).toBe("brand");
    expect(getPreferenceDefault("providerIconColors")).toEqual({});
  });

  it("accept CSS colors for both appearances", () => {
    expect(
      parsePreferenceValue("providerIconColors", {
        codex: { light: "#112233", dark: "oklch(70% 0.1 200)" },
      }),
    ).toEqual({
      success: true,
      value: { codex: { light: "#112233", dark: "oklch(70% 0.1 200)" } },
    });
  });

  it("reject values that are not colors, or a missing appearance", () => {
    expect(
      parsePreferenceValue("providerIconColors", {
        codex: { light: "url(evil)", dark: "#000" },
      }).success,
    ).toBe(false);
    expect(
      parsePreferenceValue("providerIconColors", { codex: { light: "#000" } })
        .success,
    ).toBe(false);
    expect(parsePreferenceValue("providerIconColor", "rainbow").success).toBe(
      false,
    );
  });
});
