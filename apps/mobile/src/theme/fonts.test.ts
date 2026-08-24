import { describe, expect, it } from "vitest";
import { FONT_FAMILIES, resolveFont } from "./fonts";

describe("resolveFont", () => {
  it("defaults to regular Inter", () => {
    expect(resolveFont({})).toEqual({
      fontFamily: FONT_FAMILIES.sans.regular,
      fontWeight: "400",
    });
  });

  it("derives weight and family from web-style utility classes", () => {
    expect(resolveFont({ className: "text-sm font-medium" })).toEqual({
      fontFamily: FONT_FAMILIES.sans.medium,
      fontWeight: "500",
    });
    expect(
      resolveFont({ className: "font-mono text-xs font-semibold" }),
    ).toEqual({
      fontFamily: FONT_FAMILIES.mono.semibold,
      fontWeight: "600",
    });
    expect(resolveFont({ className: "font-bold" }).fontFamily).toBe(
      FONT_FAMILIES.sans.bold,
    );
  });

  it("does not match class prefixes loosely", () => {
    expect(resolveFont({ className: "font-mono-medium" }).fontFamily).toBe(
      FONT_FAMILIES.sans.regular,
    );
    expect(resolveFont({ className: "font-boldish" }).fontFamily).toBe(
      FONT_FAMILIES.sans.regular,
    );
  });

  it("lets explicit props override classes", () => {
    expect(
      resolveFont({
        className: "font-mono font-bold",
        weight: "regular",
        mono: false,
      }),
    ).toEqual({ fontFamily: FONT_FAMILIES.sans.regular, fontWeight: "400" });
    expect(resolveFont({ className: "font-sans", mono: true }).fontFamily).toBe(
      FONT_FAMILIES.mono.regular,
    );
  });

  it("prefers the heaviest weight when a merged class string carries several", () => {
    // cn() removes conflicts, but raw strings can still carry both.
    expect(resolveFont({ className: "font-medium font-bold" }).fontWeight).toBe(
      "700",
    );
  });
});
