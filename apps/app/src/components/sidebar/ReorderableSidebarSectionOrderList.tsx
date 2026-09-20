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
  footer?: ReactNode;
}

export function ReorderableSidebarSectionOrderList({
  children,
  order,
  threadDnd,
  footer,
}: ReorderableSidebarSectionOrderListProps) {
  if (!threadDnd) {
    return (
      <SidebarSectionOrderList order={order} trailing={footer}>
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
          <>
            {footer}
            <SectionThreadDragOverlayPortal
              activeThread={threadDnd.activeThread}
            />
          </>
        }
      >
        {(sectionId) => children(sectionId, threadDnd.consumeClickSuppression)}
      </SidebarSectionOrderList>
    </SectionThreadDndProvider>
  );
}
