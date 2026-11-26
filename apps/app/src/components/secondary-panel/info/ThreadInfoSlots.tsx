import type { ExperimentalThreadInfoProps } from "@get-bb/plugin-sdk";
import { PluginSlotMount } from "@/components/plugin/PluginSlotMount";
import { compareGroupedPlacement } from "@/lib/grouped-placement";
import { usePluginSlotKind, type PluginSlotSnapshot } from "@/lib/plugin-slots";
import { PLUGIN_SLOT_REVEAL, useOrderedReveal } from "@/lib/lazy-parts";
import { InfoSectionCollapseIdContext } from "./useInfoSectionCollapse";

const PENDING_ENTRY = <span data-thread-info-pending="" hidden />;

type ThreadInfoRegistration =
  | PluginSlotSnapshot["threadInfoRows"][number]
  | PluginSlotSnapshot["threadInfoSections"][number];

function useRevealedThreadInfoEntries<Entry extends ThreadInfoRegistration>(
  registrations: readonly Entry[],
): { entries: readonly Entry[]; pending: boolean } {
  const sorted = registrations
    .map((entry, index) => ({ entry, index }))
    .sort((left, right) =>
      compareGroupedPlacement(left.entry, left.index, right.entry, right.index),
    )
    .map(({ entry }) => entry);
  const entries = useOrderedReveal(sorted, PLUGIN_SLOT_REVEAL);
  return { entries, pending: entries.length < sorted.length };
}

export function ThreadInfoRows(props: ExperimentalThreadInfoProps) {
  const { entries, pending } = useRevealedThreadInfoEntries(
    usePluginSlotKind("threadInfoRows"),
  );
  return (
    <>
      {entries.map(({ pluginId, id, generation, component: Component }) => (
        <PluginSlotMount
          key={`${pluginId}/${id}/${generation}/${props.threadId}`}
          pluginId={pluginId}
          slotKind="threadInfoRow"
          slotId={id}
          instanceId={props.threadId}
          crashFallback={null}
        >
          <Component {...props} />
        </PluginSlotMount>
      ))}
      {pending ? PENDING_ENTRY : null}
    </>
  );
}

export function ThreadInfoSections(props: ExperimentalThreadInfoProps) {
  const { entries, pending } = useRevealedThreadInfoEntries(
    usePluginSlotKind("threadInfoSections"),
  );
  return (
    <>
      {entries.map(({ pluginId, id, generation, component: Component }) => (
        <InfoSectionCollapseIdContext.Provider
          key={`${pluginId}/${id}/${generation}/${props.threadId}`}
          value={`${pluginId}/${id}`}
        >
          <PluginSlotMount
            pluginId={pluginId}
            slotKind="threadInfoSection"
            slotId={id}
            instanceId={props.threadId}
            crashFallback={null}
          >
            <Component {...props} />
          </PluginSlotMount>
        </InfoSectionCollapseIdContext.Provider>
      ))}
      {pending ? PENDING_ENTRY : null}
    </>
  );
}
