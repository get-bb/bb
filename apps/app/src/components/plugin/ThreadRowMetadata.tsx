import { memo, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import type {
  ExperimentalThreadRowMetadataLineProps,
  PluginSidebarThread,
} from "@get-bb/plugin-sdk";
import { PluginSlotMount } from "@/components/plugin/PluginSlotMount";
import { compareGroupedPlacement } from "@/lib/grouped-placement";
import {
  collectedStore,
  slotKey,
  useRegisterLineThread,
} from "@/lib/thread-row-metadata-store";
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
