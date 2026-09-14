import { ActivityIndicator, type ActivityIndicatorProps } from "react-native";
import { useTheme } from "@/theme/ThemeProvider";

export interface SpinnerProps {
  size?: ActivityIndicatorProps["size"];
  color?: string;
}

export function Spinner({ size = "small", color }: SpinnerProps) {
  const { tokens } = useTheme();
  return (
    <ActivityIndicator size={size} color={color ?? tokens.mutedForeground} />
  );
}
