import type { ReactNode } from "react";
import { Pressable, View } from "react-native";
import { useTheme } from "@/theme/ThemeProvider";
import { cn } from "./cn";
import { Icon, isIconName, type IconName } from "./Icon";
import { Text } from "./Text";

const IS_IOS = process.env.EXPO_OS === "ios";

/** Disclosure chevron: 14pt semibold SF glyph on iOS, 18px Hugeicons stroke elsewhere. */
export const LIST_ROW_CHEVRON_SIZE = IS_IOS ? 14 : 18;
/** Leading glyph size in rows. */
export const LIST_ROW_ICON_SIZE = 20;

export interface ListRowProps {
  title: string;
  subtitle?: string;
  /** An icon name renders a 20px glyph; any node renders as-is. */
  leading?: IconName | ReactNode;
  /** Color of a `leading` icon name: the label color (default) or the tint. */
  leadingTone?: "foreground" | "primary";
  /**
   * `"chevron"` renders the disclosure glyph; any node renders as-is. When
   * omitted (or null) a `selected` row shows a tinted check mark instead.
   */
  trailing?: "chevron" | ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  /** Current choice in a single-select list: trailing check mark in `primary`. */
  selected?: boolean;
  destructive?: boolean;
  disabled?: boolean;
  /** Lines before the title truncates (default 1). */
  titleLines?: number;
  className?: string;
  accessibilityLabel?: string;
  testID?: string;
}

/** Trailing check mark for the selected row of a single-choice list. */
export function SelectedCheck() {
  const { tokens } = useTheme();
  return (
    <Icon name="Check" size={18} weight="semibold" color={tokens.primary} />
  );
}

/** Disclosure chevron for rows that push a screen or open a sheet. */
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

/**
 * Touch list row (min 44pt): leading glyph, 17pt title / 15pt secondary
 * subtitle, trailing slot. Pressing fills the row with `state-active`
 * (system highlight); `selected` is shown as a check mark, not a fill, so
 * picker rows read like iOS table cells. Long-press is where the Android
 * context menu lives (iOS rows get native menus from their screens).
 */
export function ListRow({
  title,
  subtitle,
  leading,
  leadingTone = "foreground",
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
  const leadingColor = destructive
    ? tokens.destructiveText
    : leadingTone === "primary"
      ? tokens.primary
      : tokens.foreground;
  const trailingNode =
    trailing === "chevron" ? (
      <DisclosureChevron />
    ) : trailing === undefined || trailing === null ? (
      selected ? (
        <SelectedCheck />
      ) : null
    ) : (
      trailing
    );
  const layoutClassName = cn(
    "min-h-[44px] flex-row items-center gap-3 px-4 py-2",
    disabled && "opacity-50",
    className,
  );
  const content = (
    <>
      {isIconName(leading) ? (
        <Icon name={leading} size={LIST_ROW_ICON_SIZE} color={leadingColor} />
      ) : (
        leading
      )}
      <View className="min-w-0 flex-1">
        <Text
          variant="bodyLarge"
          numberOfLines={titleLines}
          style={{ color: titleColor }}
        >
          {title}
        </Text>
        {subtitle ? (
          <Text variant="body" tone="muted" numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {trailingNode}
    </>
  );
  if (!interactive) {
    // A static row is a plain container so a control in `trailing` keeps its
    // own accessibility element (a `Pressable` is `accessible` by default and
    // would fold it into one dimmed "button"; see GroupedRow).
    return (
      <View className={layoutClassName} testID={testID}>
        {content}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled, selected }}
      disabled={disabled}
      onPress={onPress}
      onLongPress={onLongPress}
      testID={testID}
      className={cn(
        layoutClassName,
        IS_IOS ? "active:bg-state-active" : "active:bg-state-hover",
      )}
    >
      {content}
    </Pressable>
  );
}
