import type { ReactNode } from "react";
import { Pressable, View } from "react-native";
import { useTheme } from "@/theme/ThemeProvider";
import { cn } from "./cn";
import { Icon, isIconName, type IconName } from "./Icon";
import { Text } from "./Text";

export interface ListRowProps {
  title: string;
  subtitle?: string;
  /** An icon name renders a 20px glyph; any node renders as-is. */
  leading?: IconName | ReactNode;
  /** `"chevron"` renders the disclosure glyph; any node renders as-is. */
  trailing?: "chevron" | ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  selected?: boolean;
  destructive?: boolean;
  disabled?: boolean;
  /** Lines before the title truncates (default 1). */
  titleLines?: number;
  className?: string;
  accessibilityLabel?: string;
  testID?: string;
}

/**
 * Touch list row (min 44px): leading glyph, title/subtitle, trailing slot.
 * Pressed and selected states use the web `state-hover` / `surface-selected`
 * fills. Long-press is where context menus live on mobile.
 */
export function ListRow({
  title,
  subtitle,
  leading,
  trailing,
  onPress,
  onLongPress,
  selected = false,
  destructive = false,
  disabled = false,
  titleLines = 1,
  className,
  accessibilityLabel,
  testID,
}: ListRowProps) {
  const { tokens } = useTheme();
  const interactive = Boolean(onPress || onLongPress);
  const titleColor = destructive ? tokens.destructiveText : tokens.foreground;
  return (
    <Pressable
      accessibilityRole={interactive ? "button" : undefined}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled, selected }}
      disabled={disabled || !interactive}
      onPress={onPress}
      onLongPress={onLongPress}
      testID={testID}
      className={cn(
        "min-h-[44px] flex-row items-center gap-3 px-4 py-2",
        interactive && "active:bg-state-hover",
        selected && "bg-surface-selected",
        disabled && "opacity-50",
        className,
      )}
    >
      {isIconName(leading) ? (
        <Icon name={leading} size={20} color={titleColor} />
      ) : (
        leading
      )}
      <View className="min-w-0 flex-1">
        <Text
          variant="body"
          numberOfLines={titleLines}
          style={{ color: titleColor }}
        >
          {title}
        </Text>
        {subtitle ? (
          <Text variant="caption" numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {trailing === "chevron" ? (
        <Icon name="ChevronRight" size={18} color={tokens.subtleForeground} />
      ) : (
        trailing
      )}
    </Pressable>
  );
}
