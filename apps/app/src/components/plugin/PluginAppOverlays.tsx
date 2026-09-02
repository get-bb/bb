import { usePluginSlots } from "@/lib/plugin-slots";
import { PluginSlotMount } from "./PluginSlotMount";

export function PluginAppOverlays() {
  const { appOverlays } = usePluginSlots();
  if (appOverlays.length === 0) return null;

  return (
    <div data-bb-plugin-app-overlays="" className="contents">
      {appOverlays.map((slot) => {
        const Component = slot.component;
        return (
          <PluginSlotMount
            key={`${slot.pluginId}/${slot.id}/${slot.generation}`}
            pluginId={slot.pluginId}
            slotKind="appOverlay"
            slotId={slot.id}
            crashFallback={null}
          >
            <Component />
          </PluginSlotMount>
        );
      })}
    </div>
  );
}
