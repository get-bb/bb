import type { ReactNode } from "react";
import { View } from "react-native";
import { activityIntentTitleGlyph } from "@bb/thread-view";
import { useTheme } from "@/theme";
import { Icon } from "@/ui";
import { useTimelineRowHost } from "../../host/TimelineRowHostProvider";
import type { TimelineRowRendererItem } from "../../renderers";
import type { TimelineWorkRowKind } from "../../rows";
import { TimelineTitleView } from "../../TimelineTitleView";
import {
  ExpandableRowHeader,
  ROW_LEADING_ICON_SIZE,
  TimelineRowShell,
} from "../shared/ExpandableRowHeader";
import { PAST_ROW_DIM_OPACITY } from "../shared/row-dim";
import {
  compactActivityIntentTitles,
  isPastWorkRow,
  leadingIconForWorkRow,
  leadingIconTintForWorkRow,
  leadingPluginIconUrl,
} from "./work-row-model";

/** Icon size of the leading glyph (web `size-3.5`). */
const WORK_ROW_ICON_SIZE = ROW_LEADING_ICON_SIZE;

interface WorkRowShellProps {
  item: TimelineRowRendererItem<TimelineWorkRowKind>;
  /** Whether the chevron shows and the header toggles the body. */
  expandable: boolean;
  expanded: boolean;
  onToggle(): void;
  /**
   * Header press override for non-expandable rows (e.g. open a fetched URL).
   * Ignored while `expandable`.
   */
  onPress?: () => void;
  /** Trailing slot used when the row is not expandable (decision glyph, link icon). */
  trailing?: ReactNode;
  /** Rendered directly under the header whether or not the row is expanded. */
  belowHeader?: ReactNode;
  /** Body shown under the header while expanded. */
  children?: ReactNode;
  accessibilityLabel?: string;
}

/**
 * Shared chrome for the work-row renderers: the row frame (`TimelineRowShell`)
 * and the one-line header (`ExpandableRowHeader`) every structural row uses,
 * with the work-kind leading glyph, the past-row dim on the summary content
 * only (the caret keeps full strength so completed/active rows line up), and
 * the body while expanded. Inside a step/bundle summary an exploration
 * command row renders one flat line per activity intent instead (web
 * compact-activity-intents), which is never expandable.
 */
export function WorkRowShell({
  item,
  expandable,
  expanded,
  onToggle,
  onPress,
  trailing,
  belowHeader,
  children,
  accessibilityLabel,
}: WorkRowShellProps) {
  const { tokens, mode } = useTheme();
  // The installed-plugin list the timeline host keeps live; a row's
  // "<pluginId>/<name>" glyph resolves against it (or falls back).
  const { installedPlugins } = useTimelineRowHost();
  const row = item.row;
  const dim = isPastWorkRow(row);
  const compactTitles = compactActivityIntentTitles(row, item.parentKind);
  const rowTestID = `timeline-row-${item.kind}`;
  const leadingIconUrl = leadingPluginIconUrl(row, installedPlugins);

  if (compactTitles !== null) {
    const contentStyle = dim ? { opacity: PAST_ROW_DIM_OPACITY } : undefined;
    return (
      <TimelineRowShell depth={item.depth} kind={item.kind} testID={rowTestID}>
        {compactTitles.map((entry) => (
          <View
            key={entry.id}
            className="min-h-7 flex-row items-center gap-1.5 py-0.5"
            style={contentStyle}
            testID="timeline-activity-intent"
          >
            <Icon
              name={activityIntentTitleGlyph(entry)}
              size={WORK_ROW_ICON_SIZE}
              color={tokens.mutedForeground}
            />
            <View className="min-w-0 flex-1">
              <TimelineTitleView title={entry.title} />
            </View>
          </View>
        ))}
      </TimelineRowShell>
    );
  }

  return (
    <TimelineRowShell depth={item.depth} kind={item.kind} testID={rowTestID}>
      <ExpandableRowHeader
        title={item.title}
        leadingIcon={leadingIconForWorkRow(row)}
        {...(leadingIconUrl === null ? {} : { leadingIconUrl })}
        leadingIconColor={leadingIconTintForWorkRow(row, mode)}
        expandable={expandable}
        expanded={expanded}
        onToggle={onToggle}
        onPress={onPress}
        trailing={trailing}
        dimmed={dim}
        accessibilityLabel={accessibilityLabel}
        testID={`${rowTestID}-header`}
      />
      {belowHeader ?? null}
      {expandable && expanded && children ? (
        <View className="pb-2 pt-0.5" testID={`${rowTestID}-body`}>
          {children}
        </View>
      ) : null}
    </TimelineRowShell>
  );
}
