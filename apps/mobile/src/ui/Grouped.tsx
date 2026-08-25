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

/*
 * iOS inset-grouped list (UITableView `.insetGrouped` / SwiftUI `List`):
 * a footnote header, a rounded card of 44pt rows on the grouped-cell color
 * with hairline separators inset to the text column, and a footnote footer.
 * Screens that host these sit on `bg-surface-grouped`. Everything is token
 * driven (strings), so custom palettes keep their anchors.
 */

/** Card corner radius. */
export const GROUPED_CARD_RADIUS = 10;
/** Horizontal padding inside a row (the text column starts here with no leading). */
export const GROUPED_ROW_PADDING_X = 16;
/** Gap between a leading glyph/badge and the text column. */
const GROUPED_ROW_GAP = 12;
/** `IconBadge` default size (iOS Settings). */
export const ICON_BADGE_SIZE = 29;

export interface IconBadgeProps {
  icon: IconName;
  /** iOS only: the exact symbol to draw (a `.fill` variant); `name` stays the Android glyph. */
  symbol?: SFSymbol;
  /** Badge fill: a theme token or a fixed brand color string. */
  color: string;
  /** Square size; the corner radius and glyph scale with it (default 29). */
  size?: number;
  /** Glyph color; white like iOS Settings unless the fill needs otherwise. */
  glyphColor?: string;
  accessibilityLabel?: string;
}

/** Tinted rounded square with a white glyph, the iOS Settings row badge. */
export function IconBadge({
  icon,
  symbol,
  color,
  size = ICON_BADGE_SIZE,
  glyphColor = "#ffffff",
  accessibilityLabel,
}: IconBadgeProps) {
  const scale = size / ICON_BADGE_SIZE;
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(7 * scale),
        borderCurve: "continuous",
        backgroundColor: color,
        alignItems: "center",
        justifyContent: "center",
      }}
      accessibilityElementsHidden={accessibilityLabel === undefined}
      importantForAccessibility={
        accessibilityLabel === undefined ? "no-hide-descendants" : "auto"
      }
      accessibilityLabel={accessibilityLabel}
    >
      <Icon
        name={icon}
        symbol={symbol}
        size={Math.round(18 * scale)}
        color={glyphColor}
        accessibilityLabel={accessibilityLabel}
      />
    </View>
  );
}

export interface GroupedRowProps {
  title: string;
  /** Secondary line under the title (footnote, muted). */
  subtitle?: string;
  /** Right-aligned current value (17pt, muted), before the trailing slot. */
  value?: string;
  /** Paints `value` in the warning / destructive text color (offline, fallback). */
  valueTone?: "default" | "warning" | "destructive";
  /** An icon name renders a 20px glyph; any node renders as-is. */
  leading?: IconName | ReactNode;
  /** Color of a `leading` icon name: the label color (default) or the tint. */
  leadingTone?: "foreground" | "primary";
  /** Tinted square badge (iOS Settings); wins over `leading`. `symbol` is the iOS `.fill` variant. */
  badge?: { icon: IconName; symbol?: SFSymbol; color: string };
  /**
   * `"chevron"` = disclosure (pushes a screen / opens a picker);
   * `"checkmark"` = current choice; any node (a `Switch`) renders as-is.
   */
  trailing?: "chevron" | "checkmark" | ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  destructive?: boolean;
  disabled?: boolean;
  /** Lets the user select/copy the title and value (data rows). */
  selectable?: boolean;
  /** Lines before the title truncates (default 1). */
  titleLines?: number;
  className?: string;
  testID?: string;
  accessibilityLabel?: string;
  accessibilityHint?: string;
}

/**
 * One inset-grouped cell: 44pt min, 17pt label, optional value + trailing
 * glyph; pressing highlights with `state-active`. Without `onPress` /
 * `onLongPress` the row is a plain `View`, so a control in `trailing` keeps
 * its own accessibility element. Put it (or a wrapper that forwards
 * `leading`/`badge`) inside `GroupedSection`, which draws the separators.
 */
export function GroupedRow({
  title,
  subtitle,
  value,
  valueTone = "default",
  leading,
  leadingTone = "foreground",
  badge,
  trailing,
  onPress,
  onLongPress,
  destructive = false,
  disabled = false,
  selectable = false,
  titleLines = 1,
  className,
  testID,
  accessibilityLabel,
  accessibilityHint,
}: GroupedRowProps) {
  const { tokens } = useTheme();
  const interactive = Boolean(onPress || onLongPress);
  const titleColor = destructive ? tokens.destructiveText : tokens.foreground;
  const valueColor =
    valueTone === "warning"
      ? tokens.warningText
      : valueTone === "destructive"
        ? tokens.destructiveText
        : tokens.mutedForeground;
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
    className,
  );
  const content = (
    <>
      {leadingNode}
      <View className="min-w-0 flex-1">
        <Text
          variant="bodyLarge"
          numberOfLines={titleLines}
          selectable={selectable}
          style={{ color: titleColor }}
        >
          {title}
        </Text>
        {subtitle ? (
          <Text variant="caption" numberOfLines={3} selectable={selectable}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {value ? (
        <Text
          variant="bodyLarge"
          numberOfLines={1}
          selectable={selectable}
          className="max-w-[55%] shrink"
          style={{ color: valueColor }}
        >
          {value}
        </Text>
      ) : null}
      {trailingNode}
    </>
  );
  if (!interactive) {
    // A static row (a label beside a Switch / Button, a data row) is a plain
    // container so its texts and its control stay separate accessibility
    // elements. A `Pressable` is `accessible` by default: it would fold the
    // row into one dimmed "button" that hides the control from VoiceOver
    // and from Maestro (the Switch's `testID` becomes unreachable).
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
      accessibilityHint={accessibilityHint}
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
  /** Footnote header above the card (sentence case on iOS). */
  title?: string;
  /** Footnote below the card (help copy, warnings as a node with a tone). */
  footer?: string | ReactNode;
  /** Right-hand slot on the header line (a refresh button, a picker). */
  action?: ReactNode;
  /** Rows. Arrays are fine; do not wrap rows in a Fragment (separators go between direct children). */
  children: ReactNode;
  /**
   * Separator inset: `"text"` (default) lines separators up with each
   * row's text column (past a `leading` glyph or `badge`); a number is an
   * exact px inset for rows with custom leading content.
   */
  separatorInset?: number | "text";
  /**
   * What the card sits on. `"grouped"` (default): the grouped page color,
   * cells take `surface-grouped-cell`. `"raised"`: a raised solid host — a
   * sheet, the workspace panel — whose dark color coincides with the grouped
   * cell (#1c1c1c): cells then take the translucent raised twin in dark mode
   * and the grouped cell color in light, where it still lifts off the host.
   */
  surface?: GroupedSurface;
  /** Rendered below the header line, above the card (legacy descriptions). */
  description?: string;
  className?: string;
  testID?: string;
}

export type GroupedSurface = "grouped" | "raised";

/** Where the text column of a row starts, read off its `leading`/`badge` props. */
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

/**
 * The inset card: header, rows separated by hairlines inset to the text
 * column, footer. `null`/`false` children are skipped, so conditional rows
 * need no wrapper.
 */
export function GroupedSection({
  title,
  footer,
  action,
  children,
  separatorInset = "text",
  surface = "grouped",
  description,
  className,
  testID,
}: GroupedSectionProps) {
  const { tokens, mode } = useTheme();
  const cardColor =
    surface === "raised" && mode === "dark"
      ? tokens.surfaceRaised
      : tokens.surfaceGroupedCell;
  // `toArray` drops null/boolean children and keys the rest.
  const rows = Children.toArray(children);
  return (
    <View className={cn("gap-2", className)} testID={testID}>
      {title || action ? (
        <View className="flex-row items-end justify-between gap-3 px-4">
          {title ? (
            <Text variant="sectionLabel" numberOfLines={1} className="shrink">
              {title}
            </Text>
          ) : (
            <View />
          )}
          {action}
        </View>
      ) : null}
      {description ? (
        <Text variant="caption" className="px-4">
          {description}
        </Text>
      ) : null}
      <View
        className="overflow-hidden"
        style={{
          borderRadius: GROUPED_CARD_RADIUS,
          borderCurve: "continuous",
          backgroundColor: cardColor,
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
