import type { ExperimentalThreadInfoProps } from "@get-bb/plugin-sdk";
import { PluginSlotMount } from "@/components/plugin/PluginSlotMount";
import { compareGroupedPlacement } from "@/lib/grouped-placement";
import { usePluginSlotKind, type PluginSlotSnapshot } from "@/lib/plugin-slots";
import { PLUGIN_SLOT_REVEAL, useOrderedReveal } from "@/lib/lazy-parts";
import { InfoSectionCollapseIdContext } from "./useInfoSectionCollapse";

type ThreadInfoRegistration =
  | PluginSlotSnapshot["threadInfoRows"][number]
  | PluginSlotSnapshot["threadInfoSections"][number];

function sortThreadInfoEntries<Entry extends ThreadInfoRegistration>(
  entries: readonly Entry[],
): Entry[] {
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((left, right) =>
      compareGroupedPlacement(left.entry, left.index, right.entry, right.index),
    )
    .map(({ entry }) => entry);
}

export function ThreadInfoRows(props: ExperimentalThreadInfoProps) {
  const threadInfoRows = usePluginSlotKind("threadInfoRows");
  return useOrderedReveal(
    sortThreadInfoEntries(threadInfoRows),
    PLUGIN_SLOT_REVEAL,
  ).map(({ pluginId, id, generation, component: Component }) => (
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
  ));
}

export function ThreadInfoSections(props: ExperimentalThreadInfoProps) {
  const threadInfoSections = usePluginSlotKind("threadInfoSections");
  return useOrderedReveal(
    sortThreadInfoEntries(threadInfoSections),
    PLUGIN_SLOT_REVEAL,
  ).map(({ pluginId, id, generation, component: Component }) => (
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
  ));
}
