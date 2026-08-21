import type { TimelineListItem } from "./rows";
import {
  findUnreadDividerIndex,
  type UnreadDividerPlacement,
} from "./unread-divider";

/** One FlashList cell: a timeline row or the unread divider above one. */
export type TimelineListEntry =
  | { type: "row"; key: string; item: TimelineListItem }
  | { type: "unread-divider"; key: typeof UNREAD_DIVIDER_ENTRY_KEY };

const UNREAD_DIVIDER_ENTRY_KEY = "thread-unread-divider";

interface TimelineListEntries {
  entries: TimelineListEntry[];
  /** Index of the divider entry in `entries`, or -1. */
  unreadDividerIndex: number;
}

const UNREAD_DIVIDER_ENTRY: TimelineListEntry = {
  type: "unread-divider",
  key: UNREAD_DIVIDER_ENTRY_KEY,
};

/**
 * Row entries keyed by item identity, so an unchanged item yields the same
 * entry object across rebuilds (the FlashList cell memoizes on the entry).
 */
const rowEntryByItem = new WeakMap<TimelineListItem, TimelineListEntry>();

function rowEntryFor(item: TimelineListItem): TimelineListEntry {
  let entry = rowEntryByItem.get(item);
  if (entry === undefined) {
    entry = { type: "row", key: item.key, item };
    rowEntryByItem.set(item, entry);
  }
  return entry;
}

export function buildTimelineListEntries(
  items: readonly TimelineListItem[],
  unreadDividerPlacement: UnreadDividerPlacement | null,
): TimelineListEntries {
  const dividerItemIndex = findUnreadDividerIndex(
    items,
    unreadDividerPlacement,
  );
  const entries: TimelineListEntry[] = [];
  let unreadDividerIndex = -1;
  items.forEach((item, index) => {
    if (index === dividerItemIndex) {
      unreadDividerIndex = entries.length;
      entries.push(UNREAD_DIVIDER_ENTRY);
    }
    entries.push(rowEntryFor(item));
  });
  return { entries, unreadDividerIndex };
}
