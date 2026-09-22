import { useCallback, useMemo, useState } from "react";
import { flushSync } from "react-dom";
import type { DragEndEvent } from "@dnd-kit/core";
import {
  applyNeighborReorder,
  buildNeighborReorderRequest,
  type NeighborReorderRequest,
} from "@bb/client-core";

interface NeighborReorderSortableCallbacks {
  onSettled: () => void;
}

export interface UseNeighborReorderSortableArgs<Item> {
  disabled: boolean;
  getId: (item: Item) => string;
  items: readonly Item[];
  onReorder: (
    request: NeighborReorderRequest,
    callbacks: NeighborReorderSortableCallbacks,
  ) => void;
}

interface UseNeighborReorderSortableResult<Item> {
  handleDragEnd: (event: DragEndEvent) => void;
  itemIds: string[];
  renderedItems: readonly Item[];
}

export function useNeighborReorderSortable<Item>({
  disabled,
  getId,
  items,
  onReorder,
}: UseNeighborReorderSortableArgs<Item>): UseNeighborReorderSortableResult<Item> {
  const [optimisticOrder, setOptimisticOrder] = useState<string[] | null>(null);
  const renderedItems = useMemo(() => {
    if (!optimisticOrder) {
      return items;
    }

    const itemsById = new Map<string, Item>();
    for (const item of items) {
      itemsById.set(getId(item), item);
    }

    const orderedItems: Item[] = [];
    for (const id of optimisticOrder) {
      const item = itemsById.get(id);
      if (item === undefined) {
        return items;
      }
      orderedItems.push(item);
    }
    return orderedItems;
  }, [getId, items, optimisticOrder]);
  const itemIds = useMemo(
    () => renderedItems.map((item) => getId(item)),
    [getId, renderedItems],
  );
  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      if (disabled) {
        return;
      }

      const { active, over } = event;
      if (
        !over ||
        typeof active.id !== "string" ||
        typeof over.id !== "string"
      ) {
        return;
      }

      const orderItems = renderedItems.map((item) => ({ id: getId(item) }));
      const request = buildNeighborReorderRequest({
        activeId: active.id,
        overId: over.id,
        items: orderItems,
      });
      if (!request) {
        return;
      }

      const nextOrder = applyNeighborReorder({
        items: orderItems,
        request,
      }).map((item) => item.id);
      flushSync(() => {
        setOptimisticOrder(nextOrder);
      });
      onReorder(request, {
        onSettled: () => {
          setOptimisticOrder(null);
        },
      });
    },
    [disabled, getId, onReorder, renderedItems],
  );

  return {
    handleDragEnd,
    itemIds,
    renderedItems,
  };
}
