/**
 * Diff surface colors derived from the theme tokens. The generated palette
 * only carries the `diffAdded` / `diffRemoved` foreground anchors (the web
 * lets @pierre/diffs tint its rows from those), so line and gutter
 * backgrounds are those anchors at low alpha over the card background. Pure
 * TypeScript, vitest-tested.
 */
import type { NativeThemeTokens } from "@/theme/theme.native";

const HEX_PATTERN = /^#([0-9a-f]{3,8})$/iu;
const RGB_PATTERN = /^rgba?\(\s*([^)]+)\)$/iu;

/**
 * Returns `color` with its alpha replaced by `alpha` (0–1). Understands
 * `#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb()`, and `rgba()` (comma or space
 * separated); any other string comes back unchanged.
 */
export function withAlpha(color: string, alpha: number): string {
  const clamped = Math.min(1, Math.max(0, alpha));
  const hex = HEX_PATTERN.exec(color.trim());
  if (hex) {
    let digits = hex[1]!;
    if (digits.length === 3 || digits.length === 4) {
      digits = digits
        .slice(0, 3)
        .split("")
        .map((d) => d + d)
        .join("");
    }
    if (digits.length === 8) digits = digits.slice(0, 6);
    if (digits.length !== 6) return color;
    const r = Number.parseInt(digits.slice(0, 2), 16);
    const g = Number.parseInt(digits.slice(2, 4), 16);
    const b = Number.parseInt(digits.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${clamped})`;
  }
  const rgb = RGB_PATTERN.exec(color.trim());
  if (rgb) {
    const parts = rgb[1]!
      .split(/[\s,/]+/u)
      .filter((part) => part.length > 0)
      .slice(0, 3);
    if (parts.length === 3) {
      return `rgba(${parts[0]}, ${parts[1]}, ${parts[2]}, ${clamped})`;
    }
  }
  return color;
}

export interface DiffPalette {
  addedLineBg: string;
  addedGutterBg: string;
  addedMarker: string;
  removedLineBg: string;
  removedGutterBg: string;
  removedMarker: string;
  hunkHeaderBg: string;
  hunkHeaderFg: string;
  gutterBg: string;
  gutterFg: string;
  lineFg: string;
  metaFg: string;
  border: string;
  cardBg: string;
}

export function buildDiffPalette(tokens: NativeThemeTokens): DiffPalette {
  return {
    addedLineBg: withAlpha(tokens.diffAdded, 0.14),
    addedGutterBg: withAlpha(tokens.diffAdded, 0.26),
    addedMarker: tokens.diffAdded,
    removedLineBg: withAlpha(tokens.diffRemoved, 0.14),
    removedGutterBg: withAlpha(tokens.diffRemoved, 0.26),
    removedMarker: tokens.diffRemoved,
    hunkHeaderBg: tokens.surfaceRecessed,
    hunkHeaderFg: tokens.mutedForeground,
    gutterBg: tokens.surfaceRaised,
    gutterFg: tokens.subtleForeground,
    lineFg: tokens.foreground,
    metaFg: tokens.mutedForeground,
    border: tokens.border,
    cardBg: tokens.background,
  };
}
