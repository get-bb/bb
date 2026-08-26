import { useHeaderHeight } from "expo-router/react-navigation";
import { StyleSheet, View } from "react-native";
import { GlassSurface } from "@/ui";

/**
 * Liquid Glass backing for an inline-title bar. The native stack renders it
 * as the header background: a view sized to the bar (status bar included)
 * behind a transparent `UINavigationBar`, so the timeline refracts through
 * the same glass the composer uses instead of a flat blur material.
 *
 * The glass is oversized and clipped so only its bottom edge is visible:
 * the other rims would draw bright lines along the screen edges. The clip
 * takes the bar height from the stack's context explicitly — an absolute
 * fill inside the stack's background view lays out at zero height. Inline
 * bars only: on large-title screens the stack debounces the bar height, so
 * a glass sheet there would lag the title collapse.
 */
export function HeaderGlass() {
  const height = useHeaderHeight();
  return (
    <View style={[styles.clip, { height }]} pointerEvents="none">
      <GlassSurface style={styles.glass} />
    </View>
  );
}

const RIM_BLEED = 24;

const styles = StyleSheet.create({
  clip: { width: "100%", overflow: "hidden" },
  glass: {
    position: "absolute",
    top: -RIM_BLEED,
    left: -RIM_BLEED,
    right: -RIM_BLEED,
    bottom: 0,
  },
});
