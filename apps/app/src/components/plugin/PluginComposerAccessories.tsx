import {
  usePluginSlots,
  type PluginComposerAccessorySlot,
} from "@/lib/plugin-slots";
import { useRouteState } from "@/hooks/useRouteState";
import { PluginSlotMount } from "./PluginSlotMount";

/**
 * Plugin `composerAccessory` slot mounts (plugin design §5.2), rendered in
 * the prompt box footer's leading region alongside the surface-provided
 * footer content. `projectId`/`threadId` are null on the homepage (new
 * thread) composer. The route-derived props live in an inner component so
 * hosts without a Router (isolated tests/stories) can render the empty
 * state.
 */
export function PluginComposerAccessories() {
  const { composerAccessories } = usePluginSlots();
  if (composerAccessories.length === 0) return null;
  return <PluginComposerAccessoryList accessories={composerAccessories} />;
}

function PluginComposerAccessoryList({
  accessories,
}: {
  accessories: readonly PluginComposerAccessorySlot[];
}) {
  const { projectId, threadId } = useRouteState();
  return (
    <>
      {accessories.map((accessory) => (
        <PluginSlotMount
          // Generation in the key: a P3.4 reload remounts the slot (fresh
          // error-boundary state) instead of reusing a latched crash.
          key={`${accessory.pluginId}/${accessory.id}/${accessory.generation}`}
          pluginId={accessory.pluginId}
          slotKind="composerAccessory"
          slotId={accessory.id}
        >
          <accessory.component
            projectId={projectId ?? null}
            threadId={threadId ?? null}
          />
        </PluginSlotMount>
      ))}
    </>
  );
}
