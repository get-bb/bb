import {
  GlassView,
  isGlassEffectAPIAvailable,
  isLiquidGlassAvailable,
} from "expo-glass-effect";
import Animated from "react-native-reanimated";
import type { GlassSurfaceProps } from "./glass-surface-types";

/**
 * The glass view is the animated node itself (not a child of one): a
 * Reanimated layout transition animates the frame of the view it is set on
 * while that view's children snap to their final layout, so glass nested
 * under an animating wrapper would jump to its final size and poke out of
 * the growing (or shrinking) wrapper.
 */
const AnimatedGlassView = Animated.createAnimatedComponent(GlassView);

let liquidGlass: boolean | null = null;

/**
 * iOS 26+ with the `UIGlassEffect` API actually present (some 26 betas
 * advertise Liquid Glass but crash on the effect initialiser — expo's
 * `isGlassEffectAPIAvailable` covers that). Resolved once: the answer
 * cannot change while the app runs.
 */
export function useLiquidGlass(): boolean {
  if (liquidGlass === null) {
    liquidGlass = isLiquidGlassAvailable() && isGlassEffectAPIAvailable();
  }
  return liquidGlass;
}

/**
 * iOS: Liquid Glass when the OS renders it — expo-glass-effect's `GlassView`
 * with `style`'s radius and continuous corners shaping the effect and the
 * children mounted inside it (the native view puts them in the effect's
 * content view). Without Liquid Glass the surface is the same view the
 * default module renders: `style` plus `fallbackStyle`.
 */
export function GlassSurface({
  style,
  fallbackStyle,
  glassStyle = "regular",
  tintColor,
  interactive = false,
  layout,
  children,
  ...rest
}: GlassSurfaceProps) {
  if (!useLiquidGlass()) {
    return (
      <Animated.View layout={layout} style={[style, fallbackStyle]} {...rest}>
        {children}
      </Animated.View>
    );
  }
  return (
    <AnimatedGlassView
      layout={layout}
      glassEffectStyle={glassStyle}
      tintColor={tintColor}
      isInteractive={interactive}
      style={style}
      {...rest}
    >
      {children}
    </AnimatedGlassView>
  );
}

export type {
  GlassSurfaceLayout,
  GlassSurfaceProps,
} from "./glass-surface-types";
