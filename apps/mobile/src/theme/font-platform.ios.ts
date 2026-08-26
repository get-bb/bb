import type { FontWeightName, FontWeightValue } from "./fonts";

/**
 * iOS font families and weights consumed by `fonts.ts` (Metro picks this
 * file over `font-platform.ts` on iOS; keep the exports identical).
 */

/**
 * Leaving `fontFamily` unset selects the system font (SF Pro), which keeps
 * Dynamic Type metrics and switches Text/Display optical sizes at 20pt.
 * Weight and italics come from `fontWeight` / `fontStyle`.
 */
export const SANS_FAMILIES: Record<FontWeightName, string | undefined> = {
  regular: undefined,
  medium: undefined,
  semibold: undefined,
  bold: undefined,
};

/** SF Pro ships every weight, so each name maps to its exact value. */
export const SANS_WEIGHTS: Record<FontWeightName, FontWeightValue> = {
  regular: "400",
  medium: "500",
  semibold: "600",
  bold: "700",
};

/**
 * Menlo is the monospace face third-party apps can address by name (SF Mono
 * is not). Its 0.6em advance is what `DiffHunkView` sizes gutters with. It
 * ships Regular/Bold (+ italics) only, so 500/600 snap to the nearest face.
 */
export const MONO_FAMILY: string = "Menlo";
