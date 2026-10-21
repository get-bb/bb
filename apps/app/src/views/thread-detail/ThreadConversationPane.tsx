import type { ReactNode } from "react";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import { PluginReplacementSlot } from "@/components/plugin/PluginReplacementSlot";
import { resolveReplacement } from "@/lib/plugin-slot-resolvers";
import { usePluginSlots } from "@/lib/plugin-slots";

const THREAD_CONVERSATION_PANE_SLOT_KIND = "threadConversationPane";

export function ThreadConversationPane({
  threadId,
  children,
}: {
  threadId: string;
  children: ReactNode;
}) {
  const { threadConversationPanes } = usePluginSlots();
  const isCompactViewport = useIsCompactViewport();
  return (
    <PluginReplacementSlot
      replacement={resolveReplacement(threadConversationPanes)}
      original={children}
      slotKind={THREAD_CONVERSATION_PANE_SLOT_KIND}
    >
      {(slot, Original) => (
        <slot.component
          threadId={threadId}
          isCompactViewport={isCompactViewport}
          Original={Original}
        />
      )}
    </PluginReplacementSlot>
  );
}
