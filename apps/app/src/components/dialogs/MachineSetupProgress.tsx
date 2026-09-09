import { usePluginSlots } from "@/lib/plugin-slots";
import { sdk } from "@/lib/sdk";
import { PluginSlotMount } from "@/components/plugin/PluginSlotMount";

export function MachineSetupProgress({
  id,
  scope,
  providerId,
}: {
  id: string;
  scope: "launch" | "thread";
  providerId?: string;
}) {
  const { machineSetup } = usePluginSlots();
  return machineSetup
    .filter(
      (slot) =>
        providerId === undefined || slot.machineProviderId === providerId,
    )
    .map((slot) => {
      const Component = slot.progress;
      return Component ? (
        <PluginSlotMount
          key={slot.pluginId + "/" + slot.machineProviderId}
          pluginId={slot.pluginId}
          slotKind="machineSetup"
          slotId={slot.machineProviderId}
        >
          <Component client={sdk} id={id} scope={scope} />
        </PluginSlotMount>
      ) : null;
    });
}
