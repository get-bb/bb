import type { SFSymbolEffect } from "expo-image";
import { HugeiconsIcon } from "@hugeicons/react-native";
import type { ImageStyle, StyleProp, ViewStyle } from "react-native";
import { useTheme } from "@/theme/ThemeProvider";
import { ICON_MAP, type IconName } from "./icon-map";
import type { SFSymbol, SFSymbolWeight } from "./sf-symbol-map";

/** theme.css `--icon-stroke-width`. */
export const ICON_STROKE_WIDTH = 1.75;
/** Touch base size (web `size-5` under `pointer: coarse`). */
export const ICON_SIZE_DEFAULT = 20;

/**
 * Layout/transform/opacity styles both renderers accept: the Hugeicons svg
 * takes a `ViewStyle`, the expo-image symbol an `ImageStyle` (no
 * `overflow: "scroll"`).
 */
export type IconStyle = ViewStyle & ImageStyle;

export interface IconProps {
  name: IconName;
  /** Pixel size; defaults to 20 (16 fits inline text and compact buttons). */
  size?: number;
  /** Any RN color string; defaults to the current `foreground` token. */
  color?: string;
  /** Hugeicons stroke width (Android, and unmapped names on iOS). */
  strokeWidth?: number;
  /**
   * SF Symbol weight (iOS, mapped names only); defaults to medium. The
   * Hugeicons renderer has a fixed stroke and ignores it.
   */
  weight?: SFSymbolWeight;
  /**
   * iOS only: render this exact symbol instead of the map's outline variant
   * (`arrow.up.circle.fill`, `paperplane.fill`). `name` stays the Android
   * glyph and the accessibility vocabulary.
   */
  symbol?: SFSymbol;
  /** iOS 17+ only: an expo-image symbol effect (`"pulse"`, `{ effect, repeat }`). */
  effect?: SFSymbolEffect;
  style?: StyleProp<IconStyle>;
  accessibilityLabel?: string;
}

/**
 * The Hugeicons renderer. `Icon.tsx` (Android / default) is this component;
 * `Icon.ios.tsx` renders SF Symbols for mapped names and falls back to it.
 * It lives in its own module because a `./Icon` import from inside
 * `Icon.ios.tsx` resolves to `Icon.ios.tsx` itself under Metro's platform
 * resolution.
 */
export function HugeIcon({
  name,
  size = ICON_SIZE_DEFAULT,
  color,
  strokeWidth = ICON_STROKE_WIDTH,
  style,
  accessibilityLabel,
}: IconProps) {
  const { tokens } = useTheme();
  return (
    <HugeiconsIcon
      icon={ICON_MAP[name]}
      size={size}
      color={color ?? tokens.foreground}
      strokeWidth={strokeWidth}
      style={style}
      accessible={accessibilityLabel !== undefined}
      accessibilityLabel={accessibilityLabel}
      accessibilityElementsHidden={accessibilityLabel === undefined}
      importantForAccessibility={
        accessibilityLabel === undefined ? "no-hide-descendants" : "auto"
      }
    />
  );
}
