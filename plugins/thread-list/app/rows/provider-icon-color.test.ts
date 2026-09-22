import { describe, expect, it } from "vitest";
import {
  providerIconThemeVariable,
  resolveProviderIconColor,
} from "./provider-icon-color.js";

const BRAND = { light: "#d97757", dark: "#e08a6c" };

describe("resolveProviderIconColor", () => {
  it("lets the theme override the brand tint, per provider and then globally", () => {
    expect(
      resolveProviderIconColor({
        providerId: "claude-code",
        brandTint: BRAND,
        mode: "brand",
        customColors: {},
      }),
    ).toBe(
      "var(--provider-icon-claude-code, var(--provider-icon, light-dark(#d97757, #e08a6c)))",
    );
  });

  it("falls back to the row text color in monochrome", () => {
    expect(
      resolveProviderIconColor({
        providerId: "codex",
        brandTint: BRAND,
        mode: "monochrome",
        customColors: {},
      }),
    ).toBe("var(--provider-icon-codex, var(--provider-icon, currentColor))");
  });

  it("falls back to the row text color when the brand tint is missing or invalid", () => {
    for (const brandTint of [null, { light: "url(x)", dark: "#fff" }]) {
      expect(
        resolveProviderIconColor({
          providerId: "codex",
          brandTint,
          mode: "brand",
          customColors: {},
        }),
      ).toBe("var(--provider-icon-codex, var(--provider-icon, currentColor))");
    }
  });

  it("puts a custom color ahead of the theme and the mode", () => {
    expect(
      resolveProviderIconColor({
        providerId: "codex",
        brandTint: BRAND,
        mode: "monochrome",
        customColors: { codex: { light: "#112233", dark: "#445566" } },
      }),
    ).toBe("light-dark(#112233, #445566)");
  });
});

describe("providerIconThemeVariable", () => {
  it("turns characters a CSS ident cannot hold into dashes", () => {
    expect(providerIconThemeVariable("acp:hermes agent")).toBe(
      "--provider-icon-acp-hermes-agent",
    );
  });
});
