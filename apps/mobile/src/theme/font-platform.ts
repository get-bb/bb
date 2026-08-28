import type { FontWeightName, FontWeightValue } from "./fonts";

export const SANS_FAMILIES = {
  regular: "sans-serif",
  medium: "sans-serif-medium",
  semibold: "sans-serif",
  bold: "sans-serif",
} satisfies Record<FontWeightName, string | undefined>;

export const SANS_WEIGHTS = {
  regular: "400",
  medium: "500",
  semibold: "700",
  bold: "700",
} satisfies Record<FontWeightName, FontWeightValue>;

export const MONO_FAMILY: string = "monospace";
