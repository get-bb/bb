import {
  Switch as RNSwitch,
  type SwitchProps as RNSwitchProps,
} from "react-native";
import { useTheme } from "@/theme/ThemeProvider";

const IS_IOS = process.env.EXPO_OS === "ios";

export interface SwitchProps extends Omit<
  RNSwitchProps,
  "value" | "onValueChange" | "style"
> {
  checked: boolean;
  onCheckedChange?: (checked: boolean) => void;
  /**
   * Accepted for call-site compatibility. iOS switches have one size, so it
   * is ignored there; Android scales the control down for `sm`.
   */
  size?: "default" | "sm";
  className?: string;
}

/**
 * Native switch. iOS with the default palette is left untinted (the system
 * green track); other palettes tint the on-track with `primary` so Nord /
 * Dracula keep their accent. Android keeps the token-tinted Material look
 * (checked track = `foreground`, unchecked = `muted`, thumb = `background`).
 */
export function Switch({
  checked,
  onCheckedChange,
  size = "default",
  disabled,
  className,
  ...props
}: SwitchProps) {
  const { tokens, palette } = useTheme();
  const colors = IS_IOS
    ? palette === "default"
      ? {}
      : { trackColor: { true: tokens.primary } }
    : {
        trackColor: { false: tokens.muted, true: tokens.foreground },
        thumbColor: tokens.background,
      };
  return (
    <RNSwitch
      value={checked}
      onValueChange={onCheckedChange}
      disabled={disabled}
      {...colors}
      className={className}
      style={
        !IS_IOS && size === "sm" ? { transform: [{ scale: 0.8 }] } : undefined
      }
      {...props}
    />
  );
}
