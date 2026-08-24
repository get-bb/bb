import { useRecyclingState } from "@shopify/flash-list";
import { Pressable, View } from "react-native";
import { Text } from "@/ui";
import type { TimelineRowRendererProps } from "../../renderers";
import {
  ExpandableRowHeader,
  TimelineRowShell,
} from "../shared/ExpandableRowHeader";
import { isPastTimelineRow } from "../shared/row-dim";
import { leadingIconForSystemRow, systemDetailText } from "./system-row-model";

/**
 * The detail body of a system row (web `TimelineSystemDetailBlock`): the
 * same neutral output card as command output — provisioning transcripts,
 * provider payloads, error messages — capped to its head with a toggle
 * instead of a nested scroll. Errors are flagged by the title's status
 * decoration, not by recolouring the body.
 */
function SystemDetailBlock({
  detail,
  rowId,
}: {
  detail: string;
  rowId: string;
}) {
  const [showAll, setShowAll] = useRecyclingState(false, [rowId]);
  const body = systemDetailText(detail, showAll);
  return (
    <View
      className="mb-2 overflow-hidden rounded-lg border border-border bg-card"
      testID="timeline-system-detail"
    >
      <Text
        variant="mono"
        className="px-4 py-3 text-xs text-subtle-foreground"
        style={{ opacity: 0.7 }}
        selectable
      >
        {body.text}
      </Text>
      {body.hiddenLineCount > 0 || showAll ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => setShowAll((value) => !value)}
          className="border-t border-border-hairline px-4 py-2 active:bg-state-hover"
        >
          <Text variant="caption" className="font-medium">
            {showAll
              ? "Show less"
              : `Show ${body.hiddenLineCount} more line${body.hiddenLineCount === 1 ? "" : "s"}`}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * `system` renderer: debug / error / reconnect notes and lifecycle
 * operations (compaction, context clear, parent change, provisioning,
 * interruption, provider-unhandled, warnings, deprecations). The title comes
 * from `@bb/thread-view` (status decoration carries the error colour, a
 * pending operation shimmers); operations get their per-action glyph; rows
 * with a detail body expand into the output card.
 */
export function SystemRow({
  item,
  expanded,
  onToggle,
}: TimelineRowRendererProps<"system">) {
  const row = item.row;
  const detail = row.detail?.trim() ?? "";
  const expandable = item.expandable && detail.length > 0;
  return (
    <TimelineRowShell depth={item.depth} kind="system">
      <ExpandableRowHeader
        title={item.title}
        leadingIcon={leadingIconForSystemRow(row)}
        expandable={expandable}
        expanded={expandable && expanded}
        onToggle={onToggle}
        dimmed={isPastTimelineRow(item)}
        testID={`timeline-system-${row.systemKind === "operation" ? row.operationKind : row.systemKind}`}
      />
      {expandable && expanded ? (
        <SystemDetailBlock detail={row.detail ?? ""} rowId={row.id} />
      ) : null}
    </TimelineRowShell>
  );
}
