import { registerTimelineRowRenderer } from "../../renderers";
import type { TimelineRowRendererProps } from "../../renderers";
import { AssistantMessageRow } from "./AssistantMessageRow";
import { UserMessageRow } from "./UserMessageRow";

function AssistantRow({
  item,
  projectId,
}: TimelineRowRendererProps<"conversation:assistant">) {
  return (
    <AssistantMessageRow
      row={item.row}
      depth={item.depth}
      projectId={projectId}
    />
  );
}

registerTimelineRowRenderer("conversation:user", UserMessageRow);
registerTimelineRowRenderer("conversation:assistant", AssistantRow);
