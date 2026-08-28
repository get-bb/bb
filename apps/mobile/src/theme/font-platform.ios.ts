import type { FontWeightName, FontWeightValue } from "./fonts";

export const SANS_FAMILIES = {
  regular: undefined,
  medium: undefined,
  semibold: undefined,
  bold: undefined,
} satisfies Record<FontWeightName, string | undefined>;

export const SANS_WEIGHTS = {
  regular: "400",
  medium: "500",
  semibold: "600",
  bold: "700",
} satisfies Record<FontWeightName, FontWeightValue>;

export const MONO_FAMILY: string = "Menlo";
