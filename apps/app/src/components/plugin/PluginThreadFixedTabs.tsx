import { hasThreadId } from "@/lib/thread-id";
import type { SecondaryPanelFixedTab } from "@/components/secondary-panel/ThreadSecondaryPanel";
import { PluginItemIcon } from "./PluginIcon";
import { useMemo } from "react";
import {
  createPluginFixedPanelTab,
  type FixedPanelViewTab,
} from "@/lib/fixed-panel-tabs-state";
import {
  FixedTabTargetScope,
  getThreadFixedTabOwnerId,
} from "@/lib/app-fixed-tab-navigation";
import type { AppFixedTabReference } from "@/lib/app-navigation-host";
import { isThreadTab, type PluginThreadFixedTabSlot } from "@/lib/plugin-slots";
import { PluginTabScope, usePluginTabs } from "./PluginTabs";
import type { ExperimentalThreadEnvironment } from "@get-bb/plugin-sdk";

export interface ThreadFixedTabEntry {
  slot: PluginThreadFixedTabSlot;
  tab: FixedPanelViewTab;
  reference: AppFixedTabReference;
}

export function getThreadFixedTabTargetKey(
  threadId: string,
  reference: AppFixedTabReference,
): string {
  return `${threadId}\0${reference.ownerId}\0${reference.tabId}`;
}

export function createThreadFixedTabDescriptor(
  entry: ThreadFixedTabEntry,
  threadId: string,
  environment: ExperimentalThreadEnvironment | null,
  open: (reference: AppFixedTabReference) => void,
) {
  const tooltip = entry.slot.tooltip ?? entry.slot.title;
  const Component = entry.slot.component;
  return {
    ariaLabel: `Show ${tooltip.toLowerCase()} panel`,
    label: entry.slot.title,
    leadingVisual: (
      <PluginItemIcon pluginId={entry.slot.pluginId} icon={entry.slot.icon} />
    ),
    onSelect: () => open(entry.reference),
    tab: entry.tab,
    title: tooltip,
    contentFillsRegion: entry.slot.layout === "flush",
    renderContent: () => (
      <PluginTabScope slot={entry.slot} instanceId={threadId}>
        <FixedTabTargetScope
          ownerId={entry.reference.ownerId}
          tabId={entry.reference.tabId}
          targetKey={getThreadFixedTabTargetKey(threadId, entry.reference)}
        >
          <Component threadId={threadId} environment={environment} />
        </FixedTabTargetScope>
      </PluginTabScope>
    ),
  } satisfies SecondaryPanelFixedTab;
}

export function useThreadFixedTabs({
  threadId,
  environmentId,
}: {
  threadId: string | null;
  environmentId: string | null;
}) {
  const context = useMemo(
    () =>
      hasThreadId(threadId)
        ? {
            kind: "thread" as const,
            threadId,
            environment: environmentId === null ? null : { id: environmentId },
          }
        : null,
    [threadId, environmentId],
  );
  const { slots, observers, isReady } = usePluginTabs(context);
  const entries = useMemo<readonly ThreadFixedTabEntry[]>(
    () =>
      slots
        .filter(isThreadTab)
        .filter(
          (slot): slot is PluginThreadFixedTabSlot =>
            slot.availability === "fixed",
        )
        .map((slot) => ({
          slot,
          tab: createPluginFixedPanelTab({
            pluginId: slot.pluginId,
            tabId: slot.id,
          }),
          reference: {
            ownerId: getThreadFixedTabOwnerId(slot.pluginId),
            tabId: slot.id,
          },
        })),
    [slots],
  );
  const actions = useMemo(
    () =>
      slots
        .filter(isThreadTab)
        .filter(
          (slot): slot is Extract<typeof slot, { availability: "action" }> =>
            slot.availability === "action",
        ),
    [slots],
  );
  return { entries, actions, observers, isReady };
}
