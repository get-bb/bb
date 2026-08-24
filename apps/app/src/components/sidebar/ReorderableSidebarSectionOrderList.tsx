import { useCallback, type ReactNode } from "react";
import type { DragEndEvent } from "@dnd-kit/core";
import type { ConsumeDragClickSuppression } from "@/components/ui/use-drag-click-suppression";
import type { SidebarSectionId } from "./sidebarCollapsedAtoms";
import { SidebarSectionOrderList } from "./SidebarSectionOrderList";
import { reorderSidebarSectionOrder } from "@bb/client-core";
import { useSidebarReorderDnd } from "./useSidebarReorderDnd";

interface ReorderableSidebarSectionOrderListProps {
  children: (
    sectionId: SidebarSectionId,
    consumeClickSuppression: ConsumeDragClickSuppression,
  ) => ReactNode;
  onOrderChange: (order: SidebarSectionId[]) => void;
  order: readonly SidebarSectionId[];
  reorderOrder?: readonly SidebarSectionId[];
}

export function ReorderableSidebarSectionOrderList({
  children,
  onOrderChange,
  order,
  reorderOrder = order,
}: ReorderableSidebarSectionOrderListProps) {
  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      if (
        !event.over ||
        typeof event.active.id !== "string" ||
        typeof event.over.id !== "string"
      ) {
        return;
      }
      const nextOrder = reorderSidebarSectionOrder({
        activeId: event.active.id,
        overId: event.over.id,
        order: reorderOrder,
      });
      if (nextOrder) onOrderChange(nextOrder);
    },
    [onOrderChange, reorderOrder],
  );
  const { dndContextProps, consumeClickSuppression } = useSidebarReorderDnd({
    onDragEnd: handleDragEnd,
  });

  return (
    <SidebarSectionOrderList order={order} dndContextProps={dndContextProps}>
      {(sectionId) => children(sectionId, consumeClickSuppression)}
    </SidebarSectionOrderList>
  );
}
