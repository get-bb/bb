import type { ReactNode } from "react";
import { DndContext } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import type { SidebarSectionId } from "./sidebarCollapsedAtoms";
import type { ReorderDndContextProps } from "@/components/ui/useReorderDnd";

interface SidebarSectionOrderListProps {
  children: (sectionId: SidebarSectionId) => ReactNode;
  dndContextProps?: ReorderDndContextProps;
  order: readonly SidebarSectionId[];
  trailing?: ReactNode;
}

export function SidebarSectionOrderList({
  children,
  dndContextProps,
  order,
  trailing,
}: SidebarSectionOrderListProps) {
  const content = (
    <SortableContext items={[...order]} strategy={verticalListSortingStrategy}>
      <div className="space-y-4">{order.map(children)}</div>
    </SortableContext>
  );

  return dndContextProps ? (
    <DndContext {...dndContextProps}>
      {content}
      {trailing}
    </DndContext>
  ) : (
    content
  );
}
