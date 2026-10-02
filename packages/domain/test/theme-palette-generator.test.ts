import { describe, expect, it } from "vitest";
import {
  contrastRatio,
  ensureContrast,
  hexToOklch,
  oklchToHex,
} from "../src/theme-color.js";
import {
  TEXT_CONTRAST_FLOOR,
  generatePalette,
  paletteContrastReport,
  renderPaletteCss,
} from "../src/theme-palette-generator.js";

describe("oklch color math", () => {
  it("round-trips hex through oklch within rounding tolerance", () => {
    for (const hex of ["#2e3440", "#eceff4", "#bf616a", "#88c0d0", "#000000"]) {
      const back = oklchToHex(hexToOklch(hex));
      const channelDistance = (a: string, b: string): number =>
        Math.max(
          ...[0, 2, 4].map((index) =>
            Math.abs(
              parseInt(a.slice(index, index + 2), 16) -
                parseInt(b.slice(index, index + 2), 16),
            ),
          ),
        );
      expect(
        channelDistance(back.slice(1), hex.toLowerCase().slice(1)),
      ).toBeLessThanOrEqual(1);
    }
  });

  it("reports the canonical contrast ratios for black on white and vice versa", () => {
    const white = hexToOklch("#ffffff");
    const black = hexToOklch("#000000");
    expect(contrastRatio(black, white)).toBeCloseTo(21, 1);
    expect(contrastRatio(white, black)).toBeCloseTo(21, 1);
  });

  it("raises a failing color to the requested floor against the surface", () => {
    const canvas = hexToOklch("#2e3440");
    const tooDim = { lightness: 0.3, chroma: 0.05, hueDegrees: 220 };
    expect(contrastRatio(tooDim, canvas)).toBeLessThan(TEXT_CONTRAST_FLOOR);

    const fixed = ensureContrast(tooDim, canvas, TEXT_CONTRAST_FLOOR);

    expect(contrastRatio(fixed, canvas)).toBeGreaterThanOrEqual(
      TEXT_CONTRAST_FLOOR,
    );
    expect(fixed.lightness).toBeGreaterThan(tooDim.lightness);
  });

  it("leaves an already-passing color untouched", () => {
    const canvas = hexToOklch("#2e3440");
    const passing = { lightness: 0.85, chroma: 0.05, hueDegrees: 220 };
    expect(ensureContrast(passing, canvas, TEXT_CONTRAST_FLOOR)).toEqual(passing);
  });

  it("rejects malformed hex input", () => {
    expect(() => hexToOklch("nope")).toThrow(/hex color/);
  });
});

describe("palette generation", () => {
  const base = {
    accentHue: 250,
    accentChroma: 0.13,
    darkCanvasLightness: 0.22,
    lightCanvasLightness: 0.97,
  };

  it("keeps ink above the AA text floor against canvas in both modes", () => {
    for (const seed of [1, 7, 42, 1234, 99999]) {
      const palette = generatePalette({ ...base, seed });
      for (const entry of paletteContrastReport(palette)) {
        if (entry.mode.endsWith("ink/canvas")) {
          expect(entry.ratio).toBeGreaterThanOrEqual(TEXT_CONTRAST_FLOOR);
        }
      }
    }
  });

  it("emits a light canvas that is light and a dark canvas that is dark", () => {
    const palette = generatePalette({ ...base, seed: 3 });
    expect(hexToOklch(palette.light.canvas).lightness).toBeGreaterThan(0.9);
    expect(hexToOklch(palette.dark.canvas).lightness).toBeLessThan(0.35);
  });

  it("varies with the seed but stays deterministic for a given seed", () => {
    const first = generatePalette({ ...base, seed: 11 });
    const again = generatePalette({ ...base, seed: 11 });
    const other = generatePalette({ ...base, seed: 12 });

    expect(first).toEqual(again);
    expect(first.light).not.toEqual(other.light);
  });

  it("keeps generated semantics inside their hue bands across many seeds", () => {
    const band = (hue: number, center: number): number => {
      const raw = Math.abs(((hue - center) % 360) + 360) % 360;
      return Math.min(raw, 360 - raw);
    };
    for (let seed = 1; seed <= 40; seed += 1) {
      const palette = generatePalette({ ...base, seed });
      expect(
        band(hexToOklch(palette.light.destructive).hueDegrees, 25),
      ).toBeLessThanOrEqual(13);
      expect(band(hexToOklch(palette.light.success).hueDegrees, 145)).toBeLessThanOrEqual(13);
      expect(band(hexToOklch(palette.light.warning).hueDegrees, 75)).toBeLessThanOrEqual(13);
      expect(band(hexToOklch(palette.light.prMerged).hueDegrees, 305)).toBeLessThanOrEqual(13);
    }
  });

  it("varies every editable token across seeds, not just the top three", () => {
    const palettes = [1, 2, 3, 4, 5, 6].map((seed) =>
      generatePalette({ ...base, seed }),
    );
    const keys = [
      "canvas",
      "ink",
      "primary",
      "destructive",
      "warning",
      "success",
      "prMerged",
      "fileAccent",
      "diffAdded",
      "diffRemoved",
    ] as const;

    for (const key of keys) {
      const distinct = new Set(
        palettes.map((palette) => palette.light[key]),
      );
      expect(distinct.size, `${key} did not vary`).toBeGreaterThan(1);
    }
  });

  it("keeps semantics in their recognizable hue bands despite jitter", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const palette = generatePalette({ ...base, seed });
      const band = (hue: number, center: number): number => {
        const raw = Math.abs(((hue - center) % 360) + 360) % 360;
        return Math.min(raw, 360 - raw);
      };
      expect(band(hexToOklch(palette.light.destructive).hueDegrees, 25)).toBeLessThanOrEqual(13);
      expect(band(hexToOklch(palette.light.success).hueDegrees, 145)).toBeLessThanOrEqual(13);
      expect(band(hexToOklch(palette.light.warning).hueDegrees, 75)).toBeLessThanOrEqual(13);
    }
  });

  it("gives destructive, success, and merged distinct recognizable hues", () => {
    const palette = generatePalette({ ...base, seed: 5 });
    const hues = [
      hexToOklch(palette.light.destructive).hueDegrees,
      hexToOklch(palette.light.success).hueDegrees,
      hexToOklch(palette.light.prMerged).hueDegrees,
    ];

    for (const hue of hues) {
      expect(hue).not.toBeCloseTo(0, 1);
    }
    expect(Math.abs(hues[0] - hues[1])).toBeGreaterThan(40);
    expect(Math.abs(hues[1] - hues[2])).toBeGreaterThan(40);
  });

  it("renders css with both mode blocks and the derivation recipe", () => {
    const css = renderPaletteCss(generatePalette({ ...base, seed: 2 }));

    expect(css).toContain(":root,\n.light {");
    expect(css).toContain(".dark {");
    expect(css).toContain("--canvas:");
    expect(css).toContain("--ink:");
    expect(css).toContain("--primary:");
    expect(css).toContain(
      "--muted-foreground: color-mix(in oklch, var(--ink) 70%, var(--canvas));",
    );
    expect(css).toContain("--pr-merged:");
    expect(css).toContain("--diff-added:");
    expect(css).toContain("--file-accent:");
  });
});
