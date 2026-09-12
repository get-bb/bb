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
}

export function Switch({
  checked,
  onCheckedChange,
  disabled,
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
      {...props}
    />
  );
}
