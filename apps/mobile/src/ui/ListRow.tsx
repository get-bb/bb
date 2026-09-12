import type { ReactNode } from "react";
import { Pressable, View } from "react-native";
import { useTheme } from "@/theme/ThemeProvider";
import { cn } from "./cn";
import { Icon } from "./Icon";
import { Text } from "./Text";

const IS_IOS = process.env.EXPO_OS === "ios";

export const LIST_ROW_CHEVRON_SIZE = IS_IOS ? 14 : 18;
export const LIST_ROW_ICON_SIZE = 20;

export interface ListRowProps {
  title: string;
  leading?: ReactNode;
  onPress: () => void;
  destructive?: boolean;
  disabled?: boolean;
  testID?: string;
}

export function SelectedCheck() {
  const { tokens } = useTheme();
  return (
    <Icon name="Check" size={18} weight="semibold" color={tokens.primary} />
  );
}

export function DisclosureChevron() {
  const { tokens } = useTheme();
  return (
    <Icon
      name="ChevronRight"
      size={LIST_ROW_CHEVRON_SIZE}
      weight="semibold"
      color={tokens.subtleForeground}
    />
  );
}

export function ListRow({
  title,
  leading,
  onPress,
  destructive = false,
  disabled = false,
  testID,
}: ListRowProps) {
  const { tokens } = useTheme();
  const titleColor = destructive ? tokens.destructiveText : tokens.foreground;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled, selected: false }}
      disabled={disabled}
      onPress={onPress}
      testID={testID}
      className={cn(
        "min-h-[44px] flex-row items-center gap-3 px-4 py-2",
        disabled && "opacity-50",
        IS_IOS ? "active:bg-state-active" : "active:bg-state-hover",
      )}
    >
      {leading}
      <View className="min-w-0 flex-1">
        <Text
          variant="bodyLarge"
          numberOfLines={1}
          style={{ color: titleColor }}
        >
          {title}
        </Text>
      </View>
    </Pressable>
  );
}
