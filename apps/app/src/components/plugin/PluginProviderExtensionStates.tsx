import type { ThreadTimelineExtensionState } from "@bb/server-contract";
import { usePluginSlots } from "@/lib/plugin-slots";
import { sdk } from "@/lib/sdk";
import { PluginSlotMount } from "./PluginSlotMount";

interface PluginProviderExtensionStatesProps {
  extensionStates: readonly ThreadTimelineExtensionState[];
  placement: "aboveEditor" | "belowEditor";
  providerId: string;
  threadId: string;
}

/** Generic mount point; payload interpretation and visuals stay in the owner. */
export function PluginProviderExtensionStates({
  extensionStates,
  placement,
  providerId,
  threadId,
}: PluginProviderExtensionStatesProps) {
  const { providerExtensionStates } = usePluginSlots();

  return extensionStates.flatMap((state) => {
    const slot = providerExtensionStates.find(
      (candidate) => state.kind === `${candidate.pluginId}/${candidate.name}`,
    );
    if (!slot) return [];
    return [
      <PluginSlotMount
        key={`${state.kind}:${placement}`}
        pluginId={slot.pluginId}
        slotKind="providerExtensionState"
        slotId={slot.name}
        instanceId={`${threadId}:${placement}`}
        crashFallback={null}
      >
        <slot.component
          threadId={threadId}
          providerId={providerId}
          kind={state.kind}
          payload={state.payload}
          sourceSeq={state.sourceSeq}
          placement={placement}
          experimental_dispatchAction={(action) =>
            sdk.threads.experimental_applyExtensionStateAction({
              threadId,
              kind: state.kind,
              action,
            })
          }
        />
      </PluginSlotMount>,
    ];
  });
}
