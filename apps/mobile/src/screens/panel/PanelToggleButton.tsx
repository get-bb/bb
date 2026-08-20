import { Pressable } from "react-native";
import { useTheme } from "@/theme";
import { cn, Icon } from "@/ui";

export interface PanelToggleButtonProps {
  onPress: () => void;
  /** Panel is presented (the glyph reads as selected). */
  active: boolean;
  disabled?: boolean;
  testID?: string;
}

/**
 * The header button that opens the workspace panel — the web's compact
 * toggle (PanelBottom glyph; the panel slides up from the bottom).
 */
export function PanelToggleButton({
  onPress,
  active,
  disabled = false,
  testID = "thread-panel-button",
}: PanelToggleButtonProps) {
  const { tokens } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Workspace panel"
      accessibilityState={{ selected: active, disabled }}
      onPress={onPress}
      disabled={disabled}
      hitSlop={6}
      className={cn(
        "h-8 w-8 items-center justify-center rounded-md active:bg-state-hover",
        active && "bg-surface-selected",
        disabled && "opacity-40",
      )}
      testID={testID}
    >
      <Icon name="PanelBottom" size={18} color={tokens.foreground} />
    </Pressable>
  );
}
