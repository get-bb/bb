import { useLayoutEffect, useMemo, useSyncExternalStore } from "react";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk";
import { PluginSlotMount } from "@/components/plugin/PluginSlotMount";
import { useSidebarThreads } from "@/lib/plugin-sidebar-hooks";
import {
  usePluginSlots,
  type PluginThreadRowMetadataSlot,
} from "@/lib/plugin-slots";
import {
  dropCollected,
  lineThreadsStore,
  publishCollected,
  slotKey,
} from "@/lib/thread-row-metadata-store";

function ThreadRowMetadataCollector({
  slot,
  threads,
}: {
  slot: PluginThreadRowMetadataSlot;
  threads: readonly PluginSidebarThread[];
}) {
  const data = slot.useData?.({ threads });
  const key = slotKey(slot);
  useLayoutEffect(() => publishCollected(key, data), [key, data]);
  useLayoutEffect(() => () => dropCollected(key), [key]);
  return null;
}

function ListableThreads({
  slots,
  mounted,
}: {
  slots: readonly PluginThreadRowMetadataSlot[];
  mounted: readonly PluginSidebarThread[];
}) {
  const sidebar = useSidebarThreads().threads;
  const threads = useMemo(() => {
    const ids = new Set(sidebar.map((thread) => thread.id));
    return [...sidebar, ...mounted.filter((thread) => !ids.has(thread.id))];
  }, [sidebar, mounted]);
  return slots.map((slot) => (
    <PluginSlotMount
      key={slotKey(slot)}
      pluginId={slot.pluginId}
      slotKind="threadRowMetadata"
      slotId={slot.id}
      instanceId="useData"
      crashFallback={null}
      wrapRoot={false}
    >
      <ThreadRowMetadataCollector slot={slot} threads={threads} />
    </PluginSlotMount>
  ));
}

export function ThreadRowMetadataCollectorsView() {
  const mounted = useSyncExternalStore(
    lineThreadsStore.subscribe,
    lineThreadsStore.getSnapshot,
  );
  const slots = usePluginSlots().threadRowMetadata.filter(
    (slot) => slot.useData !== undefined,
  );
  if (mounted.length === 0 || slots.length === 0) return null;
  return <ListableThreads slots={slots} mounted={mounted} />;
}
