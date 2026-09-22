import type { ReactNode } from "react";
import type { ConsumeDragClickSuppression } from "../ui/use-drag-click-suppression.js";
import type { SidebarSectionId } from "@bb/client-core";
import { SidebarSectionOrderList } from "./SidebarSectionOrderList.js";
import { SectionThreadDndProvider } from "../dnd/SectionThreadDndContext.js";
import { SectionThreadDragOverlayPortal } from "./ProjectRow.js";
import type { SectionThreadDndState } from "../dnd/useSectionThreadDnd.js";

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
