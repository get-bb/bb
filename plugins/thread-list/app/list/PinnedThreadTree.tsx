import { memo, useCallback, useMemo, type CSSProperties } from "react";
import { DndContext, useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import type { NeighborReorderRequest } from "../model/neighbor-reorder.js";
import {
  PinnedEnvironmentThreadGroupRow,
  ThreadTreeNodeRow,
} from "./ProjectRow.js";
import {
  useSidebarSortable,
  type SidebarSortableDragBindings,
} from "../rows/sortableMotion.js";
import { useSidebarReorderDnd } from "../dnd/useSidebarReorderDnd.js";
import type {
  ProjectThreadItem,
  ProjectThreadNode,
} from "../model/project-thread-groups.js";
import {
  useNeighborReorderSortable,
  type UseNeighborReorderSortableArgs,
} from "../dnd/useNeighborReorderSortable.js";
import { useChronologicalSectionThreadDnd } from "../dnd/SectionThreadDndContext.js";
import {
  PINNED_THREAD_PARENT_KEY,
  type SectionThreadDndState,
} from "../dnd/useSectionThreadDnd.js";

interface PinnedThreadRootReorderCallbacks {
  onSettled: () => void;
}

export interface PinnedThreadTreeProps {
  rootItems: readonly ProjectThreadItem[];
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
  displace?: boolean;
  node: ProjectThreadNode;
  onProjectSelect?: () => void;
  onToggleEnvironmentCollapsed: (environmentId: string) => void;
  onToggleThreadCollapsed: (threadId: string) => void;
  sectionDnd?: SectionThreadDndState | null;
  selectedThreadId?: string;
}

interface PinnedRootItemProps extends Omit<
  SortablePinnedRootItemProps,
  "disabled" | "displace"
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
  sectionDnd,
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
      sectionDnd={sectionDnd}
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
  displace = true,
  node,
  ...props
}: SortablePinnedRootItemProps) {
  const { dragBindings, setNodeRef, style } = useSidebarSortable({
    id: getPinnedRootNodeId(node),
    disabled,
    displace,
  });
  const sortableStyle: CSSProperties =
    props.sectionDnd?.activeThread?.id === getPinnedRootNodeId(node)
      ? { ...style, opacity: 0.35, pointerEvents: "none" }
      : style;

  return (
    <PinnedRootItem
      {...props}
      node={node}
      dragBindings={dragBindings}
      sortableRef={setNodeRef}
      sortableStyle={sortableStyle}
    />
  );
});

interface PinnedGroupedRootItemsProps {
  rootItems: readonly ProjectThreadItem[];
  selectedThreadId?: string;
  collapsedThreadIds: Set<string>;
  collapsedEnvironmentIds: Set<string>;
  onProjectSelect?: () => void;
  onToggleThreadCollapsed: (threadId: string) => void;
  onToggleEnvironmentCollapsed: (environmentId: string) => void;
  consumeClickSuppression?: () => boolean;
  sectionDnd?: SectionThreadDndState;
}

const PinnedGroupedRootItems = memo(function PinnedGroupedRootItems({
  rootItems,
  selectedThreadId,
  collapsedThreadIds,
  collapsedEnvironmentIds,
  onProjectSelect,
  onToggleThreadCollapsed,
  onToggleEnvironmentCollapsed,
  consumeClickSuppression,
  sectionDnd,
}: PinnedGroupedRootItemsProps) {
  return rootItems.map((item) => {
    if (item.kind === "environment") {
      return (
        <PinnedEnvironmentThreadGroupRow
          key={`environment:${item.group.environmentId}`}
          group={item.group}
          selectedThreadId={selectedThreadId}
          collapsedThreadIds={collapsedThreadIds}
          collapsedEnvironmentIds={collapsedEnvironmentIds}
          onProjectSelect={onProjectSelect}
          onToggleThreadCollapsed={onToggleThreadCollapsed}
          onToggleEnvironmentCollapsed={onToggleEnvironmentCollapsed}
        />
      );
    }
    if (item.kind === "section") return null;
    const commonProps = {
      node: item.node,
      selectedThreadId,
      collapsedThreadIds,
      collapsedEnvironmentIds,
      onProjectSelect,
      onToggleThreadCollapsed,
      onToggleEnvironmentCollapsed,
    };
    return sectionDnd ? (
      <SortablePinnedRootItem
        key={getPinnedRootNodeId(item.node)}
        {...commonProps}
        disabled={sectionDnd.pinnedReorderPending}
        displace={false}
        sectionDnd={sectionDnd}
      />
    ) : (
      <PinnedRootItem
        key={getPinnedRootNodeId(item.node)}
        {...commonProps}
        consumeClickSuppression={consumeClickSuppression}
      />
    );
  });
});

export const PinnedThreadTree = memo(function PinnedThreadTree({
  rootItems,
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
  const hasEnvironmentGroups = rootItems.some(
    (item) => item.kind === "environment",
  );
  const { setNodeRef: setPinnedParentRef } = useDroppable({
    id: PINNED_THREAD_PARENT_KEY,
    disabled: chronologicalDnd === null,
  });

  if (rootItems.length === 0) {
    return null;
  }

  if (chronologicalDnd) {
    return (
      <div
        ref={setPinnedParentRef}
        data-sidebar-sticky-section=""
        className="relative space-y-0.5"
        onClickCapture={chronologicalDnd.onClickCapture}
      >
        <SortableContext
          items={[...chronologicalDnd.pinnedItemIds]}
          strategy={verticalListSortingStrategy}
        >
          {hasEnvironmentGroups ? (
            <PinnedGroupedRootItems
              rootItems={rootItems}
              sectionDnd={chronologicalDnd}
              selectedThreadId={selectedThreadId}
              collapsedThreadIds={collapsedThreadIds}
              collapsedEnvironmentIds={collapsedEnvironmentIds}
              onProjectSelect={onProjectSelect}
              onToggleThreadCollapsed={onToggleThreadCollapsed}
              onToggleEnvironmentCollapsed={onToggleEnvironmentCollapsed}
            />
          ) : (
            chronologicalRootNodes.map((node) => (
              <SortablePinnedRootItem
                key={getPinnedRootNodeId(node)}
                node={node}
                disabled={chronologicalDnd.pinnedReorderPending}
                displace={false}
                sectionDnd={chronologicalDnd}
                selectedThreadId={selectedThreadId}
                collapsedThreadIds={collapsedThreadIds}
                collapsedEnvironmentIds={collapsedEnvironmentIds}
                onProjectSelect={onProjectSelect}
                onToggleThreadCollapsed={onToggleThreadCollapsed}
                onToggleEnvironmentCollapsed={onToggleEnvironmentCollapsed}
              />
            ))
          )}
        </SortableContext>
      </div>
    );
  }

  return (
    <div
      data-sidebar-sticky-section=""
      className="relative space-y-0.5"
      onClickCapture={onClickCapture}
    >
      {hasEnvironmentGroups ? (
        <PinnedGroupedRootItems
          rootItems={rootItems}
          selectedThreadId={selectedThreadId}
          collapsedThreadIds={collapsedThreadIds}
          collapsedEnvironmentIds={collapsedEnvironmentIds}
          onProjectSelect={onProjectSelect}
          onToggleThreadCollapsed={onToggleThreadCollapsed}
          onToggleEnvironmentCollapsed={onToggleEnvironmentCollapsed}
          consumeClickSuppression={consumeClickSuppression}
        />
      ) : renderedRootNodes.length > 1 ? (
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
