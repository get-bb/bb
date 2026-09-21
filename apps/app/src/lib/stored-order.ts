import { arrayMove } from "@bb/client-core";

interface ArrangeByStoredOrderArgs<TItem> {
  items: readonly TItem[];
  getId: (item: TItem) => string;
  storedOrder: readonly string[];
}

interface ArrangedByStoredOrder<TItem> {
  ordered: TItem[];
  normalizedOrder: string[];
}

export function arrangeByStoredOrder<TItem>({
  items,
  getId,
  storedOrder,
}: ArrangeByStoredOrderArgs<TItem>): ArrangedByStoredOrder<TItem> {
  const byId = new Map(items.map((item) => [getId(item), item]));
  const ordered: TItem[] = [];
  const normalizedOrder: string[] = [];
  const seen = new Set<string>();
  for (const id of storedOrder) {
    if (seen.has(id)) continue;
    seen.add(id);
    normalizedOrder.push(id);
    const item = byId.get(id);
    if (item) ordered.push(item);
  }
  for (const item of items) {
    const id = getId(item);
    if (seen.has(id)) continue;
    seen.add(id);
    normalizedOrder.push(id);
    ordered.push(item);
  }

  return { ordered, normalizedOrder };
}

type ReorderStoredOrderArgs<TId extends string> = {
  order: readonly TId[];
  visibleIds: readonly TId[];
} & (
  | { activeId: string; overId: string }
  | { nextVisibleIds: readonly TId[] }
);

export function reorderStoredOrder<TId extends string>(
  args: ReorderStoredOrderArgs<TId>,
): TId[] | null {
  const { order, visibleIds } = args;
  const visibleSet = new Set(visibleIds);
  let nextVisible: readonly TId[];
  if ("nextVisibleIds" in args) {
    nextVisible = args.nextVisibleIds;
    if (
      nextVisible.length !== visibleIds.length ||
      new Set(nextVisible).size !== visibleSet.size ||
      nextVisible.some((id) => !visibleSet.has(id)) ||
      haveSameOrder(nextVisible, visibleIds)
    ) {
      return null;
    }
  } else {
    const from = visibleIds.findIndex((id) => id === args.activeId);
    const to = visibleIds.findIndex((id) => id === args.overId);
    if (from === -1 || to === -1 || from === to) return null;
    nextVisible = arrayMove(visibleIds, from, to);
  }
  let cursor = 0;
  return order.map((id) => (visibleSet.has(id) ? nextVisible[cursor++] : id));
}

export function haveSameOrder(
  left: readonly string[],
  right: readonly string[],
) {
  return (
    left.length === right.length &&
    left.every((id, index) => id === right[index])
  );
}
