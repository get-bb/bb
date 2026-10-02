import { memo } from "react";
import type { SidebarProject } from "../model/use-sidebar-data.js";
import { ProjectRow } from "./ProjectRow.js";
import type { ProjectRowProps, ProjectThreadListState } from "./ProjectRow.js";
import { useSidebarSortable } from "../rows/sortableMotion.js";

export interface ProjectListRowModel {
  project: SidebarProject;
  threadListState: ProjectThreadListState;
  isActive: boolean;
}

interface SortableProjectRowProps extends ProjectRowProps {
  reorderDisabled: boolean;
  sortableId: string;
}

export const SortableProjectRow = memo(function SortableProjectRow({
  project,
  reorderDisabled,
  sortableId,
  ...props
}: SortableProjectRowProps) {
  const { dragBindings, setNodeRef, style } = useSidebarSortable({
    id: sortableId,
    disabled: reorderDisabled,
  });

  return (
    <ProjectRow
      {...props}
      project={project}
      projectDragBindings={dragBindings}
      projectRowRef={setNodeRef}
      projectRowStyle={style}
    />
  );
});
