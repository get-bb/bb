import type { ComponentType } from "react";
import type { ExperimentalThreadInfoProps } from "@get-bb/plugin-sdk";
import { PluginSlotMount } from "@/components/plugin/PluginSlotMount";
import { compareGroupedPlacement } from "@/lib/grouped-placement";
import { usePluginSlots } from "@/lib/plugin-slots";
import { InfoSectionCollapseIdContext } from "./useInfoSectionCollapse";

export interface CoreThreadInfoRegistration {
  id: string;
  group: string;
  order: number;
  component: ComponentType<ExperimentalThreadInfoProps>;
}

interface PluginThreadInfoRegistration {
  id: string;
  group: string;
  order?: number;
  component: ComponentType<ExperimentalThreadInfoProps>;
  pluginId: string;
  generation: number;
}

type ThreadInfoEntry =
  | { owner: "core"; registration: CoreThreadInfoRegistration }
  | { owner: "plugin"; registration: PluginThreadInfoRegistration };

function sortThreadInfoEntries(
  core: readonly CoreThreadInfoRegistration[],
  plugin: readonly PluginThreadInfoRegistration[],
): ThreadInfoEntry[] {
  const entries: ThreadInfoEntry[] = [
    ...core.map((registration) => ({ owner: "core" as const, registration })),
    ...plugin.map((registration) => ({
      owner: "plugin" as const,
      registration,
    })),
  ];
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((left, right) =>
      compareGroupedPlacement(
        left.entry.registration,
        left.index,
        right.entry.registration,
        right.index,
      ),
    )
    .map(({ entry }) => entry);
}

interface ThreadInfoSlotsProps extends ExperimentalThreadInfoProps {
  core: readonly CoreThreadInfoRegistration[];
}

export function ThreadInfoRows({ core, ...props }: ThreadInfoSlotsProps) {
  const { threadInfoRows } = usePluginSlots();
  return sortThreadInfoEntries(core, threadInfoRows).map((entry) => {
    const Component = entry.registration.component;
    if (entry.owner === "core") {
      return <Component key={`core/${entry.registration.id}`} {...props} />;
    }
    const { pluginId, id, generation } = entry.registration;
    return (
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
    );
  });
}

export function ThreadInfoSections({ core, ...props }: ThreadInfoSlotsProps) {
  const { threadInfoSections } = usePluginSlots();
  return sortThreadInfoEntries(core, threadInfoSections).map((entry) => {
    const Component = entry.registration.component;
    if (entry.owner === "core") {
      return (
        <InfoSectionCollapseIdContext.Provider
          key={`core/${entry.registration.id}`}
          value={entry.registration.id}
        >
          <Component {...props} />
        </InfoSectionCollapseIdContext.Provider>
      );
    }
    const { pluginId, id, generation } = entry.registration;
    return (
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
    );
  });
}
