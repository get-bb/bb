import type { FontWeightName, FontWeightValue } from "./fonts";

/**
 * Platform font families and weights consumed by `fonts.ts`.
 *
 * This is the Android (and node / vitest) default; Metro picks
 * `font-platform.ios.ts` on iOS. Both files must export the same names with
 * compatible types — `fonts.test.ts` guards that so the iOS pick cannot drift
 * from the default. Kept free of react-native imports so the font resolver
 * stays testable in node (see vitest.config.ts).
 */

/**
 * Android's UI families per weight. Below API 28 React Native can only pick
 * the NORMAL or BOLD face of a family (`ReactFontManager.TypefaceStyle`
 * maps any `fontWeight` under 700 to NORMAL), so `medium` names the real
 * `sans-serif-medium` family instead of relying on weight synthesis; the
 * other weights stay on the generic family.
 */
export const SANS_FAMILIES: Record<FontWeightName, string | undefined> = {
  regular: "sans-serif",
  medium: "sans-serif-medium",
  semibold: "sans-serif",
  bold: "sans-serif",
};

/**
 * Numeric weights paired with the families above. `semibold` travels as 700:
 * Roboto ships no 600 face (API 28+ already snaps 600 to bold), and pre-28
 * devices would render it as regular otherwise.
 */
export const SANS_WEIGHTS: Record<FontWeightName, FontWeightValue> = {
  regular: "400",
  medium: "500",
  semibold: "700",
  bold: "700",
};

/** Android's built-in monospace family. */
export const MONO_FAMILY: string = "monospace";
