import { usePluginSlots } from "@/lib/plugin-slots";
import { PluginSlotMount } from "./PluginSlotMount";

export interface PluginComposerStatusesProps {
  projectId: string | null;
  threadId: string | null;
}

/**
 * Plugin status cards rendered by the host inside the prompt stack. Snapshot
 * order is deterministic by plugin id, then registration order.
 */
export function PluginComposerStatuses({
  projectId,
  threadId,
}: PluginComposerStatusesProps) {
  const { experimental_composerStatuses: statuses } = usePluginSlots();
  if (statuses.length === 0) return null;

  return statuses.map((status) => (
    <PluginSlotMount
      key={`${status.pluginId}/${status.id}/${status.generation}`}
      pluginId={status.pluginId}
      slotKind="experimental_composerStatus"
      slotId={status.id}
    >
      <status.component projectId={projectId} threadId={threadId} />
    </PluginSlotMount>
  ));
}
