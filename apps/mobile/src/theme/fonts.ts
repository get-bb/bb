import { MONO_FAMILY, SANS_FAMILIES, SANS_WEIGHTS } from "./font-platform";

/**
 * Font family tokens. The app renders in the platform's own faces: the system
 * font on iOS (SF Pro, selected by leaving `fontFamily` unset so UIKit keeps
 * its metrics and optical sizes), `sans-serif` on Android, and Menlo /
 * `monospace` for code. Weight always travels as a numeric `fontWeight` next
 * to the family, so one `(kind, weight)` pair renders correctly on both
 * platforms (Android names the `sans-serif-medium` family for 500 and sends
 * 600 as 700, since pre-API-28 devices cannot pick other weights).
 *
 * The per-platform families and weights live in `font-platform.ts`
 * (Android / node default) and `font-platform.ios.ts` (picked by Metro on
 * iOS). `global.css` only keeps the `font-sans` / `font-mono` class names
 * resolvable; `<Text>` (src/ui/Text.tsx) re-resolves the family through
 * `resolveFont` as an inline style, and that is what renders.
 */
export type FontFamilyKind = "sans" | "mono";
export type FontWeightName = "regular" | "medium" | "semibold" | "bold";
export type FontWeightValue = "400" | "500" | "600" | "700";

export interface FontFamilies {
  /** `undefined` means the platform UI font (SF Pro on iOS). */
  sans: Record<FontWeightName, string | undefined>;
  /** Always a concrete family name: consumers size gutters from it. */
  mono: Record<FontWeightName, string>;
}

export const FONT_FAMILIES: FontFamilies = {
  sans: SANS_FAMILIES,
  mono: {
    regular: MONO_FAMILY,
    medium: MONO_FAMILY,
    semibold: MONO_FAMILY,
    bold: MONO_FAMILY,
  },
};

/** Numeric weight to pair with the family so iOS/Android never fake-bold. */
export const FONT_WEIGHT_VALUES: Record<FontWeightName, FontWeightValue> =
  SANS_WEIGHTS;

const CLASS_WEIGHTS: readonly { token: string; weight: FontWeightName }[] = [
  { token: "font-bold", weight: "bold" },
  { token: "font-semibold", weight: "semibold" },
  { token: "font-medium", weight: "medium" },
  { token: "font-normal", weight: "regular" },
];

/**
 * Spreadable RN `TextStyle` subset. `fontFamily` is present but `undefined`
 * for the iOS system font; the explicit key still overrides a family set by a
 * `font-sans` class when the style array is flattened.
 */
export interface ResolvedFont {
  fontFamily?: string;
  fontWeight: FontWeightValue;
  /** Only set by `resolveItalicFont`; system faces ship their own italics. */
  fontStyle?: "italic";
}

/** Italic sans at `weight` (markdown emphasis, thinking text). */
export function resolveItalicFont(weight: FontWeightName): ResolvedFont {
  return {
    fontFamily: FONT_FAMILIES.sans[weight],
    fontWeight: FONT_WEIGHT_VALUES[weight],
    fontStyle: "italic",
  };
}

/**
 * Picks the concrete font for a Text. Explicit props win; otherwise the
 * web-style utility classes (`font-medium`, `font-mono`, …) in `className`
 * decide, so class strings ported from the web app select the right family
 * and weight on both platforms.
 */
export function resolveFont(options: {
  className?: string;
  weight?: FontWeightName;
  mono?: boolean;
}): ResolvedFont {
  const tokens = options.className ? options.className.split(/\s+/) : [];
  const has = (token: string) => tokens.includes(token);
  const mono = options.mono ?? (has("font-mono") && !has("font-sans"));
  const kind: FontFamilyKind = mono ? "mono" : "sans";
  const weight =
    options.weight ??
    CLASS_WEIGHTS.find((entry) => has(entry.token))?.weight ??
    "regular";
  return {
    fontFamily: FONT_FAMILIES[kind][weight],
    fontWeight: FONT_WEIGHT_VALUES[weight],
  };
}
