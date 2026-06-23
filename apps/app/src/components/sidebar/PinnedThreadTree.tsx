import { memo, useCallback } from "react";
import { DndContext } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import type { NeighborReorderRequest } from "@/lib/neighbor-reorder";
import { ThreadTreeNodeRow } from "./ProjectRow";
import { useSidebarSortable } from "./sortableMotion";
import { useSidebarReorderDnd } from "./useSidebarReorderDnd";
import type { ProjectThreadNode } from "./projectThreadGroups";
import {
  useNeighborReorderSortable,
  type UseNeighborReorderSortableArgs,
} from "./useNeighborReorderSortable";

export interface PinnedThreadRootReorderCallbacks {
  onSettled: () => void;
}

export interface PinnedThreadTreeProps {
  rootNodes: readonly ProjectThreadNode[];
  selectedThreadId?: string;
  collapsedThreadIds: Set<string>;
  collapsedEnvironmentIds: Set<string>;
  onProjectSelect?: () => void;
  onToggleThreadCollapsed: (threadId: string) => void;
  onToggleEnvironmentCollapsed: (environmentId: string) => void;
  isPinnedReorderPending?: boolean;
  onReorderPinnedRoot?: (
    request: NeighborReorderRequest,
    callbacks: PinnedThreadRootReorderCallbacks,
  ) => void;
}

interface SortablePinnedRootItemProps {
  collapsedEnvironmentIds: Set<string>;
  collapsedThreadIds: Set<string>;
  disabled: boolean;
  node: ProjectThreadNode;
  onProjectSelect?: () => void;
  onToggleEnvironmentCollapsed: (environmentId: string) => void;
  onToggleThreadCollapsed: (threadId: string) => void;
  selectedThreadId?: string;
}

interface PinnedRootItemProps extends Omit<
  SortablePinnedRootItemProps,
  "disabled"
> {
  consumeClickSuppression?: () => boolean;
}

function getPinnedRootNodeId(node: ProjectThreadNode): string {
  return node.thread.id;
}

const PinnedRootItem = memo(function PinnedRootItem({
  collapsedEnvironmentIds,
  collapsedThreadIds,
  consumeClickSuppression,
  node,
  onProjectSelect,
  onToggleEnvironmentCollapsed,
  onToggleThreadCollapsed,
  selectedThreadId,
}: PinnedRootItemProps) {
  return (
    <ThreadTreeNodeRow
      projectId={node.thread.projectId}
      node={node}
      depthOffset={0}
      isEnvGrouped={false}
      selectedThreadId={selectedThreadId}
      collapsedThreadIds={collapsedThreadIds}
      collapsedEnvironmentIds={collapsedEnvironmentIds}
      variant="section"
      onProjectSelect={onProjectSelect}
      onToggleThreadCollapsed={onToggleThreadCollapsed}
      onToggleEnvironmentCollapsed={onToggleEnvironmentCollapsed}
      consumeClickSuppression={consumeClickSuppression}
    />
  );
});

const SortablePinnedRootItem = memo(function SortablePinnedRootItem({
  collapsedEnvironmentIds,
  collapsedThreadIds,
  disabled,
  node,
  onProjectSelect,
  onToggleEnvironmentCollapsed,
  onToggleThreadCollapsed,
  selectedThreadId,
}: SortablePinnedRootItemProps) {
  const { dragBindings, setNodeRef, style } = useSidebarSortable({
    id: getPinnedRootNodeId(node),
    disabled,
  });

  return (
    <ThreadTreeNodeRow
      projectId={node.thread.projectId}
      node={node}
      depthOffset={0}
      isEnvGrouped={false}
      selectedThreadId={selectedThreadId}
      collapsedThreadIds={collapsedThreadIds}
      collapsedEnvironmentIds={collapsedEnvironmentIds}
      variant="section"
      onProjectSelect={onProjectSelect}
      onToggleThreadCollapsed={onToggleThreadCollapsed}
      onToggleEnvironmentCollapsed={onToggleEnvironmentCollapsed}
      dragBindings={dragBindings}
      sortableRef={setNodeRef}
      sortableStyle={style}
    />
  );
});

export const PinnedThreadTree = memo(function PinnedThreadTree({
  rootNodes,
  selectedThreadId,
  collapsedThreadIds,
  collapsedEnvironmentIds,
  onProjectSelect,
  onToggleThreadCollapsed,
  onToggleEnvironmentCollapsed,
  isPinnedReorderPending = false,
  onReorderPinnedRoot,
}: PinnedThreadTreeProps) {
  const handleReorderPinnedRoot = useCallback<
    UseNeighborReorderSortableArgs<ProjectThreadNode>["onReorder"]
  >(
    (request, callbacks) => {
      onReorderPinnedRoot?.(request, callbacks);
    },
    [onReorderPinnedRoot],
  );
  const reorderDisabled =
    isPinnedReorderPending || !onReorderPinnedRoot || rootNodes.length < 2;
  const {
    handleDragEnd: handleSortableDragEnd,
    itemIds: renderedRootNodeIds,
    renderedItems: renderedRootNodes,
  } = useNeighborReorderSortable({
    disabled: reorderDisabled,
    getId: getPinnedRootNodeId,
    items: rootNodes,
    onReorder: handleReorderPinnedRoot,
  });
  const { dndContextProps, consumeClickSuppression, onClickCapture } =
    useSidebarReorderDnd({ onDragEnd: handleSortableDragEnd });

  if (renderedRootNodes.length === 0) {
    return null;
  }

  return (
    <div
      data-sidebar-sticky-section=""
      className="relative space-y-0.5 group-data-[collapsible=icon]:hidden"
      onClickCapture={onClickCapture}
    >
      {renderedRootNodes.length > 1 ? (
        <DndContext {...dndContextProps}>
          <SortableContext
            items={renderedRootNodeIds}
            strategy={verticalListSortingStrategy}
          >
            {renderedRootNodes.map((node) => (
              <SortablePinnedRootItem
                key={getPinnedRootNodeId(node)}
                node={node}
                disabled={reorderDisabled}
                selectedThreadId={selectedThreadId}
                collapsedThreadIds={collapsedThreadIds}
                collapsedEnvironmentIds={collapsedEnvironmentIds}
                onProjectSelect={onProjectSelect}
                onToggleThreadCollapsed={onToggleThreadCollapsed}
                onToggleEnvironmentCollapsed={onToggleEnvironmentCollapsed}
              />
            ))}
          </SortableContext>
        </DndContext>
      ) : (
        renderedRootNodes.map((node) => (
          <PinnedRootItem
            key={getPinnedRootNodeId(node)}
            node={node}
            selectedThreadId={selectedThreadId}
            collapsedThreadIds={collapsedThreadIds}
            collapsedEnvironmentIds={collapsedEnvironmentIds}
            onProjectSelect={onProjectSelect}
            onToggleThreadCollapsed={onToggleThreadCollapsed}
            onToggleEnvironmentCollapsed={onToggleEnvironmentCollapsed}
            consumeClickSuppression={consumeClickSuppression}
          />
        ))
      )}
    </div>
  );
});
