import {
  memo,
  useLayoutEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";
import type {
  ExperimentalThreadRowMetadataLineProps,
  PluginSidebarThread,
} from "@get-bb/plugin-sdk";
import { PluginSlotMount } from "@/components/plugin/PluginSlotMount";
import { compareGroupedPlacement } from "@/lib/grouped-placement";
import { useSidebarThreads } from "@/lib/plugin-sidebar-hooks";
import {
  usePluginSlots,
  type PluginThreadRowMetadataSlot,
} from "@/lib/plugin-slots";

function sortThreadRowMetadata(
  slots: readonly PluginThreadRowMetadataSlot[],
): PluginThreadRowMetadataSlot[] {
  return slots
    .map((slot, index) => ({ slot, index }))
    .sort((left, right) =>
      compareGroupedPlacement(
        { group: "", order: left.slot.order },
        left.index,
        { group: "", order: right.slot.order },
        right.index,
      ),
    )
    .map(({ slot }) => slot);
}

function slotKey(slot: PluginThreadRowMetadataSlot): string {
  return `${slot.pluginId}/${slot.id}/${slot.generation}`;
}

function createStore<Snapshot>(read: () => Snapshot) {
  const listeners = new Set<() => void>();
  let snapshot = read();
  let queued = false;
  return {
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    changed(): void {
      if (queued) return;
      queued = true;
      queueMicrotask(() => {
        queued = false;
        snapshot = read();
        for (const listener of listeners) listener();
      });
    },
  };
}

const lineThreads = new Map<
  string,
  { thread: PluginSidebarThread; lines: number }
>();
const lineThreadsStore = createStore(() =>
  [...lineThreads.values()].map((entry) => entry.thread),
);

function useRegisterLineThread(thread: PluginSidebarThread): void {
  useLayoutEffect(() => {
    const entry = lineThreads.get(thread.id);
    lineThreads.set(thread.id, { thread, lines: (entry?.lines ?? 0) + 1 });
    if (entry?.thread !== thread) lineThreadsStore.changed();
    return () => {
      const current = lineThreads.get(thread.id);
      if (current === undefined) return;
      if (current.lines > 1)
        lineThreads.set(thread.id, { ...current, lines: current.lines - 1 });
      else {
        lineThreads.delete(thread.id);
        lineThreadsStore.changed();
      }
    };
  }, [thread]);
}

const collectedData = new Map<string, { data: unknown }>();
const collectedStore = createStore(() => new Map(collectedData));

function recordItemContent(container: HTMLElement): void {
  const roots = container.querySelectorAll(":scope > [data-bb-plugin-root]");
  container.toggleAttribute(
    "data-has-items",
    [...roots].some((root) => root.hasChildNodes()),
  );
}

function MountedThreadRowMetadata({
  thread,
  slots,
}: {
  thread: PluginSidebarThread;
  slots: readonly PluginThreadRowMetadataSlot[];
}) {
  const anchor = useRef<HTMLSpanElement>(null);
  useRegisterLineThread(thread);
  const collected = useSyncExternalStore(
    collectedStore.subscribe,
    collectedStore.getSnapshot,
  );
  useLayoutEffect(() => {
    if (anchor.current !== null) recordItemContent(anchor.current);
  });
  useLayoutEffect(() => {
    const container = anchor.current;
    if (container === null) return;
    const observer = new MutationObserver(() => recordItemContent(container));
    observer.observe(container, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);
  return (
    <span
      ref={anchor}
      data-thread-row-metadata=""
      className="pointer-events-auto relative z-[31] hidden min-w-0 flex-1 items-center gap-2 overflow-hidden data-[has-items]:flex"
    >
      {slots.map((slot) => {
        const entry = collected.get(slotKey(slot));
        if (slot.useData !== undefined && entry === undefined) return null;
        const Component = slot.component;
        return (
          <PluginSlotMount
            key={slotKey(slot)}
            pluginId={slot.pluginId}
            slotKind="threadRowMetadata"
            slotId={slot.id}
            instanceId={thread.id}
            crashFallback={null}
          >
            <Component thread={thread} data={entry?.data} />
          </PluginSlotMount>
        );
      })}
    </span>
  );
}

export const ThreadRowMetadata = memo(function ThreadRowMetadata({
  thread,
}: ExperimentalThreadRowMetadataLineProps) {
  const { threadRowMetadata } = usePluginSlots();
  if (threadRowMetadata.length === 0) return null;
  return (
    <MountedThreadRowMetadata
      thread={thread}
      slots={sortThreadRowMetadata(threadRowMetadata)}
    />
  );
});

function ThreadRowMetadataCollector({
  slot,
  threads,
}: {
  slot: PluginThreadRowMetadataSlot;
  threads: readonly PluginSidebarThread[];
}) {
  const data = slot.useData?.({ threads });
  const key = slotKey(slot);
  useLayoutEffect(() => {
    collectedData.set(key, { data });
    collectedStore.changed();
  }, [key, data]);
  useLayoutEffect(
    () => () => {
      collectedData.delete(key);
      collectedStore.changed();
    },
    [key],
  );
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

export function ThreadRowMetadataCollectors() {
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
