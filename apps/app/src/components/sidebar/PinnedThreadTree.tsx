import { memo, useCallback, useMemo, type CSSProperties } from "react";
import { DndContext, useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import type { NeighborReorderRequest } from "@bb/client-core";
import { DropPreviewRow, ThreadTreeNodeRow } from "./ProjectRow";
import {
  useSidebarSortable,
  type SidebarSortableDragBindings,
} from "./sortableMotion";
import { useSidebarReorderDnd } from "./useSidebarReorderDnd";
import type { ProjectThreadNode } from "@bb/client-core";
import {
  useNeighborReorderSortable,
  type UseNeighborReorderSortableArgs,
} from "./useNeighborReorderSortable";
import { useChronologicalSectionThreadDnd } from "./SectionThreadDndContext";
import { PINNED_THREAD_PARENT_KEY } from "./useSectionThreadDnd";

interface PinnedThreadRootReorderCallbacks {
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
  dragBindings?: SidebarSortableDragBindings;
  sortableRef?: (element: HTMLDivElement | null) => void;
  sortableStyle?: CSSProperties;
}

function getPinnedRootNodeId(node: ProjectThreadNode): string {
  return node.thread.id;
}

const PinnedRootItem = memo(function PinnedRootItem({
  collapsedEnvironmentIds,
  collapsedThreadIds,
  consumeClickSuppression,
  dragBindings,
  node,
  onProjectSelect,
  onToggleEnvironmentCollapsed,
  onToggleThreadCollapsed,
  selectedThreadId,
  sortableRef,
  sortableStyle,
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
      dragBindings={dragBindings}
      sortableRef={sortableRef}
      sortableStyle={sortableStyle}
    />
  );
});

const SortablePinnedRootItem = memo(function SortablePinnedRootItem({
  disabled,
  node,
  ...props
}: SortablePinnedRootItemProps) {
  const { dragBindings, setNodeRef, style } = useSidebarSortable({
    id: getPinnedRootNodeId(node),
    disabled,
  });

  return (
    <PinnedRootItem
      {...props}
      node={node}
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
  const chronologicalDnd = useChronologicalSectionThreadDnd();
  const handleReorderPinnedRoot = useCallback<
    UseNeighborReorderSortableArgs<ProjectThreadNode>["onReorder"]
  >(
    (request, callbacks) => {
      onReorderPinnedRoot?.(request, callbacks);
    },
    [onReorderPinnedRoot],
  );
  const standaloneReorderDisabled =
    isPinnedReorderPending || !onReorderPinnedRoot || rootNodes.length < 2;
  const {
    handleDragEnd: handleSortableDragEnd,
    itemIds: renderedRootNodeIds,
    renderedItems: renderedRootNodes,
  } = useNeighborReorderSortable({
    disabled: chronologicalDnd !== null || standaloneReorderDisabled,
    getId: getPinnedRootNodeId,
    items: rootNodes,
    onReorder: handleReorderPinnedRoot,
  });
  const { dndContextProps, consumeClickSuppression, onClickCapture } =
    useSidebarReorderDnd({ onDragEnd: handleSortableDragEnd });
  const chronologicalRootNodes = useMemo(() => {
    if (!chronologicalDnd) return rootNodes;
    const nodesById = new Map(
      rootNodes.map((node) => [getPinnedRootNodeId(node), node]),
    );
    const orderedNodes: ProjectThreadNode[] = [];
    for (const id of chronologicalDnd.pinnedItemIds) {
      const node = nodesById.get(id);
      if (!node) return rootNodes;
      orderedNodes.push(node);
    }
    return orderedNodes;
  }, [chronologicalDnd, rootNodes]);
  const { setNodeRef: setPinnedParentRef } = useDroppable({
    id: PINNED_THREAD_PARENT_KEY,
    disabled: chronologicalDnd === null,
  });

  if (renderedRootNodes.length === 0) {
    return null;
  }

  if (chronologicalDnd) {
    const showDropPreview =
      chronologicalDnd.dragOverParentKey === PINNED_THREAD_PARENT_KEY;
    return (
      <div
        ref={setPinnedParentRef}
        data-sidebar-sticky-section=""
        className="relative space-y-0.5 group-data-[collapsible=icon]:hidden"
        onClickCapture={chronologicalDnd.onClickCapture}
      >
        <SortableContext
          items={[...chronologicalDnd.pinnedItemIds]}
          strategy={verticalListSortingStrategy}
        >
          {chronologicalRootNodes.map((node) => (
            <SortablePinnedRootItem
              key={getPinnedRootNodeId(node)}
              node={node}
              disabled={chronologicalDnd.pinnedReorderPending}
              selectedThreadId={selectedThreadId}
              collapsedThreadIds={collapsedThreadIds}
              collapsedEnvironmentIds={collapsedEnvironmentIds}
              onProjectSelect={onProjectSelect}
              onToggleThreadCollapsed={onToggleThreadCollapsed}
              onToggleEnvironmentCollapsed={onToggleEnvironmentCollapsed}
            />
          ))}
        </SortableContext>
        <DropPreviewRow depth={0} visible={showDropPreview} />
      </div>
    );
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
                disabled={standaloneReorderDisabled}
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
