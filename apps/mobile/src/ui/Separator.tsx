import { StyleSheet, View } from "react-native";
import { useTheme } from "@/theme/ThemeProvider";
import { cn } from "./cn";

/** Left inset that lines a separator up with a row's text column (px-4). */
export const SEPARATOR_INSET = 16;

export interface SeparatorProps {
  orientation?: "horizontal" | "vertical";
  /**
   * Left inset so list separators start at the row content: `true` = the
   * row padding (16), a number = exact px (e.g. past a leading glyph).
   */
  inset?: number | boolean;
  className?: string;
}

/** One-pixel (hairline) rule in `border-hairline`. */
export function Separator({
  orientation = "horizontal",
  inset = 0,
  className,
}: SeparatorProps) {
  const { tokens } = useTheme();
  const insetPx =
    inset === true ? SEPARATOR_INSET : inset === false ? 0 : inset;
  const horizontal = orientation === "horizontal";
  return (
    <View
      accessibilityElementsHidden
      className={cn("shrink-0", horizontal ? "w-full" : "h-full", className)}
      style={[
        { backgroundColor: tokens.borderHairline },
        horizontal
          ? { height: StyleSheet.hairlineWidth }
          : { width: StyleSheet.hairlineWidth },
        horizontal && insetPx ? { marginLeft: insetPx } : null,
      ]}
    />
  );
}
