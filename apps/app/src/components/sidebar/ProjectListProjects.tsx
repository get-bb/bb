import { memo } from "react";
import { DndContext } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import type { ProjectResponse } from "@bb/server-contract";
import type { ConnectionAwareQueryStatus } from "@/hooks/queries/connection-aware-query-state";
import { EmptyState } from "@bb/shared-ui/empty-state";
import {
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuSkeleton,
} from "@/components/ui/sidebar.js";
import { ProjectRow } from "./ProjectRow";
import type { ProjectRowProps, ProjectThreadListState } from "./ProjectRow";
import type { ThreadComparator } from "./projectThreadGroups";
import { useSidebarSortable } from "./sortableMotion";
import type { SidebarReorderDndContextProps } from "./useSidebarReorderDnd";
import type { ConsumeDragClickSuppression } from "@/components/ui/use-drag-click-suppression";

/**
 * Per-project data the list renders, with the lifecycle/query lookups already
 * resolved by the caller. The presentational component never touches hooks, so
 * both the live sidebar and stories drive it from the same prop shape.
 */
export interface ProjectListRowModel {
  project: ProjectResponse;
  threadListState: ProjectThreadListState;
  isActive: boolean;
  isLocalPathInvalid: boolean;
}

/**
 * Container-owned drag-to-reorder plumbing. Present only when the live sidebar
 * wires up `useSidebarReorderDnd`; absent in stories and whenever there are too
 * few projects to reorder, in which case the rows render without a DnD context.
 */
export interface ProjectListReorderBindings {
  dndContextProps: SidebarReorderDndContextProps;
  itemIds: string[];
  disabled: boolean;
  consumeClickSuppression: ConsumeDragClickSuppression;
}

export interface ProjectListProjectsProps {
  status: ConnectionAwareQueryStatus;
  rows: ProjectListRowModel[];
  selectedThreadId?: string;
  collapsedProjectIds: Set<string>;
  collapsedThreadIds: Set<string>;
  collapsedEnvironmentIds: Set<string>;
  compareThreads: ThreadComparator;
  onProjectSelect?: () => void;
  onCreateProjectThread?: (projectId: string) => void;
  onToggleProjectCollapsed: (projectId: string) => void;
  onToggleThreadCollapsed: (threadId: string) => void;
  onToggleEnvironmentCollapsed: (environmentId: string) => void;
  reorder?: ProjectListReorderBindings;
}

interface SortableProjectRowProps extends ProjectRowProps {
  reorderDisabled: boolean;
}

const SortableProjectRow = memo(function SortableProjectRow({
  project,
  reorderDisabled,
  ...props
}: SortableProjectRowProps) {
  const { dragBindings, setNodeRef, style } = useSidebarSortable({
    id: project.id,
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

/**
 * Renders the Projects section body: loading skeletons, the project rows
 * (reorderable when {@link ProjectListProjectsProps.reorder} is supplied and
 * there is more than one), or the empty/unavailable state. Pure and
 * prop-driven — it owns no collapse state or queries, so the live sidebar
 * (`ProjectList`) and the `sidebar/Projects` stories share this exact path.
 */
export function ProjectListProjects({
  status,
  rows,
  selectedThreadId,
  collapsedProjectIds,
  collapsedThreadIds,
  collapsedEnvironmentIds,
  compareThreads,
  onProjectSelect,
  onCreateProjectThread,
  onToggleProjectCollapsed,
  onToggleThreadCollapsed,
  onToggleEnvironmentCollapsed,
  reorder,
}: ProjectListProjectsProps) {
  const sharedRowProps = (row: ProjectListRowModel) => ({
    project: row.project,
    threadListState: row.threadListState,
    selectedThreadId,
    isActive: row.isActive,
    isCollapsed: collapsedProjectIds.has(row.project.id),
    collapsedThreadIds,
    collapsedEnvironmentIds,
    compareThreads,
    isLocalPathInvalid: row.isLocalPathInvalid,
    onProjectSelect,
    onCreateProjectThread,
    onToggleProjectCollapsed,
    onToggleThreadCollapsed,
    onToggleEnvironmentCollapsed,
  });

  return (
    <SidebarMenu className="gap-1">
      {status === "loading" ? (
        <>
          <SidebarMenuSkeleton />
          <SidebarMenuSkeleton />
        </>
      ) : reorder && rows.length > 1 ? (
        <DndContext {...reorder.dndContextProps}>
          <SortableContext
            items={reorder.itemIds}
            strategy={verticalListSortingStrategy}
          >
            {rows.map((row) => (
              <SortableProjectRow
                key={row.project.id}
                {...sharedRowProps(row)}
                reorderDisabled={reorder.disabled}
                consumeProjectClickSuppression={reorder.consumeClickSuppression}
              />
            ))}
          </SortableContext>
        </DndContext>
      ) : rows.length > 0 ? (
        rows.map((row) => (
          <ProjectRow key={row.project.id} {...sharedRowProps(row)} />
        ))
      ) : (
        <SidebarMenuItem>
          <EmptyState
            message={
              status === "unavailable" ? "Projects unavailable" : "No projects"
            }
            icon="Folder"
            className="px-2 py-1.5"
            iconClassName="size-3.5 text-subtle-foreground/50"
            messageClassName="text-xs text-subtle-foreground/60"
          />
        </SidebarMenuItem>
      )}
    </SidebarMenu>
  );
}
