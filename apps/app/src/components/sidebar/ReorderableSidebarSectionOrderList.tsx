import type { ReactNode } from "react";
import type { ConsumeDragClickSuppression } from "@/components/ui/use-drag-click-suppression";
import type { SidebarSectionId } from "./sidebarCollapsedAtoms";
import { SidebarSectionOrderList } from "./SidebarSectionOrderList";
import { SectionThreadDndProvider } from "./SectionThreadDndContext";
import { SectionThreadDragOverlayPortal } from "./ProjectRow";
import type { SectionThreadDndState } from "./useSectionThreadDnd";

interface ReorderableSidebarSectionOrderListProps {
  children: (
    sectionId: SidebarSectionId,
    consumeClickSuppression: ConsumeDragClickSuppression,
  ) => ReactNode;
  order: readonly SidebarSectionId[];
  threadDnd: SectionThreadDndState | null;
}

export function ReorderableSidebarSectionOrderList({
  children,
  order,
  threadDnd,
}: ReorderableSidebarSectionOrderListProps) {
  if (!threadDnd) {
    return (
      <SidebarSectionOrderList order={order}>
        {(sectionId) => children(sectionId, () => false)}
      </SidebarSectionOrderList>
    );
  }

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
        {(sectionId) => children(sectionId, threadDnd.consumeClickSuppression)}
      </SidebarSectionOrderList>
    </SectionThreadDndProvider>
  );
}
