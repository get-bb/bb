import { View } from "react-native";
import { useTheme } from "@/theme";
import { Spinner, Text } from "@/ui";
import { TIMELINE_ROW_DEPTH_INDENT_PX } from "../../FallbackTimelineRow";
import type { TimelineRowRendererProps } from "../../renderers";
import {
  ExpandableRowHeader,
  TimelineRowShell,
} from "../shared/ExpandableRowHeader";
import { isPastTimelineRow } from "../shared/row-dim";

/**
 * `turn` renderer: a completed turn's recap header ("Worked for 8m 14s") or
 * the live "Working" row. Expanding reveals the turn's rows as flattened
 * children one level in; turns outside the loaded window fetch them lazily
 * (`useTimelineTurnSummaryDetails` through the list's loaders), so the row
 * shows the load state under its header until they arrive.
 */
export function TurnRow({
  item,
  expanded,
  onToggle,
}: TimelineRowRendererProps<"turn">) {
  const { tokens } = useTheme();
  return (
    <TimelineRowShell depth={item.depth} kind="turn">
      <ExpandableRowHeader
        title={item.title}
        expandable={item.expandable}
        expanded={expanded}
        onToggle={onToggle}
        dimmed={isPastTimelineRow(item)}
        testID={`timeline-turn-${item.row.status}`}
      />
      {expanded && item.lazyChildren === "loading" ? (
        <View
          className="flex-row items-center gap-2 pb-2"
          style={{ paddingLeft: TIMELINE_ROW_DEPTH_INDENT_PX }}
          testID="timeline-turn-children-loading"
        >
          <Spinner size="small" color={tokens.mutedForeground} />
          <Text variant="caption">Loading turn details…</Text>
        </View>
      ) : null}
      {expanded && item.lazyChildren === "error" ? (
        <Text
          variant="caption"
          tone="destructive"
          className="pb-2"
          style={{ paddingLeft: TIMELINE_ROW_DEPTH_INDENT_PX }}
          testID="timeline-turn-children-error"
        >
          Failed to load turn details. Collapse and expand to retry.
        </Text>
      ) : null}
    </TimelineRowShell>
  );
}
