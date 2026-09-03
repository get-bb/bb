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

interface ReorderStoredOrderArgs {
  activeId: string;
  overId: string;
  order: readonly string[];
  visibleIds: readonly string[];
}

export function reorderStoredOrder({
  activeId,
  overId,
  order,
  visibleIds,
}: ReorderStoredOrderArgs): string[] | null {
  const from = visibleIds.indexOf(activeId);
  const to = visibleIds.indexOf(overId);
  if (from === -1 || to === -1 || from === to) return null;

  const nextVisible = [...visibleIds];
  const [moved] = nextVisible.splice(from, 1);
  nextVisible.splice(to, 0, moved);

  const visibleSet = new Set(visibleIds);
  let cursor = 0;
  return order.map((id) => (visibleSet.has(id) ? nextVisible[cursor++] : id));
}

export function haveStoredOrdersDiverged(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length !== right.length ||
    left.some((id, index) => id !== right[index])
  );
}
