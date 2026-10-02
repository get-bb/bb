import { describe, expect, it } from "vitest";
import { contrastRatio, hexToOklch } from "../src/theme-color.js";
import {
  CONSTRAINT_LEVEL_OPTIONS,
  CONSTRAINT_PROFILES,
  MAX_CONSTRAINT_LEVEL,
  MIN_CONSTRAINT_LEVEL,
  getConstraintProfile,
} from "../src/theme-constraint.js";
import {
  TEXT_CONTRAST_FLOOR,
  generatePalette,
} from "../src/theme-palette-generator.js";

const base = {
  accentHue: 250,
  accentChroma: 0.13,
  darkCanvasLightness: 0.22,
  lightCanvasLightness: 0.97,
};

function hueSpread(values: readonly string[]): number {
  const hues = values.map((value) => hexToOklch(value).hueDegrees);
  let max = 0;
  for (const a of hues) {
    for (const b of hues) {
      const raw = Math.abs(((a - b) % 360) + 360) % 360;
      max = Math.max(max, Math.min(raw, 360 - raw));
    }
  }
  return max;
}

describe("constraint profiles", () => {
  it("offers five ordered levels from structured to unfiltered", () => {
    expect(CONSTRAINT_LEVEL_OPTIONS).toEqual([1, 2, 3, 4, 5]);
    expect(MIN_CONSTRAINT_LEVEL).toBe(1);
    expect(MAX_CONSTRAINT_LEVEL).toBe(5);
  });

  it("loosens hue spread, surface spread, and chroma monotonically", () => {
    for (let level = 2; level <= MAX_CONSTRAINT_LEVEL; level += 1) {
      const previous = CONSTRAINT_PROFILES[(level - 1) as 1 | 2 | 3 | 4];
      const current = CONSTRAINT_PROFILES[level as 2 | 3 | 4 | 5];
      expect(current.semanticHueSpreadDegrees).toBeGreaterThanOrEqual(
        previous.semanticHueSpreadDegrees,
      );
      expect(current.accentHueSpreadDegrees).toBeGreaterThanOrEqual(
        previous.accentHueSpreadDegrees,
      );
      expect(current.semanticChromaMax).toBeGreaterThanOrEqual(
        previous.semanticChromaMax,
      );
    }
  });

  it("only the two loosest levels drop semantic text contrast", () => {
    expect(CONSTRAINT_PROFILES[1].enforceSemanticTextContrast).toBe(true);
    expect(CONSTRAINT_PROFILES[3].enforceSemanticTextContrast).toBe(true);
    expect(CONSTRAINT_PROFILES[4].enforceSemanticTextContrast).toBe(false);
    expect(CONSTRAINT_PROFILES[5].enforceSemanticTextContrast).toBe(false);
  });

  it("clamps out-of-range levels instead of failing", () => {
    expect(getConstraintProfile(0).level).toBe(1);
    expect(getConstraintProfile(99).level).toBe(5);
    expect(getConstraintProfile(3).level).toBe(3);
  });
});

describe("canvas follows its mode", () => {
  const canvasLightness = (
    level: 1 | 2 | 3 | 4 | 5,
    mode: "light" | "dark",
  ): number[] =>
    Array.from({ length: 80 }, (_, index) =>
      hexToOklch(
        generatePalette({ ...base, seed: index + 1, constraintLevel: level })[
          mode
        ].canvas,
      ).lightness,
    );

  it("keeps light mode light and dark mode dark at the strict levels", () => {
    for (const level of [1, 2, 3] as const) {
      for (const value of canvasLightness(level, "light")) {
        expect(value, `level ${level} light`).toBeGreaterThanOrEqual(0.6);
      }
      for (const value of canvasLightness(level, "dark")) {
        expect(value, `level ${level} dark`).toBeLessThanOrEqual(0.45);
      }
    }
  });

  it("relaxes the guarantee monotonically as rules loosen", () => {
    const lightRate = (level: 1 | 2 | 3 | 4 | 5): number => {
      const values = canvasLightness(level, "light");
      return values.filter((value) => value >= 0.6).length / values.length;
    };
    const rates = [1, 2, 3, 4, 5].map((level) =>
      lightRate(level as 1 | 2 | 3 | 4 | 5),
    );
    for (let index = 1; index < rates.length; index += 1) {
      expect(rates[index]).toBeLessThanOrEqual(rates[index - 1]);
    }
    expect(rates[0]).toBe(1);
    expect(rates[4]).toBeLessThan(0.75);
  });

  it("declares a bias that falls to zero at the loosest level", () => {
    expect(CONSTRAINT_PROFILES[1].canvasModeBias).toBe(1);
    expect(CONSTRAINT_PROFILES[5].canvasModeBias).toBe(0);
    for (let level = 2; level <= MAX_CONSTRAINT_LEVEL; level += 1) {
      expect(
        CONSTRAINT_PROFILES[level as 2 | 3 | 4 | 5].canvasModeBias,
      ).toBeLessThanOrEqual(
        CONSTRAINT_PROFILES[(level - 1) as 1 | 2 | 3 | 4].canvasModeBias,
      );
    }
  });
});

describe("constraint level changes the output", () => {
  it("produces far more hue variance as the level rises", () => {
    const spreads = ([1, 3, 5] as const).map((level) => {
      const successes = Array.from({ length: 12 }, (_, index) =>
        generatePalette({ ...base, seed: index + 1, constraintLevel: level }),
      ).map((palette) => palette.light.success);
      return hueSpread(successes);
    });

    expect(spreads[2]).toBeGreaterThan(spreads[0] + 60);
    expect(spreads[1]).toBeGreaterThan(spreads[0]);
  });

  it("produces far more surface variance as the level rises", () => {
    const range = (level: 1 | 3 | 5): number => {
      const values = Array.from({ length: 12 }, (_, index) =>
        hexToOklch(
          generatePalette({ ...base, seed: index + 1, constraintLevel: level })
            .light.canvas,
        ).lightness,
      );
      return Math.max(...values) - Math.min(...values);
    };

    expect(range(5)).toBeGreaterThan(range(1) * 2);
  });

  it("keeps ink readable against canvas at every level, including unfiltered", () => {
    for (const level of CONSTRAINT_LEVEL_OPTIONS) {
      for (let seed = 1; seed <= 30; seed += 1) {
        const palette = generatePalette({ ...base, seed, constraintLevel: level });
        for (const mode of ["light", "dark"] as const) {
          const anchors = palette[mode];
          const ratio = contrastRatio(
            hexToOklch(anchors.ink),
            hexToOklch(anchors.canvas),
          );
          expect(
            ratio,
            `level ${level} seed ${seed} ${mode} ink/canvas`,
          ).toBeGreaterThanOrEqual(TEXT_CONTRAST_FLOOR);
        }
      }
    }
  });

  it("emits valid hex for every token at every level", () => {
    for (const level of CONSTRAINT_LEVEL_OPTIONS) {
      for (let seed = 1; seed <= 20; seed += 1) {
        const palette = generatePalette({ ...base, seed, constraintLevel: level });
        for (const mode of ["light", "dark"] as const) {
          for (const [key, value] of Object.entries(palette[mode])) {
            expect(value, `level ${level} ${mode}.${key}`).toMatch(
              /^#[0-9a-f]{6}$/,
            );
          }
        }
      }
    }
  });

  it("defaults to the structured level when none is given", () => {
    const implicit = generatePalette({ ...base, seed: 4 });
    const explicit = generatePalette({ ...base, seed: 4, constraintLevel: 1 });
    expect(implicit).toEqual(explicit);
  });
});
