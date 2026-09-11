import { useCallback, type ReactNode } from "react";
import type { DragEndEvent } from "@dnd-kit/core";
import type { ConsumeDragClickSuppression } from "@/components/ui/use-drag-click-suppression";
import type { SidebarSectionId } from "./sidebarCollapsedAtoms";
import { SidebarSectionOrderList } from "./SidebarSectionOrderList";
import { reorderSidebarSectionOrder } from "@bb/client-core";
import { useSidebarReorderDnd } from "./useSidebarReorderDnd";
import { SectionThreadDndProvider } from "./SectionThreadDndContext";
import { SectionThreadDragOverlayPortal } from "./ProjectRow";
import type { SectionThreadDndState } from "./useSectionThreadDnd";

interface ReorderableSidebarSectionOrderListProps {
  children: (
    sectionId: SidebarSectionId,
    consumeClickSuppression: ConsumeDragClickSuppression,
  ) => ReactNode;
  onOrderChange: (order: SidebarSectionId[]) => void;
  order: readonly SidebarSectionId[];
  reorderOrder?: readonly SidebarSectionId[];
  threadDnd?: SectionThreadDndState | null;
}

export function ReorderableSidebarSectionOrderList({
  children,
  onOrderChange,
  order,
  reorderOrder = order,
  threadDnd = null,
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

  if (threadDnd) {
    return (
      <SectionThreadDndProvider value={threadDnd}>
        <SidebarSectionOrderList
          order={order}
          dndContextProps={threadDnd.dndContextProps}
          trailing={
            <SectionThreadDragOverlayPortal
              activeThread={threadDnd.activeThread}
            />
          }
        >
          {(sectionId) =>
            children(sectionId, threadDnd.consumeClickSuppression)
          }
        </SidebarSectionOrderList>
      </SectionThreadDndProvider>
    );
  }

  return (
    <SidebarSectionOrderList order={order} dndContextProps={dndContextProps}>
      {(sectionId) => children(sectionId, consumeClickSuppression)}
    </SidebarSectionOrderList>
  );
}
