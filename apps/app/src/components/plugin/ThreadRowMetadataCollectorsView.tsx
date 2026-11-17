import {
  useLayoutEffect,
  useMemo,
  useSyncExternalStore,
  type ComponentType,
} from "react";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk";
import { PluginSlotMount } from "@/components/plugin/PluginSlotMount";
import { useSidebarThreads } from "@/lib/plugin-sidebar-hooks";
import {
  usePluginSlotKind,
  type PluginThreadRowMetadataSlot,
} from "@/lib/plugin-slots";
import {
  dropCollected,
  lineThreadsStore,
  publishCollected,
  slotKey,
} from "@/lib/thread-row-metadata-store";

type CollectorProps = { threads: readonly PluginSidebarThread[] };

const collectorHosts = new WeakMap<
  PluginThreadRowMetadataSlot,
  { Collector: ComponentType<CollectorProps> }
>();

type SlotWithUseData = PluginThreadRowMetadataSlot & {
  useData: NonNullable<PluginThreadRowMetadataSlot["useData"]>;
};

function hasUseData(
  slot: PluginThreadRowMetadataSlot,
): slot is SlotWithUseData {
  return slot.useData !== undefined;
}

function createDataCollector(slot: SlotWithUseData) {
  const key = slotKey(slot);
  return function DataCollector({ threads }: CollectorProps) {
    const data = slot.useData({ threads });
    useLayoutEffect(() => publishCollected(key, data), [data]);
    useLayoutEffect(() => () => dropCollected(key), []);
    return null;
  };
}

function createNoDataCollector(slot: PluginThreadRowMetadataSlot) {
  const key = slotKey(slot);
  return function NoDataCollector() {
    useLayoutEffect(() => publishCollected(key, undefined), []);
    useLayoutEffect(() => () => dropCollected(key), []);
    return null;
  };
}

function collectorHostFor(slot: PluginThreadRowMetadataSlot) {
  const existing = collectorHosts.get(slot);
  if (existing !== undefined) return existing;
  const host = {
    Collector: hasUseData(slot)
      ? createDataCollector(slot)
      : createNoDataCollector(slot),
  };
  collectorHosts.set(slot, host);
  return host;
}

function ThreadRowMetadataCollector({
  slot,
  threads,
}: {
  slot: PluginThreadRowMetadataSlot;
} & CollectorProps) {
  const host = collectorHostFor(slot);
  return <host.Collector threads={threads} />;
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
  const slots = usePluginSlotKind("threadRowMetadata").filter(
    (slot) => slot.useData !== undefined,
  );
  if (mounted.length === 0 || slots.length === 0) return null;
  return <ListableThreads slots={slots} mounted={mounted} />;
}
