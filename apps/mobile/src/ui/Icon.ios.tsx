import { Image } from "expo-image";
import { useTheme } from "@/theme/ThemeProvider";
import { HugeIcon, ICON_SIZE_DEFAULT, type IconProps } from "./HugeIcon";
import {
  SF_SYMBOL_WEIGHT,
  SF_SYMBOL_WEIGHTS,
  sfSymbolFor,
} from "./sf-symbol-map";

/**
 * iOS icon: the SF Symbol mapped to `name` through expo-image's `sf:` source
 * (`tintColor` must stay a string token, never `Color.ios.*`), or the
 * Hugeicons glyph for names without a symbol (brand marks). Metro resolves
 * `./Icon` to this file on iOS; `Icon.tsx` is the Android / default sibling.
 */
export function Icon({
  name,
  size = ICON_SIZE_DEFAULT,
  color,
  strokeWidth,
  weight = SF_SYMBOL_WEIGHT,
  symbol: symbolOverride,
  effect,
  style,
  accessibilityLabel,
}: IconProps) {
  const { tokens } = useTheme();
  const symbol = symbolOverride ?? sfSymbolFor(name);
  if (symbol === undefined) {
    return (
      <HugeIcon
        name={name}
        size={size}
        color={color}
        strokeWidth={strokeWidth}
        style={style}
        accessibilityLabel={accessibilityLabel}
      />
    );
  }
  return (
    <Image
      source={`sf:${symbol}`}
      tintColor={color ?? tokens.foreground}
      // The symbol is laid out in a `size` square; `fontSize` is its point
      // size and `fontWeight` its symbol weight (expo-image reads both from
      // the style). Wide symbols shrink to fit rather than crop.
      contentFit="contain"
      sfEffect={effect}
      style={[
        {
          width: size,
          height: size,
          fontSize: size,
          fontWeight: SF_SYMBOL_WEIGHTS[weight],
        },
        style,
      ]}
      accessible={accessibilityLabel !== undefined}
      accessibilityLabel={accessibilityLabel}
      accessibilityElementsHidden={accessibilityLabel === undefined}
      importantForAccessibility={
        accessibilityLabel === undefined ? "no-hide-descendants" : "auto"
      }
    />
  );
}

export { HugeIcon, type IconProps } from "./HugeIcon";
export { ICON_NAMES, isIconName, type IconName } from "./icon-map";
