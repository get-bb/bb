export interface NeighborReorderItem {
  id: string;
}

export interface NeighborReorderRequest {
  itemId: string;
  nextItemId: string | null;
  previousItemId: string | null;
}

export interface BuildNeighborReorderRequestArgs<
  Item extends NeighborReorderItem,
> {
  activeId: string;
  items: readonly Item[];
  overId: string;
}

export interface ApplyNeighborReorderArgs<Item extends NeighborReorderItem> {
  items: readonly Item[];
  request: NeighborReorderRequest;
}

interface MoveItemArgs<Item> {
  fromIndex: number;
  items: readonly Item[];
  toIndex: number;
}

function moveItem<Item>({
  fromIndex,
  items,
  toIndex,
}: MoveItemArgs<Item>): Item[] {
  const result = [...items];
  const movedItems = result.splice(fromIndex, 1);
  const movedItem = movedItems[0];
  if (!movedItem) {
    return result;
  }
  result.splice(toIndex, 0, movedItem);
  return result;
}

export function buildNeighborReorderRequest<Item extends NeighborReorderItem>({
  activeId,
  items,
  overId,
}: BuildNeighborReorderRequestArgs<Item>): NeighborReorderRequest | null {
  if (activeId === overId) {
    return null;
  }

  const oldIndex = items.findIndex((item) => item.id === activeId);
  const newIndex = items.findIndex((item) => item.id === overId);
  if (oldIndex === -1 || newIndex === -1) {
    return null;
  }

  const reorderedItems = moveItem({
    items,
    fromIndex: oldIndex,
    toIndex: newIndex,
  });
  const movedIndex = reorderedItems.findIndex((item) => item.id === activeId);
  if (movedIndex === -1) {
    return null;
  }

  return {
    itemId: activeId,
    previousItemId: reorderedItems[movedIndex - 1]?.id ?? null,
    nextItemId: reorderedItems[movedIndex + 1]?.id ?? null,
  };
}

export function applyNeighborReorder<Item extends NeighborReorderItem>({
  items,
  request,
}: ApplyNeighborReorderArgs<Item>): Item[] {
  const movedIndex = items.findIndex((item) => item.id === request.itemId);
  if (movedIndex === -1) {
    return [...items];
  }

  const movedItem = items[movedIndex];
  if (!movedItem) {
    return [...items];
  }
  const remainingItems = items.filter((item) => item.id !== request.itemId);
  let insertIndex = 0;

  if (request.previousItemId !== null) {
    const previousIndex = remainingItems.findIndex(
      (item) => item.id === request.previousItemId,
    );
    if (previousIndex === -1) {
      return [...items];
    }
    insertIndex = previousIndex + 1;
  } else if (request.nextItemId !== null) {
    const nextIndex = remainingItems.findIndex(
      (item) => item.id === request.nextItemId,
    );
    if (nextIndex === -1) {
      return [...items];
    }
    insertIndex = nextIndex;
  }

  return [
    ...remainingItems.slice(0, insertIndex),
    movedItem,
    ...remainingItems.slice(insertIndex),
  ];
}
