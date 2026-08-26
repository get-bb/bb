import Animated from "react-native-reanimated";
import type { GlassSurfaceProps } from "./glass-surface-types";

/**
 * Whether the running OS renders Liquid Glass (iOS 26+ with the
 * `UIGlassEffect` API present). Always `false` here; `GlassSurface.ios.tsx`
 * answers for iOS. Hosts branch on it to float a glass bar over scrolling
 * content instead of docking an opaque one under it.
 */
export function useLiquidGlass(): boolean {
  return false;
}

/**
 * Android / default: a plain surface with the fallback fill and border
 * (`GlassSurface.ios.tsx` renders expo-glass-effect's `GlassView` on iOS 26+).
 * The `layout` transition still applies so a host animates the same way on
 * every platform.
 */
export function GlassSurface({
  style,
  fallbackStyle,
  glassStyle: _glassStyle,
  tintColor: _tintColor,
  interactive: _interactive,
  layout,
  children,
  ...rest
}: GlassSurfaceProps) {
  return (
    <Animated.View layout={layout} style={[style, fallbackStyle]} {...rest}>
      {children}
    </Animated.View>
  );
}

export type {
  GlassSurfaceLayout,
  GlassSurfaceProps,
} from "./glass-surface-types";
