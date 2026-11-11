import { useMemo } from "react";
import type { ExperimentalThreadHeaderRowProps } from "@get-bb/plugin-sdk";
import { PluginSlotMount } from "@/components/plugin/PluginSlotMount";
import { compareGroupedPlacement } from "@/lib/grouped-placement";
import {
  usePluginSlots,
  type PluginThreadHeaderRowSlot,
} from "@/lib/plugin-slots";

function sortThreadHeaderRows(
  slots: readonly PluginThreadHeaderRowSlot[],
): PluginThreadHeaderRowSlot[] {
  return slots
    .map((slot, index) => ({ slot, index }))
    .sort((left, right) =>
      compareGroupedPlacement(
        { group: "", order: left.slot.order },
        left.index,
        { group: "", order: right.slot.order },
        right.index,
      ),
    )
    .map(({ slot }) => slot);
}

interface PluginThreadHeaderRowsProps {
  threadId: string;
  projectId: string;
  environmentId: string | null;
}

export function PluginThreadHeaderRows({
  threadId,
  projectId,
  environmentId,
}: PluginThreadHeaderRowsProps) {
  const { threadHeaderRows } = usePluginSlots();
  const props = useMemo<ExperimentalThreadHeaderRowProps>(
    () => ({
      threadId,
      projectId,
      environment: environmentId === null ? null : { id: environmentId },
    }),
    [environmentId, projectId, threadId],
  );
  if (threadHeaderRows.length === 0) return null;
  return (
    <div
      data-thread-header-rows=""
      className="flex w-full min-w-0 shrink-0 flex-col"
    >
      {sortThreadHeaderRows(threadHeaderRows).map(
        ({ pluginId, id, generation, component: Component }) => (
          <PluginSlotMount
            key={`${pluginId}/${id}/${generation}/${threadId}`}
            pluginId={pluginId}
            slotKind="threadHeaderRow"
            slotId={id}
            instanceId={threadId}
            crashFallback={null}
          >
            <Component {...props} />
          </PluginSlotMount>
        ),
      )}
    </div>
  );
}
