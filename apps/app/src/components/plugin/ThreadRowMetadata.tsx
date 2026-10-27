import {
  memo,
  useEffect,
  useLayoutEffect,
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

let mountedLines = 0;
const lineListeners = new Set<() => void>();

function subscribeLines(listener: () => void): () => void {
  lineListeners.add(listener);
  return () => lineListeners.delete(listener);
}

function anyLineMounted(): boolean {
  return mountedLines > 0;
}

function useCountMountedLine(): void {
  useEffect(() => {
    mountedLines += 1;
    if (mountedLines === 1) for (const listener of lineListeners) listener();
    return () => {
      mountedLines -= 1;
      if (mountedLines === 0)
        for (const listener of lineListeners) listener();
    };
  }, []);
}

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
  useCountMountedLine();
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
        const Component = slot.component;
        return (
          <PluginSlotMount
            key={`${slot.pluginId}/${slot.id}/${slot.generation}`}
            pluginId={slot.pluginId}
            slotKind="threadRowMetadata"
            slotId={slot.id}
            instanceId={thread.id}
            crashFallback={null}
          >
            <Component thread={thread} />
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

function PrefetchedThreadRowMetadata({
  slots,
}: {
  slots: readonly PluginThreadRowMetadataSlot[];
}) {
  const { threads } = useSidebarThreads();
  return (
    <div hidden data-thread-row-metadata-prefetch="">
      {threads.flatMap((thread) =>
        slots.map((slot) => {
          const Component = slot.component;
          return (
            <PluginSlotMount
              key={`${thread.id}/${slot.pluginId}/${slot.id}/${slot.generation}`}
              pluginId={slot.pluginId}
              slotKind="threadRowMetadata"
              slotId={slot.id}
              instanceId={thread.id}
              crashFallback={null}
            >
              <Component thread={thread} />
            </PluginSlotMount>
          );
        }),
      )}
    </div>
  );
}

export function ThreadRowMetadataPrefetch() {
  const active = useSyncExternalStore(
    subscribeLines,
    anyLineMounted,
    anyLineMounted,
  );
  const { threadRowMetadata } = usePluginSlots();
  if (!active || threadRowMetadata.length === 0) return null;
  return (
    <PrefetchedThreadRowMetadata
      slots={sortThreadRowMetadata(threadRowMetadata)}
    />
  );
}
