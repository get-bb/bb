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

export { AssistantMessageRow } from "./AssistantMessageRow";
export { AuthoredUserMessage } from "./AuthoredUserMessage";
export { ConversationAttachments } from "./ConversationAttachments";
export { GeneratedMessageRow } from "./GeneratedMessageRow";
export { UserMessageRow } from "./UserMessageRow";
export {
  TurnRequestLabel,
  useConversationAttachments,
  useConversationMarkdownHandlers,
} from "./conversation-shared";
export * from "./conversation-model";
