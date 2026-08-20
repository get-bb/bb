import { describe, expect, it } from "vitest";
import { nativeThemes } from "@/theme/theme.native";
import { resolveAnsiColors } from "./ansi-styles";

const tokens = nativeThemes.default.dark;
const defaults = { foreground: "#fg", background: "#bg" };

describe("resolveAnsiColors", () => {
  it("uses the defaults when no color is set", () => {
    expect(
      resolveAnsiColors(
        { fg: null, bg: null, inverse: false },
        tokens,
        defaults,
      ),
    ).toEqual({ color: "#fg", backgroundColor: undefined });
  });

  it("maps palette indexes to the theme tokens", () => {
    expect(
      resolveAnsiColors({ fg: 1, bg: null, inverse: false }, tokens, defaults),
    ).toEqual({ color: tokens.ansi1, backgroundColor: undefined });
    expect(
      resolveAnsiColors({ fg: 15, bg: 4, inverse: false }, tokens, defaults),
    ).toEqual({ color: tokens.ansi15, backgroundColor: tokens.ansi4 });
  });

  it("forces the contrast foreground on a background-only span", () => {
    expect(
      resolveAnsiColors({ fg: null, bg: 3, inverse: false }, tokens, defaults),
    ).toEqual({ color: tokens.ansiBgFg3, backgroundColor: tokens.ansi3 });
  });

  it("swaps sides for inverse video", () => {
    expect(
      resolveAnsiColors({ fg: 2, bg: null, inverse: true }, tokens, defaults),
    ).toEqual({ color: "#bg", backgroundColor: tokens.ansi2 });
    expect(
      resolveAnsiColors(
        { fg: null, bg: null, inverse: true },
        tokens,
        defaults,
      ),
    ).toEqual({ color: "#bg", backgroundColor: "#fg" });
  });
});
