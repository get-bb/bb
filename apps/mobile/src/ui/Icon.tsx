import { HugeiconsIcon } from "@hugeicons/react-native";
import type { StyleProp, ViewStyle } from "react-native";
import { useTheme } from "@/theme/ThemeProvider";
import { ICON_MAP, type IconName } from "./icon-map";

/** theme.css `--icon-stroke-width`. */
const ICON_STROKE_WIDTH = 1.75;
/** Touch base size (web `size-5` under `pointer: coarse`). */
const ICON_SIZE_DEFAULT = 20;

export interface IconProps {
  name: IconName;
  /** Pixel size; defaults to 20 (16 fits inline text and compact buttons). */
  size?: number;
  /** Any RN color string; defaults to the current `foreground` token. */
  color?: string;
  strokeWidth?: number;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}

export function Icon({
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

export { ICON_NAMES, isIconName, type IconName } from "./icon-map";
