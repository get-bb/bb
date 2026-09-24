import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEventHandler,
} from "react";
import { useSetAtom } from "jotai";
import { toast } from "sonner";
import {
  MeasuringStrategy,
  type ClientRect,
  type Collision,
  type CollisionDetection,
  type DragEndEvent,
  type DragMoveEvent,
  type DragOverEvent,
  type DragStartEvent,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import type { SidebarThread } from "../model/sidebar-thread.js";
import {
  experimental_useSidebarThreadActions,
  useSdk,
} from "@get-bb/plugin-sdk/app";
import type { NeighborReorderRequest } from "../model/neighbor-reorder.js";
import {
  getSidebarDndItemId,
  getProjectThreadItemDescendants,
  type ProjectThreadItem,
  type ProjectThreadNode,
} from "../model/project-thread-groups.js";
import type { SidebarSectionId } from "../model/sidebar-section-id.js";
import {
  buildSidebarEntitySectionId,
  reorderSidebarSectionOrder,
} from "../model/sidebar-section-order.js";
import { sidebarCollapsedThreadSectionsAtom } from "../preferences/atoms.js";
import { useSidebarReorderDnd } from "./useSidebarReorderDnd.js";
import {
  reorderCollisionDetection,
  type ReorderDndContextProps,
} from "../ui/useReorderDnd.js";
import type { ConsumeDragClickSuppression } from "../ui/use-drag-click-suppression.js";
import { useNeighborReorderSortable } from "./useNeighborReorderSortable.js";
import {
  getSidebarThreadRowDroppableId,
  parseSidebarThreadRowDroppableId,
  type SidebarNestTargetState,
  type SidebarReorderPlacement,
} from "../rows/sidebarThreadRowDroppable.js";

export const PINNED_THREAD_PARENT_KEY = "sidebar:pinned-threads";
export const NEST_BAND_FRACTION = 0.7;
export const NEST_BAND_ARMED_FRACTION = 1;
export const NEST_CANCEL_OFFSET_PX = 12;
export const NEST_HOVER_DELAY_MS = 200;

const SECTION_THREAD_DROPPABLE_MEASURING = {
  droppable: { strategy: MeasuringStrategy.WhileDragging, frequency: 16 },
};

function isPointerWithinSidebar(
  pointerCoordinates: { x: number; y: number } | null,
): boolean {
  if (
    pointerCoordinates === null ||
    typeof document.elementsFromPoint !== "function"
  ) {
    return true;
  }
  return document
    .elementsFromPoint(pointerCoordinates.x, pointerCoordinates.y)
    .some((element) => element.closest('[data-sidebar="sidebar"]') !== null);
}

export interface SectionThreadNestTarget {
  threadId: string;
  state: SidebarNestTargetState;
}

export interface SectionThreadReorderTarget {
  threadId: string;
  placement: SidebarReorderPlacement;
}

export interface SectionThreadDndState {
  activeItemId: string | null;
  activeThread: SidebarThread | null;
  consumeClickSuppression: ConsumeDragClickSuppression;
  dndContextProps: ReorderDndContextProps;
  itemIdsByParentKey: ReadonlyMap<string, readonly string[]>;
  onClickCapture: MouseEventHandler<HTMLElement>;
  dragOverParentKey: string | null;
  unchangedParentKey: string | null;
  nestTarget: SectionThreadNestTarget | null;
  nestPreviewBeforeKey: string | null;
  reorderTarget: SectionThreadReorderTarget | null;
  pinnedItemIds: readonly string[];
  pinnedReorderPending: boolean;
}

interface UseSectionThreadDndArgs {
  containerId: string;
  enabled: boolean;
  rootItems: readonly ProjectThreadItem[];
  topLevelSectionOrder: readonly SidebarSectionId[];
  onTopLevelSectionOrderChange: (order: SidebarSectionId[]) => void;
  onExpandThread?: (threadId: string) => void;
  groups?: boolean;
  pinnedReorderPending: boolean;
  pinnedThreads: readonly SidebarThread[];
  pinnedRootItems?: readonly ProjectThreadItem[];
  pinnedRootNodes?: readonly ProjectThreadNode[];
  onReorderPinnedThread: (
    request: NeighborReorderRequest,
    callbacks: { onSettled: () => void },
  ) => void;
}

interface SectionThreadDndLookup {
  groupThreadsByItemId: Map<string, SidebarThread[]>;
  rootThreadIdsByItemId: Map<string, string[]>;
  pinnedThreadIds: string[];
  sectionParentKeyBySectionId: Map<string, string>;
  sectionSectionIdByParentKey: Map<string, SidebarSectionId>;
  sectionIdByParentKey: Map<string, string | null>;
  itemIdsByParentKey: Map<string, string[]>;
  itemKindById: Map<string, ProjectThreadItem["kind"]>;
  parentKeyByItemId: Map<string, string>;
  threadByItemId: Map<string, SidebarThread>;
  nodeByItemId: Map<string, ProjectThreadNode>;
  nestParentIdByItemId: Map<string, string>;
}

interface SectionThreadUpdate {
  threadId: string;
  parentThreadId?: string | null;
  sectionId?: string | null;
}

interface SectionThreadDropChanges {
  activeId: string;
  threadIds: string[];
  unpinThreadIds: string[];
  updates: SectionThreadUpdate[];
  pinThreadIds: string[];
}

export type SectionThreadDropDecision =
  | ({ kind: "move"; toParentKey: string } & SectionThreadDropChanges)
  | ({ kind: "nest"; parentThreadId: string } & SectionThreadDropChanges)
  | ({ kind: "pin" } & SectionThreadDropChanges)
  | { kind: "reorder-pinned"; activeId: string; overId: string }
  | {
      kind: "rejected";
      activeId: string;
      overThreadId: string;
      reason: "own-subtree" | "already-child";
    }
  | { kind: "unchanged"; activeId: string; toParentKey: string };

interface ThreadRowPointerInfo {
  threadId: string;
  relativeY: number;
  nesting: boolean;
}

interface ResolvedThreadRowInfo {
  threadId: string;
  rect: ClientRect;
  retaining: boolean;
}

interface ResolveThreadRowNestCollisionsArgs {
  collisions: Collision[];
  droppableRects: ReadonlyMap<UniqueIdentifier, ClientRect>;
  pointerCoordinates: { x: number; y: number } | null;
  getBandFraction: (threadId: string) => number | null;
  retainedRect?: ClientRect | null;
  retainedThreadId?: string | null;
  onRowPointer?: (info: ThreadRowPointerInfo) => void;
  onResolvedRow?: (info: ResolvedThreadRowInfo) => void;
  holdNestCandidate?: (threadId: string | null) => boolean;
}

interface NestHoverCandidate {
  threadId: string;
}

interface RetainedNestTarget {
  threadId: string;
  rect: ClientRect;
}

type RowDropState = SectionThreadNestTarget;

interface CollectSectionThreadDndLookupOptions {
  groups?: boolean;
  pinnedRootItems?: readonly ProjectThreadItem[];
}

function parseGroupSectionId(key: string): SidebarSectionId {
  if (key === "pinned" || key === "threads") return key;
  if (
    key.startsWith("project:") ||
    key.startsWith("section:") ||
    key.startsWith("machine:")
  ) {
    return key as SidebarSectionId;
  }
  return buildSidebarEntitySectionId("section", key);
}

export function collectSectionThreadDndLookup(
  items: readonly ProjectThreadItem[],
  containerId: string,
  pinnedThreads: readonly SidebarThread[] = [],
  pinnedRootNodes: readonly ProjectThreadNode[] = [],
  options: CollectSectionThreadDndLookupOptions = {},
): SectionThreadDndLookup {
  const lookup: SectionThreadDndLookup = {
    groupThreadsByItemId: new Map(),
    rootThreadIdsByItemId: new Map(),
    pinnedThreadIds: pinnedThreads.map((thread) => thread.id),
    sectionParentKeyBySectionId: new Map([
      ["threads", containerId],
      ["pinned", PINNED_THREAD_PARENT_KEY],
    ]),
    sectionSectionIdByParentKey: new Map([
      [containerId, "threads"],
      [PINNED_THREAD_PARENT_KEY, "pinned"],
    ]),
    sectionIdByParentKey: new Map([[containerId, null]]),
    itemIdsByParentKey: new Map([
      [PINNED_THREAD_PARENT_KEY, pinnedThreads.map((thread) => thread.id)],
    ]),
    itemKindById: new Map(),
    parentKeyByItemId: new Map(),
    threadByItemId: new Map(),
    nodeByItemId: new Map(),
    nestParentIdByItemId: new Map(),
  };

  const registerNode = (
    node: ProjectThreadNode,
    parentKey: string,
    nestParentId?: string,
  ) => {
    const threadId = node.thread.id;
    lookup.itemKindById.set(threadId, "thread");
    lookup.parentKeyByItemId.set(threadId, parentKey);
    lookup.threadByItemId.set(threadId, node.thread);
    lookup.nodeByItemId.set(threadId, node);
    if (nestParentId) lookup.nestParentIdByItemId.set(threadId, nestParentId);
    registerNestedChildren(node, parentKey);
  };
  const registerEnvironment = (
    item: Extract<ProjectThreadItem, { kind: "environment" }>,
    parentKey: string,
    nestParentId?: string,
  ) => {
    const itemId = getSidebarDndItemId(item);
    lookup.itemKindById.set(itemId, "environment");
    lookup.parentKeyByItemId.set(itemId, parentKey);
    lookup.groupThreadsByItemId.set(
      itemId,
      getProjectThreadItemDescendants([item]),
    );
    lookup.rootThreadIdsByItemId.set(
      itemId,
      item.group.nodes.map((node) => node.thread.id),
    );
    lookup.threadByItemId.set(itemId, item.group.nodes[0].thread);
    for (const node of item.group.nodes)
      registerNode(node, parentKey, nestParentId);
  };
  const registerNestedChildren = (
    node: ProjectThreadNode,
    parentKey: string,
  ) => {
    for (const child of node.children) {
      if (child.kind === "thread")
        registerNode(child.node, parentKey, node.thread.id);
      else if (child.kind === "environment")
        registerEnvironment(child, parentKey, node.thread.id);
    }
  };

  for (const thread of pinnedThreads) {
    lookup.itemKindById.set(thread.id, "thread");
    lookup.parentKeyByItemId.set(thread.id, PINNED_THREAD_PARENT_KEY);
    lookup.threadByItemId.set(thread.id, thread);
  }
  for (const node of pinnedRootNodes) {
    lookup.nodeByItemId.set(node.thread.id, node);
    registerNestedChildren(node, PINNED_THREAD_PARENT_KEY);
  }

  const walk = (
    siblingItems: readonly ProjectThreadItem[],
    parentKey: string,
  ) => {
    lookup.itemIdsByParentKey.set(
      parentKey,
      siblingItems.map(getSidebarDndItemId),
    );
    for (const item of siblingItems) {
      const itemId = getSidebarDndItemId(item);
      lookup.itemKindById.set(itemId, item.kind);
      lookup.parentKeyByItemId.set(itemId, parentKey);
      if (item.kind === "thread") {
        registerNode(item.node, parentKey);
      } else if (item.kind === "environment") {
        registerEnvironment(item, parentKey);
      } else if (item.kind === "section") {
        const sectionId = options.groups
          ? parseGroupSectionId(item.group.key)
          : buildSidebarEntitySectionId("section", item.group.id);
        lookup.sectionParentKeyBySectionId.set(sectionId, item.group.key);
        lookup.sectionSectionIdByParentKey.set(item.group.key, sectionId);
        lookup.sectionIdByParentKey.set(item.group.key, item.group.id);
        walk(item.group.items, item.group.key);
      }
    }
  };

  if (options.pinnedRootItems) {
    walk(options.pinnedRootItems, PINNED_THREAD_PARENT_KEY);
  }
  walk(items, containerId);
  return lookup;
}

export function isThreadWithinSubtree(
  lookup: SectionThreadDndLookup,
  rootThreadId: string,
  candidateThreadId: string,
): boolean {
  if (rootThreadId === candidateThreadId) return true;
  const stack: ProjectThreadItem[] = [
    ...(lookup.nodeByItemId.get(rootThreadId)?.children ?? []),
  ];
  while (stack.length > 0) {
    const item = stack.pop();
    if (!item) continue;
    if (item.kind === "thread") {
      if (item.node.thread.id === candidateThreadId) return true;
      stack.push(...item.node.children);
    } else if (item.kind === "environment") {
      for (const node of item.group.nodes) {
        if (node.thread.id === candidateThreadId) return true;
        stack.push(...node.children);
      }
    }
  }
  return false;
}

export function resolveThreadRowNestCollisions({
  collisions,
  droppableRects,
  pointerCoordinates,
  getBandFraction,
  retainedRect = null,
  retainedThreadId = null,
  onRowPointer,
  onResolvedRow,
  holdNestCandidate = (threadId) => threadId !== null,
}: ResolveThreadRowNestCollisionsArgs): Collision[] {
  let rowCollision: Collision | null = null;
  let rowThreadId: string | null = null;
  let rowRect: ClientRect | undefined;
  const otherCollisions: Collision[] = [];
  for (const collision of collisions) {
    const threadId =
      typeof collision.id === "string"
        ? parseSidebarThreadRowDroppableId(collision.id)
        : null;
    if (threadId === null) {
      otherCollisions.push(collision);
    } else if (rowCollision === null) {
      rowCollision = collision;
      rowThreadId = threadId;
      rowRect = droppableRects.get(collision.id);
    }
  }
  const retaining = rowCollision === null && retainedThreadId !== null;
  if (retaining) {
    rowCollision = { id: getSidebarThreadRowDroppableId(retainedThreadId) };
    rowThreadId = retainedThreadId;
    rowRect = droppableRects.get(rowCollision.id);
  }
  const rowPointer =
    rowCollision === null || rowThreadId === null || rowRect === undefined
      ? null
      : locateThreadRowPointer(
          rowThreadId,
          rowRect,
          pointerCoordinates,
          getBandFraction,
          retaining,
          retainedRect,
        );
  if (rowPointer && rowRect) {
    onResolvedRow?.({
      threadId: rowPointer.threadId,
      rect: rowRect,
      retaining,
    });
  }
  const candidateThreadId = rowPointer?.inNestBand ? rowPointer.threadId : null;
  const nesting =
    holdNestCandidate(candidateThreadId) && candidateThreadId !== null;
  if (rowPointer) {
    onRowPointer?.({
      threadId: rowPointer.threadId,
      relativeY: rowPointer.relativeY,
      nesting,
    });
  }
  return nesting && rowCollision !== null
    ? [rowCollision, ...otherCollisions]
    : otherCollisions;
}

function locateThreadRowPointer(
  threadId: string,
  rect: ClientRect | undefined,
  pointerCoordinates: { x: number; y: number } | null,
  getBandFraction: (threadId: string) => number | null,
  retainBelow: boolean,
  retainedRect: ClientRect | null,
): {
  threadId: string;
  relativeY: number;
  inNestBand: boolean;
} | null {
  if (!rect || rect.height <= 0 || !pointerCoordinates) return null;
  const { x, y } = pointerCoordinates;
  const withinX =
    x >= rect.left - NEST_CANCEL_OFFSET_PX && x <= rect.left + rect.width;
  const withinY = y >= rect.top && y <= rect.bottom;
  const withinRetainedRegion =
    retainBelow &&
    ((retainedRect !== null &&
      y >= Math.min(rect.top, retainedRect.top) &&
      y <= Math.max(rect.bottom, retainedRect.bottom)) ||
      (y > rect.bottom && y <= rect.bottom + rect.height));
  if (!withinX || (!withinY && !withinRetainedRegion)) return null;
  const relativeY = (y - rect.top) / rect.height;
  const bandFraction = getBandFraction(threadId);
  const inDwellBand =
    bandFraction !== null && Math.abs(relativeY - 0.5) <= bandFraction / 2;
  const movedLeft = x < rect.left - NEST_CANCEL_OFFSET_PX;
  if (withinRetainedRegion) {
    return {
      threadId,
      relativeY: 1,
      inNestBand: !movedLeft,
    };
  }
  return { threadId, relativeY, inNestBand: !movedLeft && inDwellBand };
}

export function buildPinInsertRequests(
  lookup: SectionThreadDndLookup,
  threadIds: readonly string[],
  target: SectionThreadReorderTarget,
): NeighborReorderRequest[] {
  const pinnedIds = lookup.pinnedThreadIds;
  const index = pinnedIds.indexOf(target.threadId);
  if (index === -1 || threadIds.includes(target.threadId)) return [];
  let previousItemId =
    target.placement === "before"
      ? (pinnedIds[index - 1] ?? null)
      : target.threadId;
  const nextItemId =
    target.placement === "before"
      ? target.threadId
      : (pinnedIds[index + 1] ?? null);
  return threadIds.map((itemId) => {
    const request = { itemId, previousItemId, nextItemId };
    previousItemId = itemId;
    return request;
  });
}

function resolveSectionThreadDropParentKey(
  lookup: SectionThreadDndLookup,
  overId: string | null,
): string | null {
  if (overId === null) return null;
  const overKind = lookup.itemKindById.get(overId);
  let parentKey = overKind ? lookup.parentKeyByItemId.get(overId) : undefined;
  const sectionParentKey = lookup.sectionParentKeyBySectionId.get(overId);
  if (sectionParentKey) parentKey = sectionParentKey;
  if (!overKind && lookup.sectionIdByParentKey.has(overId)) {
    parentKey = overId;
  } else if (overKind === "section") {
    parentKey = overId;
  }
  return parentKey ?? null;
}

interface ResolveSectionThreadDropDecisionOptions {
  groups?: boolean;
}

function getPinnedThreadIds(threads: readonly SidebarThread[]): string[] {
  return threads
    .filter((thread) => thread.pinnedAt !== null)
    .map((thread) => thread.id);
}

function resolveNestDecision(
  lookup: SectionThreadDndLookup,
  activeId: string,
  threads: readonly SidebarThread[],
  parentThreadId: string,
  options: ResolveSectionThreadDropDecisionOptions,
): SectionThreadDropDecision | null {
  const parentThread = lookup.threadByItemId.get(parentThreadId);
  const parentKey = lookup.parentKeyByItemId.get(parentThreadId);
  if (!parentThread || !parentKey) return null;
  if (
    threads.some((thread) =>
      isThreadWithinSubtree(lookup, thread.id, parentThreadId),
    )
  ) {
    return {
      kind: "rejected",
      activeId,
      overThreadId: parentThreadId,
      reason: "own-subtree",
    };
  }
  if (
    threads.every(
      (thread) => lookup.nestParentIdByItemId.get(thread.id) === parentThreadId,
    )
  ) {
    return {
      kind: "rejected",
      activeId,
      overThreadId: parentThreadId,
      reason: "already-child",
    };
  }
  const sectionId = options.groups
    ? undefined
    : parentKey === PINNED_THREAD_PARENT_KEY
      ? (parentThread.sectionId ?? null)
      : (lookup.sectionIdByParentKey.get(parentKey) ?? null);
  return {
    kind: "nest",
    activeId,
    parentThreadId,
    threadIds: threads.map((thread) => thread.id),
    unpinThreadIds: getPinnedThreadIds(threads),
    updates: threads.map((thread) => ({
      threadId: thread.id,
      parentThreadId,
      ...(sectionId === undefined ? {} : { sectionId }),
    })),
    pinThreadIds: [],
  };
}

function resolveDraggedRootThreads(
  lookup: SectionThreadDndLookup,
  activeId: string,
): SidebarThread[] | null {
  const threads: SidebarThread[] = [];
  for (const threadId of lookup.rootThreadIdsByItemId.get(activeId) ?? [
    activeId,
  ]) {
    const thread = lookup.threadByItemId.get(threadId);
    if (!thread) return null;
    threads.push(thread);
  }
  return threads;
}

function getGroupDragPreviewThread(
  thread: SidebarThread,
  groupThreads: readonly SidebarThread[],
): SidebarThread & { displayTitle: string } {
  const title = `${thread.environment?.name ?? thread.environment?.branchName ?? "Worktree group"} (${groupThreads.length} threads)`;
  return { ...thread, title, titleFallback: title, displayTitle: title };
}

export function resolveSectionThreadDropDecision(
  lookup: SectionThreadDndLookup,
  activeId: string,
  overId: string | null,
  projectedParentKey: string | null = null,
  projectedNestParentId: string | null = null,
  options: ResolveSectionThreadDropDecisionOptions = {},
): SectionThreadDropDecision | null {
  const fromParentKey = lookup.parentKeyByItemId.get(activeId);
  const threads = resolveDraggedRootThreads(lookup, activeId);
  if (!fromParentKey || !threads) return null;

  const overRowThreadId =
    overId === null ? null : parseSidebarThreadRowDroppableId(overId);
  if (overRowThreadId !== null && overRowThreadId !== activeId) {
    return resolveNestDecision(
      lookup,
      activeId,
      threads,
      overRowThreadId,
      options,
    );
  }
  const isSelfCollision = overId === activeId || overRowThreadId === activeId;
  if (isSelfCollision && projectedNestParentId !== null) {
    return resolveNestDecision(
      lookup,
      activeId,
      threads,
      projectedNestParentId,
      options,
    );
  }

  const directParentKey = isSelfCollision
    ? null
    : resolveSectionThreadDropParentKey(lookup, overId);
  const toParentKey =
    directParentKey ?? (isSelfCollision ? projectedParentKey : null);
  if (!toParentKey) return null;

  const threadIds = threads.map((thread) => thread.id);
  if (toParentKey === PINNED_THREAD_PARENT_KEY) {
    const detachThreadIds = threadIds.filter((threadId) =>
      lookup.nestParentIdByItemId.has(threadId),
    );
    const pinThreadIds = threads
      .filter((thread) => thread.pinnedAt === null)
      .map((thread) => thread.id);
    if (detachThreadIds.length > 0 || pinThreadIds.length > 0) {
      return {
        kind: "pin",
        activeId,
        threadIds,
        unpinThreadIds: [],
        updates: detachThreadIds.map((threadId) => ({
          threadId,
          parentThreadId: null,
        })),
        pinThreadIds,
      };
    }
    if (
      overId !== null &&
      overId !== activeId &&
      lookup.itemKindById.get(activeId) === "thread" &&
      lookup.parentKeyByItemId.get(overId) === PINNED_THREAD_PARENT_KEY
    ) {
      return { kind: "reorder-pinned", activeId, overId };
    }
    return { kind: "unchanged", activeId, toParentKey };
  }

  if (!lookup.sectionIdByParentKey.has(toParentKey)) return null;
  const sectionId = options.groups
    ? undefined
    : (lookup.sectionIdByParentKey.get(toParentKey) ?? null);
  const unpinThreadIds = getPinnedThreadIds(threads);
  const updates = threads.flatMap((thread): SectionThreadUpdate[] => {
    const detach = lookup.nestParentIdByItemId.has(thread.id);
    if (sectionId !== undefined && (detach || thread.sectionId !== sectionId)) {
      return [
        detach
          ? { threadId: thread.id, parentThreadId: null, sectionId }
          : { threadId: thread.id, sectionId },
      ];
    }
    return detach ? [{ threadId: thread.id, parentThreadId: null }] : [];
  });
  if (unpinThreadIds.length === 0 && updates.length === 0) {
    return { kind: "unchanged", activeId, toParentKey };
  }
  return {
    kind: "move",
    activeId,
    toParentKey,
    threadIds,
    unpinThreadIds,
    updates,
    pinThreadIds: [],
  };
}

function describeThreadCount(threadIds: readonly string[]): string {
  return threadIds.length === 1 ? "thread" : "threads";
}

function insertPinnedThreads(
  requests: readonly NeighborReorderRequest[],
  onReorderPinnedThread: UseSectionThreadDndArgs["onReorderPinnedThread"],
): Promise<void> {
  return requests.reduce<Promise<void>>(
    (previous, request) =>
      previous.then(
        () =>
          new Promise<void>((resolve) => {
            onReorderPinnedThread(request, { onSettled: resolve });
          }),
      ),
    Promise.resolve(),
  );
}

export function resolvePinnedReorderPlacement(
  lookup: SectionThreadDndLookup,
  activeId: string,
  overId: string,
): SidebarReorderPlacement | null {
  const pinnedIds = lookup.itemIdsByParentKey.get(PINNED_THREAD_PARENT_KEY);
  if (!pinnedIds) return null;
  const activeIndex = pinnedIds.indexOf(activeId);
  const overIndex = pinnedIds.indexOf(overId);
  if (activeIndex === -1 || overIndex === -1 || activeIndex === overIndex) {
    return null;
  }
  return activeIndex < overIndex ? "after" : "before";
}

export function resolveSectionThreadSectionOverId(
  lookup: SectionThreadDndLookup,
  overId: string,
): string {
  const overParentKey = lookup.parentKeyByItemId.get(overId);
  return (
    lookup.sectionSectionIdByParentKey.get(overId) ??
    (overParentKey
      ? lookup.sectionSectionIdByParentKey.get(overParentKey)
      : undefined) ??
    overId
  );
}

function getEventIds(event: DragOverEvent | DragEndEvent) {
  return {
    activeId: typeof event.active.id === "string" ? event.active.id : null,
    overId: typeof event.over?.id === "string" ? event.over.id : null,
  };
}

function resolveRowDropState(
  decision: SectionThreadDropDecision | null,
): RowDropState | null {
  if (decision?.kind === "nest") {
    return { threadId: decision.parentThreadId, state: "valid" };
  }
  if (decision?.kind === "rejected") {
    return {
      threadId: decision.overThreadId,
      state: decision.reason === "own-subtree" ? "blocked" : "unchanged",
    };
  }
  return null;
}

function resolvePinnedReorderTarget(
  lookup: SectionThreadDndLookup,
  activeId: string,
  decision: SectionThreadDropDecision | null,
): SectionThreadReorderTarget | null {
  if (decision?.kind !== "reorder-pinned") return null;
  const placement = resolvePinnedReorderPlacement(
    lookup,
    activeId,
    decision.overId,
  );
  return placement ? { threadId: decision.overId, placement } : null;
}

function resolveTargetParentKey(
  decision: SectionThreadDropDecision | null,
): string | null {
  switch (decision?.kind) {
    case "pin":
      return PINNED_THREAD_PARENT_KEY;
    case "move":
      return decision.toParentKey;
    default:
      return null;
  }
}

function resolveUnchangedParentKey(
  decision: SectionThreadDropDecision | null,
): string | null {
  return decision?.kind === "unchanged" ? decision.toParentKey : null;
}

function resolveDwellExpansion({
  containerId,
  onExpandThread,
  rowDrop,
  setCollapsedSections,
  targetParentKey,
}: {
  containerId: string;
  onExpandThread: ((threadId: string) => void) | undefined;
  rowDrop: RowDropState | null;
  setCollapsedSections: (update: (current: string[]) => string[]) => void;
  targetParentKey: string | null;
}): (() => void) | null {
  if (rowDrop?.state === "valid") {
    const parentThreadId = rowDrop.threadId;
    return onExpandThread ? () => onExpandThread(parentThreadId) : null;
  }
  if (
    targetParentKey === null ||
    targetParentKey === containerId ||
    targetParentKey === PINNED_THREAD_PARENT_KEY
  ) {
    return null;
  }
  return () =>
    setCollapsedSections((current) =>
      current.includes(targetParentKey)
        ? current.filter((key) => key !== targetParentKey)
        : current,
    );
}

function getRowDropTargetKey(rowDrop: RowDropState): string {
  return `row:${rowDrop.threadId}:${rowDrop.state}`;
}

function isCoarseActivator(activatorEvent: Event | null): boolean {
  return activatorEvent !== null && "touches" in activatorEvent;
}

const SECTION_AUTO_EXPAND_MS = 200;

function hasDropDecisionLanded(
  lookup: SectionThreadDndLookup,
  decision: SectionThreadDropDecision,
): boolean {
  switch (decision.kind) {
    case "move":
    case "pin": {
      const toParentKey =
        decision.kind === "pin"
          ? PINNED_THREAD_PARENT_KEY
          : decision.toParentKey;
      return decision.threadIds.every(
        (threadId) =>
          lookup.parentKeyByItemId.get(threadId) === toParentKey &&
          !lookup.nestParentIdByItemId.has(threadId),
      );
    }
    case "nest":
      return decision.threadIds.every(
        (threadId) =>
          lookup.nestParentIdByItemId.get(threadId) === decision.parentThreadId,
      );
    case "reorder-pinned":
    case "rejected":
    case "unchanged":
      return true;
  }
}

export function useSectionThreadDnd({
  containerId,
  enabled,
  rootItems,
  topLevelSectionOrder,
  onTopLevelSectionOrderChange,
  onExpandThread,
  groups = false,
  pinnedReorderPending,
  pinnedThreads,
  pinnedRootItems,
  pinnedRootNodes,
  onReorderPinnedThread,
}: UseSectionThreadDndArgs): SectionThreadDndState | null {
  const lookup = useMemo(
    () =>
      collectSectionThreadDndLookup(
        rootItems,
        containerId,
        pinnedThreads,
        pinnedRootNodes,
        { groups, pinnedRootItems },
      ),
    [
      containerId,
      groups,
      pinnedRootItems,
      pinnedRootNodes,
      pinnedThreads,
      rootItems,
    ],
  );
  const decisionOptions = useMemo(() => ({ groups }), [groups]);
  const topLevelSectionIds = useMemo(
    () => new Set<string>(topLevelSectionOrder),
    [topLevelSectionOrder],
  );
  const activeIdRef = useRef<string | null>(null);
  const armedNestThreadIdRef = useRef<string | null>(null);
  const latestRowCollisionRef = useRef<RetainedNestTarget | null>(null);
  const retainedNestTargetRef = useRef<RetainedNestTarget | null>(null);
  const coarsePointerRef = useRef(false);
  const pinnedInsertRef = useRef<SectionThreadReorderTarget | null>(null);
  const nestCandidateRef = useRef<NestHoverCandidate | null>(null);
  const nestCandidateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const [readyNestCandidate, setReadyNestCandidate] =
    useState<NestHoverCandidate | null>(null);
  const clearNestCandidate = useCallback(() => {
    if (nestCandidateTimerRef.current !== null) {
      clearTimeout(nestCandidateTimerRef.current);
    }
    nestCandidateTimerRef.current = null;
    nestCandidateRef.current = null;
  }, []);
  const holdNestCandidate = useCallback(
    (threadId: string | null): boolean => {
      const current = nestCandidateRef.current;
      if (current !== null && current.threadId === threadId) {
        return current === readyNestCandidate;
      }
      clearNestCandidate();
      if (threadId === null) return false;
      const candidate: NestHoverCandidate = { threadId };
      nestCandidateRef.current = candidate;
      nestCandidateTimerRef.current = setTimeout(() => {
        nestCandidateTimerRef.current = null;
        setReadyNestCandidate(candidate);
      }, NEST_HOVER_DELAY_MS);
      return false;
    },
    [clearNestCandidate, readyNestCandidate],
  );
  const isPinnedItem = useCallback(
    (itemId: string) =>
      lookup.parentKeyByItemId.get(itemId) === PINNED_THREAD_PARENT_KEY,
    [lookup],
  );
  const isPinnedRoot = useCallback(
    (itemId: string) =>
      isPinnedItem(itemId) && !lookup.nestParentIdByItemId.has(itemId),
    [isPinnedItem, lookup],
  );
  const getNestBandFraction = useCallback(
    (threadId: string): number | null => {
      const activeId = activeIdRef.current;
      if (activeId === null || threadId === activeId) return null;
      if (lookup.itemKindById.get(threadId) !== "thread") return null;
      const armed = armedNestThreadIdRef.current === threadId;
      if (coarsePointerRef.current) return 1;
      return armed ? NEST_BAND_ARMED_FRACTION : NEST_BAND_FRACTION;
    },
    [lookup],
  );
  const handleRowPointer = useCallback(
    ({ threadId, relativeY, nesting }: ThreadRowPointerInfo) => {
      const activeId = activeIdRef.current;
      if (
        activeId === null ||
        nesting ||
        isPinnedRoot(activeId) ||
        !isPinnedRoot(threadId)
      ) {
        return;
      }
      pinnedInsertRef.current = {
        threadId,
        placement: relativeY < 0.5 ? "before" : "after",
      };
    },
    [isPinnedRoot],
  );
  const handleResolvedRow = useCallback(
    ({ threadId, rect, retaining }: ResolvedThreadRowInfo) => {
      if (!retaining) latestRowCollisionRef.current = { threadId, rect };
    },
    [],
  );
  const collisionDetection = useCallback<CollisionDetection>(
    (args) => {
      if (!isPointerWithinSidebar(args.pointerCoordinates)) {
        pinnedInsertRef.current = null;
        latestRowCollisionRef.current = null;
        return [];
      }
      if (
        typeof args.active.id === "string" &&
        topLevelSectionIds.has(args.active.id)
      ) {
        latestRowCollisionRef.current = null;
        return reorderCollisionDetection({
          ...args,
          droppableContainers: args.droppableContainers.filter(({ id }) =>
            typeof id === "string" ? topLevelSectionIds.has(id) : false,
          ),
        });
      }
      pinnedInsertRef.current = null;
      const groupThreads =
        typeof args.active.id === "string"
          ? lookup.groupThreadsByItemId.get(args.active.id)
          : undefined;
      const groupThreadIds = groupThreads
        ? new Set(groupThreads.map((thread) => thread.id))
        : null;
      const reorderCollisions = reorderCollisionDetection(
        groupThreadIds
          ? {
              ...args,
              droppableContainers: args.droppableContainers.filter(({ id }) => {
                if (typeof id !== "string") return true;
                const threadId =
                  parseSidebarThreadRowDroppableId(id) ??
                  lookup.threadByItemId.get(id)?.id;
                return threadId === undefined || !groupThreadIds.has(threadId);
              }),
            }
          : args,
      );
      latestRowCollisionRef.current = null;
      const retainedNestTarget = retainedNestTargetRef.current;
      const collisions = resolveThreadRowNestCollisions({
        collisions: reorderCollisions,
        droppableRects: args.droppableRects,
        pointerCoordinates: args.pointerCoordinates,
        getBandFraction: getNestBandFraction,
        retainedRect: retainedNestTarget?.rect,
        retainedThreadId: retainedNestTarget?.threadId,
        onRowPointer: handleRowPointer,
        onResolvedRow: handleResolvedRow,
        holdNestCandidate,
      });
      const nestedCollisions = collisions.filter(({ id }) =>
        typeof id === "string" ? !topLevelSectionIds.has(id) : true,
      );
      return nestedCollisions.length > 0 ? nestedCollisions : collisions;
    },
    [
      getNestBandFraction,
      handleResolvedRow,
      handleRowPointer,
      holdNestCandidate,
      lookup,
      topLevelSectionIds,
    ],
  );
  const sdk = useSdk();
  const sidebarActions = experimental_useSidebarThreadActions();
  const { handleDragEnd: handlePinnedDragEnd } = useNeighborReorderSortable({
    disabled: pinnedReorderPending || pinnedThreads.length < 2,
    getId: (thread: SidebarThread) => thread.id,
    items: pinnedThreads,
    onReorder: onReorderPinnedThread,
  });
  const setCollapsedSections = useSetAtom(sidebarCollapsedThreadSectionsAtom);
  const [activeThread, setActiveThread] = useState<SidebarThread | null>(null);
  const [dragOverParentKey, setDragOverParentKey] = useState<string | null>(
    null,
  );
  const [unchangedParentKey, setUnchangedParentKey] = useState<string | null>(
    null,
  );
  const [rowDrop, setRowDrop] = useState<RowDropState | null>(null);
  const [reorderTarget, setReorderTarget] =
    useState<SectionThreadReorderTarget | null>(null);
  const [pendingDropDecision, setPendingDropDecision] =
    useState<SectionThreadDropDecision | null>(null);
  const draggingThreadRef = useRef(false);
  const dwellTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dwellTargetKeyRef = useRef<string | null>(null);

  const clearDropDwell = useCallback(() => {
    if (dwellTimerRef.current !== null) clearTimeout(dwellTimerRef.current);
    dwellTimerRef.current = null;
    dwellTargetKeyRef.current = null;
  }, []);
  const clearDropState = useCallback(() => {
    setActiveThread(null);
    setDragOverParentKey(null);
    setUnchangedParentKey(null);
    setRowDrop(null);
    setReorderTarget(null);
    setPendingDropDecision(null);
    setReadyNestCandidate(null);
    clearNestCandidate();
    armedNestThreadIdRef.current = null;
    latestRowCollisionRef.current = null;
    retainedNestTargetRef.current = null;
    activeIdRef.current = null;
    pinnedInsertRef.current = null;
  }, [clearNestCandidate]);
  const clearProjectedDrag = clearDropState;

  useEffect(
    () => () => {
      clearDropDwell();
      clearNestCandidate();
    },
    [clearDropDwell, clearNestCandidate],
  );

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const activeId =
        typeof event.active.id === "string" ? event.active.id : null;
      const thread = activeId
        ? (lookup.threadByItemId.get(activeId) ?? null)
        : null;
      draggingThreadRef.current = thread !== null;
      setPendingDropDecision(null);
      activeIdRef.current = thread ? activeId : null;
      armedNestThreadIdRef.current = null;
      latestRowCollisionRef.current = null;
      retainedNestTargetRef.current = null;
      pinnedInsertRef.current = null;
      coarsePointerRef.current = isCoarseActivator(
        event.activatorEvent ?? null,
      );
      clearDropDwell();
      clearNestCandidate();
      const groupThreads = activeId
        ? lookup.groupThreadsByItemId.get(activeId)
        : undefined;
      setActiveThread(
        thread && groupThreads
          ? getGroupDragPreviewThread(thread, groupThreads)
          : thread,
      );
      setDragOverParentKey(null);
      setUnchangedParentKey(null);
      setRowDrop(null);
      setReorderTarget(null);
      setReadyNestCandidate(null);
    },
    [clearDropDwell, clearNestCandidate, lookup],
  );

  const projectedNestParentId =
    rowDrop?.state === "valid" ? rowDrop.threadId : null;

  const handleDragOver = useCallback(
    (event: DragOverEvent) => {
      if (!enabled || !draggingThreadRef.current) return;
      const { activeId, overId } = getEventIds(event);
      if (activeId === null) return;
      const decision = resolveSectionThreadDropDecision(
        lookup,
        activeId,
        overId,
        dragOverParentKey,
        projectedNestParentId,
        decisionOptions,
      );
      const nextRowDrop = resolveRowDropState(decision);
      const targetParentKey = resolveTargetParentKey(decision);
      const nextUnchangedParentKey = resolveUnchangedParentKey(decision);
      const nextReorderTarget = resolvePinnedReorderTarget(
        lookup,
        activeId,
        decision,
      );
      const targetKey =
        nextRowDrop !== null
          ? getRowDropTargetKey(nextRowDrop)
          : nextReorderTarget !== null
            ? `reorder:${nextReorderTarget.threadId}:${nextReorderTarget.placement}`
            : nextUnchangedParentKey !== null
              ? `unchanged:${nextUnchangedParentKey}`
              : targetParentKey;
      const retainedNestTarget = retainedNestTargetRef.current;
      if (nextRowDrop?.state !== "valid") {
        retainedNestTargetRef.current = null;
      } else if (retainedNestTarget?.threadId !== nextRowDrop.threadId) {
        const latestRowCollision = latestRowCollisionRef.current;
        retainedNestTargetRef.current =
          latestRowCollision?.threadId === nextRowDrop.threadId
            ? latestRowCollision
            : null;
      }
      if (targetKey === dwellTargetKeyRef.current) return;

      clearDropDwell();
      dwellTargetKeyRef.current = targetKey;
      armedNestThreadIdRef.current = nextRowDrop?.threadId ?? null;
      setDragOverParentKey(targetParentKey);
      setUnchangedParentKey(nextUnchangedParentKey);
      setRowDrop(nextRowDrop);
      if (isPinnedRoot(activeId)) setReorderTarget(nextReorderTarget);
      const expand = resolveDwellExpansion({
        containerId,
        onExpandThread,
        rowDrop: nextRowDrop,
        setCollapsedSections,
        targetParentKey,
      });
      if (!expand) return;
      dwellTimerRef.current = setTimeout(() => {
        dwellTimerRef.current = null;
        if (
          draggingThreadRef.current &&
          dwellTargetKeyRef.current === targetKey
        ) {
          expand();
        }
      }, SECTION_AUTO_EXPAND_MS);
    },
    [
      clearDropDwell,
      containerId,
      decisionOptions,
      dragOverParentKey,
      enabled,
      isPinnedRoot,
      lookup,
      onExpandThread,
      projectedNestParentId,
      setCollapsedSections,
    ],
  );

  const handleDragMove = useCallback(
    (event: DragMoveEvent) => {
      if (!enabled || !draggingThreadRef.current) return;
      const activeId =
        typeof event.active.id === "string" ? event.active.id : null;
      if (activeId === null || isPinnedRoot(activeId)) return;
      const next = pinnedInsertRef.current;
      setReorderTarget((current) =>
        current?.threadId === next?.threadId &&
        current?.placement === next?.placement
          ? current
          : next,
      );
    },
    [enabled, isPinnedRoot],
  );

  const commitDropChanges = useCallback(
    (
      decision: Extract<
        SectionThreadDropDecision,
        { kind: "move" | "nest" | "pin" }
      >,
      failureMessage: string,
    ) =>
      Promise.all(
        decision.unpinThreadIds.map((threadId) =>
          sidebarActions.setPinned(threadId, false),
        ),
      )
        .then(() =>
          Promise.allSettled(
            decision.updates.map((update) => sdk.threads.update(update)),
          ),
        )
        .then((results) => {
          const failures = results.flatMap((result) =>
            result.status === "rejected" ? [result.reason] : [],
          );
          if (failures.length > 0) {
            toast.error(failureMessage);
            throw new AggregateError(failures, failureMessage);
          }
          return Promise.all(
            decision.pinThreadIds.map((threadId) =>
              sidebarActions.setPinned(threadId, true),
            ),
          );
        }),
    [sdk, sidebarActions],
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      draggingThreadRef.current = false;
      clearDropDwell();
      clearNestCandidate();
      if (!enabled) {
        clearProjectedDrag();
        return;
      }
      const { activeId, overId } = getEventIds(event);
      if (activeId === null) {
        clearProjectedDrag();
        return;
      }

      if (overId !== null && topLevelSectionIds.has(activeId)) {
        const sectionOverId = topLevelSectionIds.has(overId)
          ? overId
          : resolveSectionThreadSectionOverId(lookup, overId);
        const nextOrder = reorderSidebarSectionOrder({
          activeId,
          overId: sectionOverId,
          order: topLevelSectionOrder,
        });
        if (nextOrder) onTopLevelSectionOrderChange(nextOrder);
        clearProjectedDrag();
        return;
      }

      const decision = resolveSectionThreadDropDecision(
        lookup,
        activeId,
        overId,
        dragOverParentKey,
        projectedNestParentId,
        decisionOptions,
      );
      if (!decision) {
        clearProjectedDrag();
        return;
      }
      const settle = (request: Promise<unknown>) => {
        void request.catch(() => undefined).finally(clearProjectedDrag);
      };
      switch (decision.kind) {
        case "move":
        case "nest":
          settle(
            commitDropChanges(
              decision,
              `Failed to move ${describeThreadCount(decision.threadIds)}.`,
            ),
          );
          break;
        case "pin": {
          const insertRequests = reorderTarget
            ? buildPinInsertRequests(lookup, decision.threadIds, reorderTarget)
            : [];
          settle(
            commitDropChanges(
              decision,
              `Failed to pin ${describeThreadCount(decision.threadIds)}.`,
            ).then(() => {
              void insertPinnedThreads(insertRequests, onReorderPinnedThread);
            }),
          );
          break;
        }
        case "reorder-pinned":
          handlePinnedDragEnd(event);
          clearProjectedDrag();
          return;
        case "rejected":
        case "unchanged":
          clearProjectedDrag();
          return;
      }
      setPendingDropDecision(decision);
    },
    [
      clearDropDwell,
      clearNestCandidate,
      clearProjectedDrag,
      commitDropChanges,
      decisionOptions,
      dragOverParentKey,
      enabled,
      handlePinnedDragEnd,
      lookup,
      onReorderPinnedThread,
      onTopLevelSectionOrderChange,
      projectedNestParentId,
      reorderTarget,
      topLevelSectionIds,
      topLevelSectionOrder,
    ],
  );

  const handleDragCancel = useCallback(() => {
    draggingThreadRef.current = false;
    clearDropDwell();
    clearProjectedDrag();
  }, [clearDropDwell, clearProjectedDrag]);

  const { consumeClickSuppression, dndContextProps, onClickCapture } =
    useSidebarReorderDnd({
      axis: "free",
      collisionDetection,
      measuring: SECTION_THREAD_DROPPABLE_MEASURING,
      onDragEnd: handleDragEnd,
      onDragStart: handleDragStart,
      onDragMove: handleDragMove,
      onDragOver: handleDragOver,
      onDragCancel: handleDragCancel,
    });

  if (!enabled) return null;
  const dropDecisionLanded =
    pendingDropDecision !== null &&
    hasDropDecisionLanded(lookup, pendingDropDecision);
  return {
    activeItemId: dropDecisionLanded ? null : activeIdRef.current,
    activeThread: dropDecisionLanded ? null : activeThread,
    consumeClickSuppression,
    dndContextProps,
    itemIdsByParentKey: lookup.itemIdsByParentKey,
    onClickCapture,
    dragOverParentKey:
      dropDecisionLanded || reorderTarget !== null ? null : dragOverParentKey,
    unchangedParentKey:
      dropDecisionLanded || reorderTarget !== null ? null : unchangedParentKey,
    nestTarget: dropDecisionLanded ? null : rowDrop,
    nestPreviewBeforeKey: null,
    reorderTarget: dropDecisionLanded ? null : reorderTarget,
    pinnedItemIds:
      lookup.itemIdsByParentKey.get(PINNED_THREAD_PARENT_KEY) ?? [],
    pinnedReorderPending,
  };
}
