import {
  usePluginSlots,
  type PluginComposerAccessorySlot,
} from "@/lib/plugin-slots";
import { useRouteState } from "@/hooks/useRouteState";
import { PluginSlotMount } from "./PluginSlotMount";
import { usePluginComposerHost } from "./plugin-composer-host";

/**
 * Plugin `composerAccessory` slot mounts (plugin design §5.2), rendered in
 * the prompt box footer's leading region alongside the surface-provided
 * footer content. When a host supplies an active composer scope (for example,
 * a root composer whose selected project is not represented in the URL), its
 * scope takes precedence over route-derived props. The route-derived fallback
 * lets hosts without a Router (isolated tests/stories) render the empty state.
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
  const composerHost = usePluginComposerHost();
  const scope = composerHost?.scope;
  const activeProjectId =
    scope?.kind === "new-thread" ? scope.projectId : (projectId ?? null);
  const activeThreadId =
    scope && scope.kind !== "new-thread" ? scope.threadId : (threadId ?? null);
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
            projectId={activeProjectId}
            threadId={activeThreadId}
          />
        </PluginSlotMount>
      ))}
    </>
  );
}
