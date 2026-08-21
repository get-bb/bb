/**
 * Font family tokens. Expo Google Fonts register each weight under its own
 * family name, so a (family, weight) pair maps to one of these names. Keep
 * this list in sync with `useAppFonts` (which loads them) and the
 * `--font-sans-*` / `--font-mono-*` entries in `global.css`.
 */
export type FontFamilyKind = "sans" | "mono";
export type FontWeightName = "regular" | "medium" | "semibold" | "bold";

export const FONT_FAMILIES: Record<
  FontFamilyKind,
  Record<FontWeightName, string>
> = {
  sans: {
    regular: "Inter_400Regular",
    medium: "Inter_500Medium",
    semibold: "Inter_600SemiBold",
    bold: "Inter_700Bold",
  },
  mono: {
    regular: "FiraCode_400Regular",
    medium: "FiraCode_500Medium",
    semibold: "FiraCode_600SemiBold",
    bold: "FiraCode_700Bold",
  },
};

/**
 * Italic faces (markdown emphasis). Only the weights prose needs are loaded;
 * `resolveItalicFont` picks the nearest one. Kept apart from FONT_FAMILIES so
 * the (family, weight) contract above stays exhaustive for `resolveFont`.
 */
export const ITALIC_FONT_FAMILIES: Record<
  Extract<FontWeightName, "regular" | "semibold">,
  string
> = {
  regular: "Inter_400Regular_Italic",
  semibold: "Inter_600SemiBold_Italic",
};

/** Italic Inter for `weight` (regular/medium → regular italic, else semibold). */
export function resolveItalicFont(weight: FontWeightName): ResolvedFont {
  return weight === "regular" || weight === "medium"
    ? { fontFamily: ITALIC_FONT_FAMILIES.regular, fontWeight: "400" }
    : { fontFamily: ITALIC_FONT_FAMILIES.semibold, fontWeight: "600" };
}

/** Numeric weight to pair with the family so iOS/Android never fake-bold. */
export const FONT_WEIGHT_VALUES: Record<
  FontWeightName,
  "400" | "500" | "600" | "700"
> = {
  regular: "400",
  medium: "500",
  semibold: "600",
  bold: "700",
};

const CLASS_WEIGHTS: readonly { token: string; weight: FontWeightName }[] = [
  { token: "font-bold", weight: "bold" },
  { token: "font-semibold", weight: "semibold" },
  { token: "font-medium", weight: "medium" },
  { token: "font-normal", weight: "regular" },
];

export interface ResolvedFont {
  fontFamily: string;
  fontWeight: "400" | "500" | "600" | "700";
}

/**
 * Picks the concrete font for a Text. Explicit props win; otherwise the
 * web-style utility classes (`font-medium`, `font-mono`, …) in `className`
 * decide, so class strings ported from the web app select the right file
 * on both platforms (Android cannot derive a weight from a single-face
 * family, so `fontWeight` alone would render regular).
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
