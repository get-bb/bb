import { memo, useLayoutEffect, useRef } from "react";
import type {
  ExperimentalThreadRowItemsProps,
  PluginSidebarThread,
} from "@get-bb/plugin-sdk";
import { PluginSlotMount } from "@/components/plugin/PluginSlotMount";
import { compareGroupedPlacement } from "@/lib/grouped-placement";
import {
  usePluginSlots,
  type PluginThreadRowItemSlot,
} from "@/lib/plugin-slots";
import { useThreadRowLive } from "@/lib/thread-row-visibility";

function sortThreadRowItems(
  slots: readonly PluginThreadRowItemSlot[],
): PluginThreadRowItemSlot[] {
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

export function resetThreadRowItemsForTest(): void {
  itemsWithContent.clear();
}

function itemKey(slot: PluginThreadRowItemSlot, threadId: string): string {
  return `${slot.pluginId}/${slot.id}/${slot.generation}/${threadId}`;
}

function recordItemContent(
  container: HTMLElement,
  rendered: { slots: readonly PluginThreadRowItemSlot[]; threadId: string },
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

function MountedThreadRowItems({
  thread,
  slots,
}: {
  thread: PluginSidebarThread;
  slots: readonly PluginThreadRowItemSlot[];
}) {
  const anchor = useRef<HTMLSpanElement>(null);
  const isLive = useThreadRowLive(anchor);
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
      data-thread-row-items=""
      className="pointer-events-auto relative z-[31] ml-auto hidden max-w-20 shrink-0 items-center gap-1 overflow-hidden data-[has-items]:flex"
    >
      {mounted.map((slot) => {
        const Component = slot.component;
        return (
          <PluginSlotMount
            key={`${slot.pluginId}/${slot.id}/${slot.generation}`}
            pluginId={slot.pluginId}
            slotKind="threadRowItem"
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

export const ThreadRowItems = memo(function ThreadRowItems({
  thread,
}: ExperimentalThreadRowItemsProps) {
  const { threadRowItems } = usePluginSlots();
  if (threadRowItems.length === 0) return null;
  return (
    <MountedThreadRowItems
      thread={thread}
      slots={sortThreadRowItems(threadRowItems)}
    />
  );
});
