import { View } from "react-native";
import { Markdown } from "@/markdown";
import { Text } from "@/ui";
import { TIMELINE_ROW_DEPTH_INDENT_PX } from "../../FallbackTimelineRow";
import type { TimelineRowRendererProps } from "../../renderers";
import { WorkRowShell } from "./WorkRowShell";

const THREAD_MENTIONS = {};

/**
 * `work:delegation` (subagent / Task tool): title (verb + description +
 * subagent type, duration) with a disclosure. The subagent's own rows are
 * not rendered here — the list flattens `childRows` as the following items
 * one depth down while expanded — so the cell body only carries the
 * subagent's final output (markdown), shown above those children.
 */
export function DelegationWorkRow({
  item,
  expanded,
  onToggle,
}: TimelineRowRendererProps<"work:delegation">) {
  const row = item.row;
  const output = row.output.trim();
  const hasChildren = row.childRows.length > 0;
  return (
    <WorkRowShell
      item={item}
      expandable={item.expandable}
      expanded={expanded}
      onToggle={onToggle}
    >
      {output.length > 0 ? (
        <View
          style={{ paddingLeft: TIMELINE_ROW_DEPTH_INDENT_PX }}
          testID="timeline-delegation-output"
        >
          {hasChildren ? (
            <Text variant="sectionLabel" className="pb-1">
              Result
            </Text>
          ) : null}
          <Markdown content={output} threadMentions={THREAD_MENTIONS} />
        </View>
      ) : null}
    </WorkRowShell>
  );
}
