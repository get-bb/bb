import { memo } from "react";
import type { ProjectResponse } from "@bb/server-contract";
import { ProjectRow } from "./ProjectRow";
import type { ProjectRowProps, ProjectThreadListState } from "./ProjectRow";
import { useSidebarSortable } from "./sortableMotion";

export interface ProjectListRowModel {
  project: ProjectResponse;
  threadListState: ProjectThreadListState;
  isActive: boolean;
  isLocalPathInvalid: boolean;
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
