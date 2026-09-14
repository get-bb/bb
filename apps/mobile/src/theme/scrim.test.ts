import { describe, expect, it } from "vitest";
import { scrimBaseColor } from "./scrim";
import { nativeThemes } from "./theme.native";

function blendOver(base: string, overlay: string, alpha: number): string {
  const under = parseRgb(base);
  const over = parseRgb(overlay);
  if (!under || !over) return base;
  const t = Math.min(1, Math.max(0, alpha)) * over.a;
  const mix = (a: number, b: number) => Math.round(a + (b - a) * t);
  return `rgb(${mix(under.r, over.r)}, ${mix(under.g, over.g)}, ${mix(under.b, over.b)})`;
}

function parseRgb(
  color: string,
): { r: number; g: number; b: number; a: number } | null {
  const hex = /^#([0-9a-f]{3,8})$/iu.exec(color.trim());
  if (hex) {
    const digits = hex[1] ?? "";
    if (digits.length === 3 || digits.length === 4) {
      return {
        r: parseInt(digits[0]!.repeat(2), 16),
        g: parseInt(digits[1]!.repeat(2), 16),
        b: parseInt(digits[2]!.repeat(2), 16),
        a: digits.length === 4 ? parseInt(digits[3]!.repeat(2), 16) / 255 : 1,
      };
    }
    if (digits.length === 6 || digits.length === 8) {
      return {
        r: parseInt(digits.slice(0, 2), 16),
        g: parseInt(digits.slice(2, 4), 16),
        b: parseInt(digits.slice(4, 6), 16),
        a: digits.length === 8 ? parseInt(digits.slice(6, 8), 16) / 255 : 1,
      };
    }
    return null;
  }
  const rgb =
    /^rgba?\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)\s*(?:,\s*([0-9.]+)\s*)?\)$/iu.exec(
      color.trim(),
    );
  if (!rgb) return null;
  return {
    r: Number(rgb[1]),
    g: Number(rgb[2]),
    b: Number(rgb[3]),
    a: rgb[4] === undefined ? 1 : Number(rgb[4]),
  };
}

function luminance(color: string): number {
  const match = /^rgb\((\d+), (\d+), (\d+)\)$/u.exec(color);
  if (!match) throw new Error(`unexpected color ${color}`);
  return (
    0.2126 * Number(match[1]) +
    0.7152 * Number(match[2]) +
    0.0722 * Number(match[3])
  );
}

describe("scrimBaseColor", () => {
  it("darkens the page and its lifted surfaces in every palette and mode", () => {
    for (const [palette, modes] of Object.entries(nativeThemes)) {
      for (const mode of ["light", "dark"] as const) {
        const tokens = modes[mode];
        const scrim = scrimBaseColor(mode, tokens);
        for (const key of ["background", "surfaceGroupedCell"] as const) {
          const before = luminance(blendOver(tokens[key], scrim, 0));
          const after = luminance(blendOver(tokens[key], scrim, 0.35));
          const label = `${palette}/${mode}/${key}`;
          if (before === 0) {
            expect(key, label).toBe("background");
            expect(after, label).toBe(0);
          } else {
            expect(after, label).toBeLessThan(before);
          }
        }
      }
    }
  });
});
