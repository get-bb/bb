import { useSidebar } from "@/components/ui/sidebar.js";
import {
  usePluginSlots,
  type ExperimentalSidebarFooterSectionSlot,
} from "@/lib/plugin-slots";
import { PluginSlotMount } from "./PluginSlotMount";

function PluginSidebarFooterSection({
  slot,
  isCompactViewport,
  onNavigate,
}: {
  slot: ExperimentalSidebarFooterSectionSlot;
  isCompactViewport: boolean;
  onNavigate: () => void;
}) {
  const Component = slot.component;
  return (
    <PluginSlotMount
      pluginId={slot.pluginId}
      slotKind="sidebarFooterSection"
      slotId={slot.id}
      crashFallback={null}
    >
      <Component
        isCompactViewport={isCompactViewport}
        onNavigate={onNavigate}
      />
    </PluginSlotMount>
  );
}

export function PluginSidebarFooterSections({
  onNavigate,
}: {
  onNavigate: () => void;
}) {
  const { sidebarFooterSections } = usePluginSlots();
  const { isCompactViewport, open } = useSidebar();
  if (sidebarFooterSections.length === 0 || (!isCompactViewport && !open)) {
    return null;
  }
  return (
    <div data-testid="plugin-sidebar-footer-sections" className="contents">
      {sidebarFooterSections.map((slot) => (
        <PluginSidebarFooterSection
          key={`${slot.pluginId}/${slot.id}/${slot.generation}`}
          slot={slot}
          isCompactViewport={isCompactViewport}
          onNavigate={onNavigate}
        />
      ))}
    </div>
  );
}
