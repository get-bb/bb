import { Stack } from "expo-router";
import type { ComponentProps } from "react";
import { useTheme } from "@/theme";

type ScreenTitleProps = ComponentProps<typeof Stack.Title>;

/**
 * `Stack.Title` in the palette ink. A bare `Stack.Title` registers an empty
 * `headerTitleStyle` that replaces the navigator's, so the native bar falls
 * back to the tint color for the title; this wrapper restores the ink and
 * the 600 weight (and the large-title ink) once, for every screen.
 */
export function ScreenTitle({ style, largeStyle, ...props }: ScreenTitleProps) {
  const { tokens } = useTheme();
  return (
    <Stack.Title
      {...props}
      style={[{ color: tokens.foreground, fontWeight: "600" }, style]}
      largeStyle={[{ color: tokens.foreground }, largeStyle]}
    />
  );
}
