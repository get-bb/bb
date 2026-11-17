import { useState } from "react";

export function hasSameItemIds(
  left: readonly string[] | undefined,
  right: readonly string[],
): boolean {
  if (left === undefined || left.length !== right.length) return false;
  return left.every((itemId, index) => itemId === right[index]);
}

function hasSameItemIdSet(left: readonly string[], right: readonly string[]) {
  if (left.length !== right.length) return false;
  const members = new Set(left);
  return right.every((itemId) => members.has(itemId));
}

export function canKeepSortableItemIds(
  previous: readonly string[] | undefined,
  next: readonly string[],
  dragging: boolean,
): boolean {
  if (previous === undefined) return false;
  return dragging
    ? hasSameItemIds(previous, next)
    : hasSameItemIdSet(previous, next);
}

export function useSortableItemIds<ItemIds extends readonly string[]>(
  itemIds: ItemIds,
  dragging: boolean,
): ItemIds {
  const [kept, setKept] = useState(itemIds);
  if (kept === itemIds || canKeepSortableItemIds(kept, itemIds, dragging)) {
    return kept;
  }
  setKept(itemIds);
  return itemIds;
}
