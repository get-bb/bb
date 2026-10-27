import { memo, useInsertionEffect, useLayoutEffect, useRef } from "react";
import type {
  ExperimentalThreadRowMetadataLineProps,
  PluginSidebarThread,
} from "@get-bb/plugin-sdk";
import { PluginSlotMount } from "@/components/plugin/PluginSlotMount";
import { compareGroupedPlacement } from "@/lib/grouped-placement";
import { retainPluginCss } from "@/lib/plugin-css";
import {
  usePluginSlots,
  type PluginThreadRowMetadataSlot,
} from "@/lib/plugin-slots";
import { useThreadRowLive } from "@/lib/thread-row-visibility";

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

const itemsWithContent = new Set<string>();

export function resetThreadRowMetadataForTest(): void {
  itemsWithContent.clear();
}

function itemKey(slot: PluginThreadRowMetadataSlot, threadId: string): string {
  return `${slot.pluginId}/${slot.id}/${slot.generation}/${threadId}`;
}

function recordItemContent(
  container: HTMLElement,
  rendered: { slots: readonly PluginThreadRowMetadataSlot[]; threadId: string },
): void {
  const roots = container.querySelectorAll(":scope > [data-bb-plugin-root]");
  let hasItems = false;
  rendered.slots.forEach((slot, index) => {
    const key = itemKey(slot, rendered.threadId);
    if (roots[index]?.hasChildNodes()) {
      itemsWithContent.add(key);
      hasItems = true;
    } else itemsWithContent.delete(key);
  });
  container.toggleAttribute("data-has-items", hasItems);
}

function MountedThreadRowMetadata({
  thread,
  slots,
}: {
  thread: PluginSidebarThread;
  slots: readonly PluginThreadRowMetadataSlot[];
}) {
  const anchor = useRef<HTMLSpanElement>(null);
  const isLive = useThreadRowLive(anchor);
  const pluginIds = [...new Set(slots.map((slot) => slot.pluginId))].join(
    "\n",
  );
  useInsertionEffect(() => {
    const releases = pluginIds.split("\n").map(retainPluginCss);
    return () => {
      for (const release of releases) release();
    };
  }, [pluginIds]);
  const mounted = slots.filter(
    (slot) => isLive || itemsWithContent.has(itemKey(slot, thread.id)),
  );
  const rendered = useRef({ slots: mounted, threadId: thread.id });
  useLayoutEffect(() => {
    rendered.current = { slots: mounted, threadId: thread.id };
    if (anchor.current !== null)
      recordItemContent(anchor.current, rendered.current);
  });
  useLayoutEffect(() => {
    const container = anchor.current;
    if (container === null) return;
    const observer = new MutationObserver(() =>
      recordItemContent(container, rendered.current),
    );
    observer.observe(container, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);
  return (
    <span
      ref={anchor}
      data-thread-row-metadata=""
      className="pointer-events-auto relative z-[31] hidden min-w-0 flex-1 items-center gap-2 overflow-hidden data-[has-items]:flex"
    >
      {mounted.map((slot) => {
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
            <Component thread={thread} isLive={isLive} />
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
