import { PluginSlotMount } from "./PluginSlotMount";
import { usePluginSlots } from "@/lib/plugin-slots";

export function PluginBrowserToolbarActions({
  threadId,
  tabId,
  url,
  isCompactViewport,
}: {
  threadId: string;
  tabId: string;
  url: string;
  isCompactViewport: boolean;
}) {
  const { browserToolbarActions } = usePluginSlots();

  if (browserToolbarActions.length === 0) return null;

  return browserToolbarActions.map((slot) => {
    const Component = slot.component;
    return (
      <PluginSlotMount
        key={`${slot.pluginId}/${slot.id}/${slot.generation}/${threadId}/${tabId}`}
        pluginId={slot.pluginId}
        slotKind="browserToolbarAction"
        slotId={slot.id}
        instanceId={`${threadId}/${tabId}`}
        crashFallback={null}
      >
        <span
          role="group"
          aria-label={slot.title}
          className="flex shrink-0 items-center"
        >
          <Component
            threadId={threadId}
            tabId={tabId}
            url={url}
            isCompactViewport={isCompactViewport}
          />
        </span>
      </PluginSlotMount>
    );
  });
}
