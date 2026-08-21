import type { TimelineTitle } from "@bb/thread-view";
import type { ReactNode } from "react";
import { Pressable, View } from "react-native";
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

interface ExpandableRowHeaderProps {
  title: TimelineTitle;
  /** Replaces the generic title renderer for a specialized header. */
  titleContent?: ReactNode;
  leadingIcon?: IconName;
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
 * friendly place for it. Tapping anywhere on the line toggles.
 */
export function ExpandableRowHeader({
  title,
  titleContent,
  leadingIcon,
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
  const handlePress = expandable ? onToggle : onPress;
  const pressable = handlePress !== undefined;
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
        {leadingIcon ? (
          <Icon
            name={leadingIcon}
            size={ROW_LEADING_ICON_SIZE}
            color={tokens.mutedForeground}
          />
        ) : null}
        <View className="min-w-0 flex-1">
          {titleContent ?? <TimelineTitleView title={title} />}
        </View>
      </View>
      {expandable ? (
        <Icon
          name={expanded ? "ChevronDown" : "ChevronRight"}
          size={CHEVRON_SIZE}
          color={tokens.subtleForeground}
        />
      ) : (
        (trailing ?? null)
      )}
    </Pressable>
  );
}
