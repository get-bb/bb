import { describe, expect, it } from "vitest";
import * as defaultPlatform from "./font-platform";
import * as iosPlatform from "./font-platform.ios";
import { type FontWeightName, resolveFont } from "./fonts";

const WEIGHTS: readonly FontWeightName[] = [
  "regular",
  "medium",
  "semibold",
  "bold",
];

describe("font platform modules", () => {
  it("export the same names so Metro's .ios pick cannot drift from the default", () => {
    expect(Object.keys(iosPlatform).sort()).toEqual(
      Object.keys(defaultPlatform).sort(),
    );
    for (const weight of WEIGHTS) {
      expect(typeof iosPlatform.SANS_WEIGHTS[weight]).toBe("string");
      expect(typeof defaultPlatform.SANS_WEIGHTS[weight]).toBe("string");
    }
  });

  it("default (Android / node) names a real medium family and sends semibold as bold", () => {
    expect(defaultPlatform.SANS_FAMILIES).toEqual({
      regular: "sans-serif",
      medium: "sans-serif-medium",
      semibold: "sans-serif",
      bold: "sans-serif",
    });
    expect(defaultPlatform.SANS_WEIGHTS).toEqual({
      regular: "400",
      medium: "500",
      semibold: "700",
      bold: "700",
    });
    expect(defaultPlatform.MONO_FAMILY).toBe("monospace");
  });

  it("iOS leaves sans unset for the system font with exact weights, and uses Menlo for mono", () => {
    for (const weight of WEIGHTS) {
      expect(iosPlatform.SANS_FAMILIES[weight]).toBeUndefined();
    }
    expect(iosPlatform.SANS_WEIGHTS).toEqual({
      regular: "400",
      medium: "500",
      semibold: "600",
      bold: "700",
    });
    expect(iosPlatform.MONO_FAMILY).toBe("Menlo");
  });
});

describe("resolveFont", () => {
  it("defaults to the regular sans face with no italic", () => {
    const font = resolveFont({});
    expect(font).toEqual({
      fontFamily: "sans-serif",
      fontWeight: "400",
    });
    expect(font).not.toHaveProperty("fontStyle");
  });

  it("derives weight and family from web-style utility classes", () => {
    expect(resolveFont({ className: "text-sm font-medium" })).toEqual({
      fontFamily: "sans-serif-medium",
      fontWeight: "500",
    });
    expect(
      resolveFont({ className: "font-mono text-xs font-semibold" }),
    ).toEqual({
      fontFamily: "monospace",
      fontWeight: "700",
    });
    expect(resolveFont({ className: "font-bold" }).fontWeight).toBe("700");
  });

  it.each([
    ["regular", "sans-serif", "400"],
    ["medium", "sans-serif-medium", "500"],
    ["semibold", "sans-serif", "700"],
    ["bold", "sans-serif", "700"],
  ] as const)(
    "resolves %s to the default platform's sans face and to monospace",
    (weight, fontFamily, fontWeight) => {
      expect(resolveFont({ weight })).toEqual({ fontFamily, fontWeight });
      expect(resolveFont({ weight, mono: true })).toEqual({
        fontFamily: "monospace",
        fontWeight,
      });
    },
  );

  it("does not match class prefixes loosely", () => {
    expect(resolveFont({ className: "font-mono-medium" })).toEqual({
      fontFamily: "sans-serif",
      fontWeight: "400",
    });
    expect(resolveFont({ className: "font-boldish" }).fontWeight).toBe("400");
  });

  it("lets explicit props override classes", () => {
    expect(
      resolveFont({
        className: "font-mono font-bold",
        weight: "regular",
        mono: false,
      }),
    ).toEqual({ fontFamily: "sans-serif", fontWeight: "400" });
    expect(resolveFont({ className: "font-sans", mono: true }).fontFamily).toBe(
      "monospace",
    );
  });

  it("prefers the heaviest weight when a merged class string carries several", () => {
    expect(resolveFont({ className: "font-medium font-bold" }).fontWeight).toBe(
      "700",
    );
  });
});
