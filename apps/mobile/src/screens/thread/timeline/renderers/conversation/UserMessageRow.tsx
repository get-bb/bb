import type { TimelineRowRendererProps } from "../../renderers";
import { AuthoredUserMessage } from "./AuthoredUserMessage";
import { classifyUserMessage } from "./conversation-model";
import { GeneratedMessageRow } from "./GeneratedMessageRow";

/**
 * `conversation:user` renderer: the person's own message as a bubble, or —
 * for agent-/system-initiated rows — the generated "Message from …" row.
 */
export function UserMessageRow({
  item,
  expanded,
  onToggle,
  projectId,
}: TimelineRowRendererProps<"conversation:user">) {
  const variant = classifyUserMessage(item.row);
  if (variant.kind === "generated") {
    return (
      <GeneratedMessageRow
        row={item.row}
        sourceKind={variant.sourceKind}
        depth={item.depth}
        projectId={projectId}
        expanded={expanded}
        onToggle={onToggle}
      />
    );
  }
  return (
    <AuthoredUserMessage
      row={item.row}
      depth={item.depth}
      projectId={projectId}
      expanded={expanded}
      onToggle={onToggle}
    />
  );
}
