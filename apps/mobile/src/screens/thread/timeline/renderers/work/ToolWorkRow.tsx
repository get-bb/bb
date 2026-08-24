import type { TimelineRowRendererProps } from "../../renderers";
import { PresentationDetail } from "./PresentationWorkRows";
import { ToolCallDetailBlock } from "./ToolCallDetailBlock";
import { WorkRowShell } from "./WorkRowShell";

/**
 * `work:tool`: title (plugin status labels when the row carries them, else
 * the tool name / exploration intent) over the tool-call card with the
 * arguments and the output text.
 */
export function ToolWorkRow({
  item,
  expanded,
  onToggle,
}: TimelineRowRendererProps<"work:tool">) {
  const row = item.row;
  return (
    <WorkRowShell
      item={item}
      expandable={item.expandable}
      expanded={expanded}
      onToggle={onToggle}
    >
      <PresentationDetail presentation={row.presentation} />
      <ToolCallDetailBlock
        toolName={row.toolName}
        args={row.toolArgs}
        output={row.output}
        streaming={row.status === "pending"}
        testID="timeline-tool-detail"
      />
    </WorkRowShell>
  );
}
