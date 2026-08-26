import type { TimelineTitle } from "@bb/thread-view";
import { useLayoutEffect, useRef, type ReactNode } from "react";
import { Pressable, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { haptic } from "@/lib/haptics";
import { ServerSvgIcon } from "@/screens/plugins/ServerSvgIcon";
import { useTheme } from "@/theme";
import { Icon, type IconName } from "@/ui";
import {
  TIMELINE_ROW_HORIZONTAL_PADDING_PX,
  timelineRowLeftPadding,
} from "../../FallbackTimelineRow";
import { TimelineTitleView } from "../../TimelineTitleView";
import { PAST_ROW_DIM_OPACITY } from "./row-dim";

/** Web `size-3.5` leading glyph. */
export const ROW_LEADING_ICON_SIZE = 14;
const CHEVRON_SIZE = 14;
/** The disclosure chevron turns from pointing right to pointing down. */
const CHEVRON_TURN_MS = 180;

interface TimelineRowShellProps {
  depth: number;
  kind: string;
  children: ReactNode;
  /** Defaults to `timeline-row-<kind>`. */
  testID?: string;
}

/**
 * The cell frame every structural row shares: the depth-based left inset
 * (flattened container children sit one indent in) and the `timeline-row-
 * <kind>` test id the flows address rows by.
 */
export function TimelineRowShell({
  depth,
  kind,
  children,
  testID,
}: TimelineRowShellProps) {
  return (
    <View
      style={{
        paddingLeft: timelineRowLeftPadding(depth),
        paddingRight: TIMELINE_ROW_HORIZONTAL_PADDING_PX,
      }}
      testID={testID ?? `timeline-row-${kind}`}
    >
      {children}
    </View>
  );
}

/**
 * One `chevron.right` glyph that rotates a quarter turn while expanded,
 * instead of swapping two glyphs. The turn animates only when the same row
 * toggles: FlashList recycles the cell onto other rows without remounting,
 * so a change of `rowKey` snaps the angle to the new row's state instead.
 */
export function DisclosureChevron({
  expanded,
  rowKey,
  size = CHEVRON_SIZE,
  color,
}: {
  expanded: boolean;
  /** Identity of the row the chevron belongs to (the list item key). */
  rowKey: string;
  size?: number;
  color: string;
}) {
  const turn = useSharedValue(expanded ? 1 : 0);
  const applied = useRef({ rowKey, expanded });
  useLayoutEffect(() => {
    const previous = applied.current;
    applied.current = { rowKey, expanded };
    const target = expanded ? 1 : 0;
    if (previous.rowKey !== rowKey) {
      turn.set(target);
      return;
    }
    if (previous.expanded === expanded) return;
    turn.set(
      withTiming(target, {
        duration: CHEVRON_TURN_MS,
        easing: Easing.out(Easing.quad),
      }),
    );
  }, [expanded, rowKey, turn]);
  const rotation = useAnimatedStyle(() => ({
    transform: [{ rotate: `${turn.get() * 90}deg` }],
  }));
  return (
    <Animated.View style={rotation}>
      <Icon name="ChevronRight" size={size} weight="semibold" color={color} />
    </Animated.View>
  );
}

interface ExpandableRowHeaderProps {
  /**
   * Identity of the row (the list item key): the disclosure chevron snaps
   * rather than animates when a recycled cell moves to another row.
   */
  rowKey: string;
  title: TimelineTitle;
  /** Replaces the generic title renderer for a specialized header. */
  titleContent?: ReactNode;
  leadingIcon?: IconName;
  /**
   * A plugin-declared icon resolved from the installed-plugin list, drawn
   * as a tinted remote SVG; `leadingIcon` stays the glyph shown while it
   * loads and when the fetch fails.
   */
  leadingIconUrl?: string;
  /** Accent for the leading glyph (a bridge's tint); defaults to muted. */
  leadingIconColor?: string;
  expandable: boolean;
  expanded: boolean;
  onToggle: () => void;
  /**
   * Header press for non-expandable rows (e.g. open a fetched URL). Ignored
   * while `expandable`, where the press toggles.
   */
  onPress?: () => void;
  /** Trailing slot for non-expandable rows (decision glyph, link icon). */
  trailing?: ReactNode;
  /** Receded "past" layer: the title content (not the chevron) dims. */
  dimmed: boolean;
  /** Long-press on the header (message actions); optional. */
  onLongPress?: () => void;
  accessibilityLabel?: string;
  testID?: string;
}

/**
 * One-line row header (web `ExpandableTimelineRow` summary / `TimelineStaticRow`):
 * optional leading glyph, the title (segments + decorations), and — for
 * expandable rows — a disclosure chevron at the trailing edge, the touch-
 * friendly place for it. Tapping anywhere on the line toggles (with the
 * selection haptic).
 */
export function ExpandableRowHeader({
  rowKey,
  title,
  titleContent,
  leadingIcon,
  leadingIconUrl,
  leadingIconColor,
  expandable,
  expanded,
  onToggle,
  onPress,
  trailing,
  dimmed,
  onLongPress,
  accessibilityLabel,
  testID,
}: ExpandableRowHeaderProps) {
  const { tokens } = useTheme();
  const handlePress = expandable
    ? () => {
        haptic("selection");
        onToggle();
      }
    : onPress;
  const pressable = handlePress !== undefined;
  const iconColor = leadingIconColor ?? tokens.mutedForeground;
  return (
    <Pressable
      // A custom title (e.g. the tappable source-thread chip) keeps its own
      // accessibility elements; the plain title reads as one button.
      accessible={titleContent === undefined}
      accessibilityRole={pressable ? "button" : undefined}
      accessibilityState={expandable ? { expanded } : undefined}
      accessibilityLabel={accessibilityLabel}
      onPress={handlePress}
      onLongPress={onLongPress}
      disabled={!pressable && onLongPress === undefined}
      className="min-h-9 flex-row items-center gap-2 py-1.5 active:opacity-70"
      testID={testID}
    >
      <View
        className="min-w-0 flex-1 flex-row items-center gap-1.5"
        style={dimmed ? { opacity: PAST_ROW_DIM_OPACITY } : undefined}
      >
        {leadingIcon && leadingIconUrl !== undefined ? (
          <ServerSvgIcon
            path={leadingIconUrl}
            fallbackIcon={leadingIcon}
            size={ROW_LEADING_ICON_SIZE}
            color={iconColor}
          />
        ) : leadingIcon ? (
          <Icon
            name={leadingIcon}
            size={ROW_LEADING_ICON_SIZE}
            color={iconColor}
          />
        ) : null}
        <View className="min-w-0 flex-1">
          {titleContent ?? <TimelineTitleView title={title} />}
        </View>
      </View>
      {expandable ? (
        <DisclosureChevron
          expanded={expanded}
          rowKey={rowKey}
          color={tokens.subtleForeground}
        />
      ) : (
        (trailing ?? null)
      )}
    </Pressable>
  );
}
