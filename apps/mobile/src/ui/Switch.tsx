import {
  Switch as RNSwitch,
  type SwitchProps as RNSwitchProps,
} from "react-native";
import { useTheme } from "@/theme/ThemeProvider";

export interface SwitchProps extends Omit<
  RNSwitchProps,
  "value" | "onValueChange" | "style"
> {
  checked: boolean;
  onCheckedChange?: (checked: boolean) => void;
  /** `sm` scales the native control down (web default is the small one). */
  size?: "default" | "sm";
  className?: string;
}

/**
 * Themed native switch: checked track = `foreground`, unchecked = `muted`,
 * thumb = `background` (packages/shared-ui switch.tsx colors).
 */
export function Switch({
  checked,
  onCheckedChange,
  size = "default",
  disabled,
  className,
  ...props
}: SwitchProps) {
  const { tokens } = useTheme();
  return (
    <RNSwitch
      value={checked}
      onValueChange={onCheckedChange}
      disabled={disabled}
      trackColor={{ false: tokens.muted, true: tokens.foreground }}
      thumbColor={tokens.background}
      ios_backgroundColor={tokens.muted}
      className={className}
      style={size === "sm" ? { transform: [{ scale: 0.8 }] } : undefined}
      {...props}
    />
  );
}
