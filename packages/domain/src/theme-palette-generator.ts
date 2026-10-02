import {
  contrastRatio,
  contrastSafeHex,
  ensureContrast,
  hexToOklch,
  oklchToHexInGamut,
  shortestHueDistance,
  type OklchColor,
} from "./theme-color.js";
import {
  getConstraintProfile,
  type ConstraintLevel,
  type ConstraintProfile,
} from "./theme-constraint.js";

export const TEXT_CONTRAST_FLOOR = 4.5;

export interface PaletteAnchors {
  canvas: string;
  ink: string;
  primary: string;
  destructive: string;
  warning: string;
  success: string;
  prMerged: string;
  fileAccent: string;
  diffAdded: string;
  diffRemoved: string;
}

export interface GeneratedPalette {
  light: PaletteAnchors;
  dark: PaletteAnchors;
}

const SEMANTIC_HUES = {
  destructive: 25,
  warning: 75,
  success: 145,
  prMerged: 305,
} as const;


export interface SemanticJitter {
  destructive: number;
  warning: number;
  success: number;
  prMerged: number;
}

export const NEUTRAL_SEMANTIC_JITTER: SemanticJitter = {
  destructive: 0,
  warning: 0,
  success: 0,
  prMerged: 0,
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeHue(hue: number): number {
  return ((hue % 360) + 360) % 360;
}

function buildSemanticPair(
  baseHue: number,
  hueJitterDegrees: number,
  chroma: number,
  canvas: OklchColor,
  canvasIsDark: boolean,
  profile: ConstraintProfile,
): { fill: string; text: string } {
  const hueDegrees = normalizeHue(baseHue + hueJitterDegrees);
  const fill: OklchColor = {
    lightness: canvasIsDark ? 0.66 : 0.56,
    chroma,
    hueDegrees,
  };
  const text: OklchColor = {
    lightness: canvasIsDark ? 0.74 : 0.44,
    chroma: chroma * 0.85,
    hueDegrees,
  };
  return {
    fill: oklchToHexInGamut(fill),
    text: oklchToHexInGamut(
      profile.enforceSemanticTextContrast
        ? ensureContrast(text, canvas, TEXT_CONTRAST_FLOOR)
        : text,
    ),
  };
}

function buildModeAnchors(
  canvas: OklchColor,
  canvasHex: string,
  ink: string,
  accentHue: number,
  accentChroma: number,
  jitter: SemanticJitter,
  random: () => number,
  profile: ConstraintProfile,
  randomChroma: number,
): PaletteAnchors {
  const canvasIsDark = canvas.lightness < 0.5;
  const primary: OklchColor = {
    lightness: canvasIsDark ? 0.7 + random() * 0.1 : 0.47 + random() * 0.12,
    chroma: Math.min(profile.accentChromaMax, accentChroma * randomChroma),
    hueDegrees: accentHue,
  };
  const destructive = buildSemanticPair(
    SEMANTIC_HUES.destructive,
    jitter.destructive * profile.semanticHueSpreadDegrees,
    profile.semanticChromaMax * randomChroma,
    canvas,
    canvasIsDark,
    profile,
  );
  const warning = buildSemanticPair(
    SEMANTIC_HUES.warning,
    jitter.warning * profile.semanticHueSpreadDegrees,
    profile.semanticChromaMax * randomChroma,
    canvas,
    canvasIsDark,
    profile,
  );
  const success = buildSemanticPair(
    SEMANTIC_HUES.success,
    jitter.success * profile.semanticHueSpreadDegrees,
    profile.semanticChromaMax * randomChroma,
    canvas,
    canvasIsDark,
    profile,
  );

  const merged: OklchColor = {
    lightness: canvasIsDark ? 0.72 : 0.5,
    chroma: profile.semanticChromaMax * randomChroma,
    hueDegrees: normalizeHue(
      SEMANTIC_HUES.prMerged +
        jitter.prMerged * profile.semanticHueSpreadDegrees,
    ),
  };

  const primaryHex = oklchToHexInGamut(primary);

  return {
    canvas: canvasHex,
    ink,
    primary: primaryHex,
    destructive: destructive.fill,
    warning: warning.fill,
    success: success.fill,
    prMerged: oklchToHexInGamut(merged),
    fileAccent: primaryHex,
    diffAdded: success.fill,
    diffRemoved: destructive.fill,
  };
}

export interface GeneratePaletteOptions {
  accentHue: number;
  accentChroma: number;
  darkCanvasLightness: number;
  lightCanvasLightness: number;
  seed?: number;
  semanticJitter?: SemanticJitter;
  constraintLevel?: ConstraintLevel;
}

function pseudoRandom(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 4294967296;
  };
}

export function generatePalette(
  options: GeneratePaletteOptions,
): GeneratedPalette {
  const random = pseudoRandom(options.seed ?? 1);
  const hueJitter = () => (random() - 0.5) * 2;
  const profile = getConstraintProfile(options.constraintLevel ?? 1);

  const accentHue = normalizeHue(
    options.accentHue + hueJitter() * profile.accentHueSpreadDegrees,
  );
  const randomChroma = 0.55 + random() * 0.45;
  const jitter: SemanticJitter = options.semanticJitter ?? {
    destructive: hueJitter(),
    warning: hueJitter(),
    success: hueJitter(),
    prMerged: hueJitter(),
  };

  const lightLow = clamp(
    options.lightCanvasLightness - profile.lightCanvasSpread,
    0.04,
    0.995,
  );
  const lightHigh = clamp(options.lightCanvasLightness + 0.03, 0.04, 0.995);
  const darkLow = clamp(
    options.darkCanvasLightness - profile.darkCanvasSpread / 2,
    0.04,
    0.96,
  );
  const darkHigh = clamp(
    options.darkCanvasLightness + profile.darkCanvasSpread / 2,
    0.04,
    0.96,
  );

  const skew = 1 + profile.canvasModeBias * 5;
  const toward = (low: number, high: number, wantHigh: boolean): number => {
    const u = Math.pow(random(), skew);
    const value = wantHigh ? high - (high - low) * u : low + (high - low) * u;
    return Number(clamp(value, 0.04, 0.995).toFixed(4));
  };

  const lightCanvas: OklchColor = {
    lightness: toward(lightLow, lightHigh, true),
    chroma: (0.006 + random() * 0.05) * randomChroma,
    hueDegrees: random() < 0.5 ? accentHue : normalizeHue(accentHue + 180),
  };
  const darkCanvas: OklchColor = {
    lightness: toward(darkLow, darkHigh, false),
    chroma: (0.008 + random() * 0.06) * randomChroma,
    hueDegrees: random() < 0.5 ? accentHue : normalizeHue(accentHue + 180),
  };

  const lightCanvasHex = oklchToHexInGamut(lightCanvas);
  const darkCanvasHex = oklchToHexInGamut(darkCanvas);

  const lightInk = contrastSafeHex(
    {
      lightness: 0.2 + random() * 0.25,
      chroma: (0.012 + random() * 0.05) * randomChroma,
      hueDegrees: random() < 0.5 ? accentHue : normalizeHue(accentHue + 180),
    },
    hexToOklch(lightCanvasHex),
    TEXT_CONTRAST_FLOOR,
  );
  const darkInk = contrastSafeHex(
    {
      lightness: 0.7 + random() * 0.28,
      chroma: (0.008 + random() * 0.05) * randomChroma,
      hueDegrees: random() < 0.5 ? accentHue : normalizeHue(accentHue + 180),
    },
    hexToOklch(darkCanvasHex),
    TEXT_CONTRAST_FLOOR,
  );

  return {
    light: buildModeAnchors(
      lightCanvas,
      lightCanvasHex,
      lightInk,
      accentHue,
      options.accentChroma,
      jitter,
      random,
      profile,
      randomChroma,
    ),
    dark: buildModeAnchors(
      darkCanvas,
      darkCanvasHex,
      darkInk,
      accentHue,
      options.accentChroma,
      jitter,
      random,
      profile,
      randomChroma,
    ),
  };
}

export function renderPaletteCss(palette: GeneratedPalette): string {
  return `:root,
.light {
  --canvas: ${palette.light.canvas};
  --ink: ${palette.light.ink};
  --primary: ${palette.light.primary};
  --primary-foreground: ${palette.light.canvas};
  --destructive: ${palette.light.destructive};
  --destructive-text: ${palette.light.destructive};
  --warning: ${palette.light.warning};
  --warning-text: ${palette.light.warning};
  --attention: ${palette.light.warning};
  --success: ${palette.light.success};
  --diff-added: ${palette.light.diffAdded};
  --diff-removed: ${palette.light.diffRemoved};
  --pr-merged: ${palette.light.prMerged};
  --file-accent: ${palette.light.fileAccent};
  --muted-foreground: color-mix(in oklch, var(--ink) 70%, var(--canvas));
  --subtle-foreground: color-mix(in oklch, var(--ink) 58%, var(--canvas));
  --readback-foreground: color-mix(in oklch, var(--ink) 64%, var(--canvas));
}
.dark {
  --canvas: ${palette.dark.canvas};
  --ink: ${palette.dark.ink};
  --primary: ${palette.dark.primary};
  --primary-foreground: ${palette.dark.canvas};
  --destructive: ${palette.dark.destructive};
  --destructive-text: ${palette.dark.destructive};
  --warning: ${palette.dark.warning};
  --warning-text: ${palette.dark.warning};
  --attention: ${palette.dark.warning};
  --success: ${palette.dark.success};
  --diff-added: ${palette.dark.diffAdded};
  --diff-removed: ${palette.dark.diffRemoved};
  --pr-merged: ${palette.dark.prMerged};
  --file-accent: ${palette.dark.fileAccent};
  --muted-foreground: color-mix(in oklch, var(--ink) 70%, var(--canvas));
  --subtle-foreground: color-mix(in oklch, var(--ink) 58%, var(--canvas));
  --readback-foreground: color-mix(in oklch, var(--ink) 64%, var(--canvas));
}`;
}

export function paletteContrastReport(
  palette: GeneratedPalette,
): { mode: string; ratio: number }[] {
  return (["light", "dark"] as const).flatMap((mode) => {
    const anchors = palette[mode];
    return [
      { mode: `${mode} ink/canvas`, ratio: contrastRatio(hexToOklch(anchors.ink), hexToOklch(anchors.canvas)) },
      {
        mode: `${mode} primary/canvas`,
        ratio: contrastRatio(
          hexToOklch(anchors.primary),
          hexToOklch(anchors.canvas),
        ),
      },
    ];
  });
}

export { shortestHueDistance };
