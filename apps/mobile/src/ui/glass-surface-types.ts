import type { ComponentProps } from "react";
import type { StyleProp, ViewProps, ViewStyle } from "react-native";
import type Animated from "react-native-reanimated";

/** A Reanimated layout transition (`LinearTransition`, …) for the surface. */
export type GlassSurfaceLayout = ComponentProps<typeof Animated.View>["layout"];

export interface GlassSurfaceProps extends ViewProps {
  /**
   * Applied in every mode: the shape (`borderRadius`, `borderCurve`) and the
   * content padding. With Liquid Glass the radius shapes the glass itself.
   * Keep margins on a wrapper: the glass must reach the surface's edges.
   */
  style?: StyleProp<ViewStyle>;
  /**
   * The fill and border the surface shows when Liquid Glass is unavailable
   * (older iOS, Android, reduce-transparency fallbacks). Never applied to
   * glass, which must stay transparent to refract the content under it.
   */
  fallbackStyle?: StyleProp<ViewStyle>;
  /** `regular` (the default material) or `clear` (for media-heavy backdrops). */
  glassStyle?: "regular" | "clear";
  /** A tint mixed into the glass (a token string). */
  tintColor?: string;
  /**
   * Whether the glass reacts to touches (the iOS 26 button highlight and
   * scale). Off by default: a surface that hosts a text field should not
   * wobble under caret taps.
   */
  interactive?: boolean;
  /** Layout transition for size changes (a pill growing into a card). */
  layout?: GlassSurfaceLayout;
}
