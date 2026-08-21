import { View } from "react-native";
import { cn } from "./cn";

export interface SeparatorProps {
  orientation?: "horizontal" | "vertical";
  /** Left inset in px for list separators that align with row content. */
  inset?: number;
  className?: string;
}

export function Separator({
  orientation = "horizontal",
  inset = 0,
  className,
}: SeparatorProps) {
  return (
    <View
      accessibilityElementsHidden
      className={cn(
        "shrink-0 bg-border",
        orientation === "horizontal" ? "h-px w-full" : "h-full w-px",
        className,
      )}
      style={
        inset && orientation === "horizontal"
          ? { marginLeft: inset }
          : undefined
      }
    />
  );
}
