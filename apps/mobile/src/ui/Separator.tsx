import { StyleSheet, View } from "react-native";
import { useTheme } from "@/theme/ThemeProvider";

export const SEPARATOR_INSET = 16;

export interface SeparatorProps {
  inset: number;
}

export function Separator({ inset }: SeparatorProps) {
  const { tokens } = useTheme();
  return (
    <View
      accessibilityElementsHidden
      className="shrink-0 w-full"
      style={[
        { backgroundColor: tokens.borderHairline },
        { height: StyleSheet.hairlineWidth },
        inset ? { marginLeft: inset } : null,
      ]}
    />
  );
}
