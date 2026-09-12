import { Children, Fragment, isValidElement, type ReactNode } from "react";
import { Pressable, View } from "react-native";
import { useTheme } from "@/theme/ThemeProvider";
import { cn } from "./cn";
import { Icon, isIconName, type IconName } from "./Icon";
import {
  DisclosureChevron,
  LIST_ROW_ICON_SIZE,
  SelectedCheck,
} from "./ListRow";
import { Separator } from "./Separator";
import type { SFSymbol } from "./sf-symbol-map";
import { Text } from "./Text";

const IS_IOS = process.env.EXPO_OS === "ios";

export const GROUPED_CARD_RADIUS = 10;
export const GROUPED_ROW_PADDING_X = 16;
const GROUPED_ROW_GAP = 12;
export const ICON_BADGE_SIZE = 29;

export interface IconBadgeProps {
  icon: IconName;
  symbol?: SFSymbol;
  color: string;
}

export function IconBadge({ icon, symbol, color }: IconBadgeProps) {
  return (
    <View
      style={{
        width: ICON_BADGE_SIZE,
        height: ICON_BADGE_SIZE,
        borderRadius: 7,
        borderCurve: "continuous",
        backgroundColor: color,
        alignItems: "center",
        justifyContent: "center",
      }}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Icon name={icon} symbol={symbol} size={18} color="#ffffff" />
    </View>
  );
}

export interface GroupedRowProps {
  title: string;
  subtitle?: string;
  value?: string;
  leading?: IconName | ReactNode;
  leadingTone?: "foreground" | "primary";
  badge?: { icon: IconName; symbol?: SFSymbol; color: string };
  trailing?: "chevron" | "checkmark" | ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  destructive?: boolean;
  disabled?: boolean;
  titleLines?: number;
  testID?: string;
  accessibilityLabel?: string;
}

export function GroupedRow({
  title,
  subtitle,
  value,
  leading,
  leadingTone = "foreground",
  badge,
  trailing,
  onPress,
  onLongPress,
  destructive = false,
  disabled = false,
  titleLines = 1,
  testID,
  accessibilityLabel,
}: GroupedRowProps) {
  const { tokens } = useTheme();
  const interactive = Boolean(onPress || onLongPress);
  const titleColor = destructive ? tokens.destructiveText : tokens.foreground;
  const leadingColor = destructive
    ? tokens.destructiveText
    : leadingTone === "primary"
      ? tokens.primary
      : tokens.foreground;
  const leadingNode = badge ? (
    <IconBadge icon={badge.icon} symbol={badge.symbol} color={badge.color} />
  ) : isIconName(leading) ? (
    <Icon name={leading} size={LIST_ROW_ICON_SIZE} color={leadingColor} />
  ) : (
    leading
  );
  const trailingNode =
    trailing === "chevron" ? (
      <DisclosureChevron />
    ) : trailing === "checkmark" ? (
      <SelectedCheck />
    ) : (
      trailing
    );
  const layoutClassName = cn(
    "min-h-[44px] flex-row items-center gap-3 px-4 py-2.5",
    disabled && "opacity-50",
  );
  const content = (
    <>
      {leadingNode}
      <View className="min-w-0 flex-1">
        <Text
          variant="bodyLarge"
          numberOfLines={titleLines}
          style={{ color: titleColor }}
        >
          {title}
        </Text>
        {subtitle ? (
          <Text variant="caption" numberOfLines={3}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {value ? (
        <Text
          variant="bodyLarge"
          numberOfLines={1}
          className="max-w-[55%] shrink"
          style={{ color: tokens.mutedForeground }}
        >
          {value}
        </Text>
      ) : null}
      {trailingNode}
    </>
  );
  if (!interactive) {
    return (
      <View className={layoutClassName} testID={testID}>
        {content}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        accessibilityLabel ?? (value ? `${title}: ${value}` : undefined)
      }
      accessibilityState={{
        disabled,
        selected: trailing === "checkmark" ? true : undefined,
      }}
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

export interface GroupedSectionProps {
  title?: string;
  footer?: string | ReactNode;
  children: ReactNode;
  separatorInset?: number | "text";
  testID?: string;
}

function rowTextInset(child: ReactNode): number {
  if (!isValidElement<{ badge?: unknown; leading?: unknown }>(child)) {
    return GROUPED_ROW_PADDING_X;
  }
  if (child.props.badge) {
    return GROUPED_ROW_PADDING_X + ICON_BADGE_SIZE + GROUPED_ROW_GAP;
  }
  if (child.props.leading !== undefined && child.props.leading !== null) {
    return GROUPED_ROW_PADDING_X + LIST_ROW_ICON_SIZE + GROUPED_ROW_GAP;
  }
  return GROUPED_ROW_PADDING_X;
}

export function GroupedSection({
  title,
  footer,
  children,
  separatorInset = "text",
  testID,
}: GroupedSectionProps) {
  const { tokens } = useTheme();
  const rows = Children.toArray(children);
  return (
    <View className="gap-2" testID={testID}>
      {title ? (
        <View className="flex-row items-end justify-between gap-3 px-4">
          <Text variant="sectionLabel" numberOfLines={1} className="shrink">
            {title}
          </Text>
        </View>
      ) : null}
      <View
        className="overflow-hidden"
        style={{
          borderRadius: GROUPED_CARD_RADIUS,
          borderCurve: "continuous",
          backgroundColor: tokens.surfaceGroupedCell,
        }}
      >
        {rows.map((row, index) => (
          <Fragment key={index}>
            {index > 0 ? (
              <Separator
                inset={
                  separatorInset === "text" ? rowTextInset(row) : separatorInset
                }
              />
            ) : null}
            {row}
          </Fragment>
        ))}
      </View>
      {footer ? (
        typeof footer === "string" ? (
          <Text variant="footnote" tone="muted" className="px-4">
            {footer}
          </Text>
        ) : (
          <View className="px-4">{footer}</View>
        )
      ) : null}
    </View>
  );
}
