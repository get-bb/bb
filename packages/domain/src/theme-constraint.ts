export type ConstraintLevel = 1 | 2 | 3 | 4 | 5;

export interface ConstraintProfile {
  level: ConstraintLevel;
  label: string;
  description: string;
  accentHueSpreadDegrees: number;
  semanticHueSpreadDegrees: number;
  lightCanvasSpread: number;
  darkCanvasSpread: number;
  accentChromaMax: number;
  semanticChromaMax: number;
  enforceSemanticTextContrast: boolean;
  /**
   * How hard the generator pulls a canvas toward the end its mode implies.
   * 1 keeps light mode unmistakably light and dark mode unmistakably dark; 0
   * samples the whole allowed range evenly, so either mode can go either way.
   */
  canvasModeBias: number;
}

export const MIN_CONSTRAINT_LEVEL: ConstraintLevel = 1;
export const MAX_CONSTRAINT_LEVEL: ConstraintLevel = 5;

/**
 * Level 1 keeps every guideline the shipped themes follow: anchors close to the
 * surface, semantics inside their recognizable hue bands, and AA text contrast
 * everywhere. Level 5 drops every guideline but one — text still has to be
 * readable against the canvas behind it — so hues, chroma, and surface depth
 * are effectively unconstrained.
 */
export const CONSTRAINT_PROFILES: Readonly<
  Record<ConstraintLevel, ConstraintProfile>
> = {
  1: {
    level: 1,
    label: "Structured",
    description:
      "Anchors, recognizable semantic hues, and AA contrast on every text token.",
    accentHueSpreadDegrees: 24,
    semanticHueSpreadDegrees: 12,
    lightCanvasSpread: 0.1,
    darkCanvasSpread: 0.12,
    accentChromaMax: 0.16,
    semanticChromaMax: 0.17,
    enforceSemanticTextContrast: true,
    canvasModeBias: 1,
  },
  2: {
    level: 2,
    label: "Loose",
    description:
      "Semantics drift within a wider band and surfaces deepen a little further.",
    accentHueSpreadDegrees: 70,
    semanticHueSpreadDegrees: 40,
    lightCanvasSpread: 0.2,
    darkCanvasSpread: 0.24,
    accentChromaMax: 0.2,
    semanticChromaMax: 0.22,
    enforceSemanticTextContrast: true,
    canvasModeBias: 0.78,
  },
  3: {
    level: 3,
    label: "Expressive",
    description:
      "Semantics are only loosely related to their usual hue; contrast still holds for text.",
    accentHueSpreadDegrees: 150,
    semanticHueSpreadDegrees: 90,
    lightCanvasSpread: 0.34,
    darkCanvasSpread: 0.4,
    accentChromaMax: 0.26,
    semanticChromaMax: 0.28,
    enforceSemanticTextContrast: true,
    canvasModeBias: 0.55,
  },
  4: {
    level: 4,
    label: "Wild",
    description:
      "Hues are essentially unconstrained and canvas may go light or dark in either mode.",
    accentHueSpreadDegrees: 300,
    semanticHueSpreadDegrees: 220,
    lightCanvasSpread: 0.55,
    darkCanvasSpread: 0.6,
    accentChromaMax: 0.32,
    semanticChromaMax: 0.34,
    enforceSemanticTextContrast: false,
    canvasModeBias: 0.28,
  },
  5: {
    level: 5,
    label: "Unfiltered",
    description:
      "Pure randomness apart from one rule: text must stay readable against its canvas.",
    accentHueSpreadDegrees: 360,
    semanticHueSpreadDegrees: 360,
    lightCanvasSpread: 0.94,
    darkCanvasSpread: 0.94,
    accentChromaMax: 0.37,
    semanticChromaMax: 0.37,
    enforceSemanticTextContrast: false,
    canvasModeBias: 0,
  },
};

export function getConstraintProfile(
  level: number,
): ConstraintProfile {
  const clamped =
    level < MIN_CONSTRAINT_LEVEL
      ? MIN_CONSTRAINT_LEVEL
      : level > MAX_CONSTRAINT_LEVEL
        ? MAX_CONSTRAINT_LEVEL
        : level;
  return CONSTRAINT_PROFILES[clamped as ConstraintLevel];
}

export const CONSTRAINT_LEVEL_OPTIONS: readonly ConstraintLevel[] = [
  1, 2, 3, 4, 5,
];
