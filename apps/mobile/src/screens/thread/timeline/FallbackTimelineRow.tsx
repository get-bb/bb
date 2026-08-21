import { useMemo } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useTheme } from "@/theme";
import { Icon, Spinner, Text } from "@/ui";
import type { TimelineRowRendererProps } from "./renderers";
import type { TimelineRowKind } from "./rows";
import { TimelineTitleView } from "./TimelineTitleView";

/** Left inset per nesting level (delegation / summary / turn children). */
export const TIMELINE_ROW_DEPTH_INDENT_PX = 16;
export const TIMELINE_ROW_HORIZONTAL_PADDING_PX = 16;

export function timelineRowLeftPadding(depth: number): number {
  return (
    TIMELINE_ROW_HORIZONTAL_PADDING_PX + depth * TIMELINE_ROW_DEPTH_INDENT_PX
  );
}

const RAW_JSON_MAX_CHARS = 6_000;

/**
 * Container kinds flatten their children as the following list items while
 * expanded, so their disclosure shows no body of its own.
 */
function isContainerTimelineRowKind(kind: TimelineRowKind): boolean {
  return (
    kind === "turn" ||
    kind === "step-summary" ||
    kind === "bundle-summary" ||
    kind === "work:delegation"
  );
}

/**
 * The raw row as readable JSON with child collections replaced by counts, so
 * a delegation or summary disclosure does not dump its whole subtree (the
 * children render as their own flattened items).
 */
function formatRowJson(row: object): string {
  const text = JSON.stringify(
    row,
    (key, value: unknown) => {
      if ((key === "childRows" || key === "children") && Array.isArray(value)) {
        return `[${value.length} rows]`;
      }
      return value;
    },
    2,
  );
  return text.length > RAW_JSON_MAX_CHARS
    ? `${text.slice(0, RAW_JSON_MAX_CHARS)}\n…`
    : text;
}

/**
 * Default renderer for kinds without a dedicated one: the title (segments +
 * decorations), a disclosure chevron when the row can expand, and — while
 * expanded — the row's raw JSON so unported kinds remain inspectable.
 * Container rows show their (flattened) children instead of JSON; a turn
 * whose lazy children are still loading or failed says so.
 */
export function FallbackTimelineRow({
  item,
  expanded,
  onToggle,
}: TimelineRowRendererProps) {
  const { tokens } = useTheme();
  const container = isContainerTimelineRowKind(item.kind);
  const json = useMemo(
    () => (expanded && !container ? formatRowJson(item.viewRow) : null),
    [container, expanded, item.viewRow],
  );
  const toggleable = item.expandable;
  return (
    <View
      style={{
        paddingLeft: timelineRowLeftPadding(item.depth),
        paddingRight: TIMELINE_ROW_HORIZONTAL_PADDING_PX,
      }}
      testID={`timeline-row-${item.kind}`}
    >
      <Pressable
        accessibilityRole={toggleable ? "button" : undefined}
        accessibilityState={toggleable ? { expanded } : undefined}
        onPress={toggleable ? onToggle : undefined}
        disabled={!toggleable}
        className="min-h-9 flex-row items-center gap-2 py-1.5 active:opacity-70"
      >
        <View className="min-w-0 flex-1">
          <TimelineTitleView title={item.title} />
        </View>
        {toggleable ? (
          <Icon
            name={expanded ? "ChevronDown" : "ChevronRight"}
            size={16}
            color={tokens.mutedForeground}
          />
        ) : null}
      </Pressable>
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
        >
          Failed to load turn details. Collapse and expand to retry.
        </Text>
      ) : null}
      {expanded && json !== null ? (
        <ScrollView
          horizontal
          className="mb-2 rounded-md border border-border-hairline bg-surface-recessed"
          contentContainerStyle={{ padding: 8 }}
          nestedScrollEnabled
        >
          <Text variant="mono" className="text-xs text-muted-foreground">
            {json}
          </Text>
        </ScrollView>
      ) : null}
    </View>
  );
}
