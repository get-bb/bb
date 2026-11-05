import { usePluginSlots } from "@/lib/plugin-slots";
import { PluginSlotMount } from "./PluginSlotMount";

export function PluginSetupGuideSections({
  pluginId,
  onPhone,
  onSetupStarted,
}: {
  pluginId: string;
  onPhone: boolean;
  onSetupStarted: () => void;
}) {
  const { setupGuideSections } = usePluginSlots();
  const sections = setupGuideSections.filter(
    (section) => section.pluginId === pluginId,
  );
  if (sections.length === 0) return null;
  return sections.map((section) => (
    <PluginSlotMount
      key={`${section.pluginId}/${section.id}/${section.generation}`}
      pluginId={section.pluginId}
      slotKind="setupGuideSection"
      slotId={section.id}
    >
      <section.component onPhone={onPhone} onSetupStarted={onSetupStarted} />
    </PluginSlotMount>
  ));
}
