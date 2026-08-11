import { useCallback, type ReactNode } from "react";
import type {
  CollisionDetection,
  DragEndEvent,
  DragOverEvent,
  DragStartEvent,
  Modifier,
} from "@dnd-kit/core";
import type { ConsumeDragClickSuppression } from "@/components/ui/use-drag-click-suppression";
import type { SidebarSectionId } from "./sidebarCollapsedAtoms";
import { SidebarSectionOrderList } from "./SidebarSectionOrderList";
import { reorderSidebarSectionOrder } from "./sidebarSectionOrder";
import { useSidebarReorderDnd } from "./useSidebarReorderDnd";

interface ReorderableSidebarSectionOrderListProps {
  children: (
    sectionId: SidebarSectionId,
    consumeClickSuppression: ConsumeDragClickSuppression,
  ) => ReactNode;
  dragOverlay?: ReactNode;
  onOrderChange: (order: SidebarSectionId[]) => void;
  order: readonly SidebarSectionId[];
  reorderOrder?: readonly SidebarSectionId[];
  onDragStart?: (event: DragStartEvent) => void;
  onDragOver?: (event: DragOverEvent) => void;
  onDragCancel?: () => void;
  onDragEnd?: (event: DragEndEvent) => void;
  collisionDetection?: CollisionDetection;
  modifiers?: Modifier[];
}

export function ReorderableSidebarSectionOrderList({
  children,
  dragOverlay,
  onOrderChange,
  order,
  reorderOrder = order,
  onDragStart,
  onDragOver,
  onDragCancel,
  onDragEnd,
  collisionDetection,
  modifiers,
}: ReorderableSidebarSectionOrderListProps) {
  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      onDragEnd?.(event);
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
    [onDragEnd, onOrderChange, reorderOrder],
  );
  const { dndContextProps, consumeClickSuppression } = useSidebarReorderDnd({
    onDragEnd: handleDragEnd,
    onDragStart,
    onDragOver,
    onDragCancel,
    collisionDetection,
    modifiers,
  });

  return (
    <SidebarSectionOrderList
      order={order}
      dndContextProps={dndContextProps}
      dragOverlay={dragOverlay}
    >
      {(sectionId) => children(sectionId, consumeClickSuppression)}
    </SidebarSectionOrderList>
  );
}
