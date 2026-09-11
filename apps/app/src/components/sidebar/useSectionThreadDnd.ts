import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEventHandler,
} from "react";
import { useSetAtom } from "jotai";
import type {
  ClientRect,
  Collision,
  CollisionDetection,
  DragEndEvent,
  DragMoveEvent,
  DragOverEvent,
  DragStartEvent,
  UniqueIdentifier,
} from "@dnd-kit/core";
import type { ThreadListEntry } from "@bb/domain";
import {
  usePinThread,
  useUnpinAndMoveThread,
  useUnpinThread,
  useUpdateThread,
} from "@/hooks/mutations/thread-state-mutations";
import type { NeighborReorderRequest } from "@bb/client-core";
import {
  buildSidebarEntitySectionId,
  getSidebarDndItemId,
  reorderSidebarSectionOrder,
  type ProjectThreadItem,
  type ProjectThreadNode,
} from "@bb/client-core";
import {
  sidebarCollapsedThreadSectionsAtom,
  type SidebarSectionId,
} from "./sidebarCollapsedAtoms";
import {
  sidebarReorderCollisionDetection,
  useSidebarReorderDnd,
  type SidebarReorderDndContextProps,
} from "./useSidebarReorderDnd";
import type { ConsumeDragClickSuppression } from "@/components/ui/use-drag-click-suppression";
import { useNeighborReorderSortable } from "./useNeighborReorderSortable";
import {
  parseSidebarThreadRowDroppableId,
  type SidebarNestTargetState,
  type SidebarReorderPlacement,
} from "./sidebarThreadRowDroppable";
import type { SidebarDropPreviewPlacement } from "./sidebarDropPreviewPlacement";

export const PINNED_THREAD_PARENT_KEY = "sidebar:pinned-threads";
export const NEST_BAND_FRACTION = 0.6;
export const NEST_BAND_ARMED_FRACTION = 0.8;
export const PINNED_NEST_BAND_FRACTION = 0.4;
export const PINNED_NEST_BAND_ARMED_FRACTION = 0.5;

export interface SectionThreadNestTarget {
  threadId: string;
  state: SidebarNestTargetState;
}

export interface SectionThreadReorderTarget {
  threadId: string;
  placement: SidebarReorderPlacement;
}

export interface SectionThreadDndState {
  activeThread: ThreadListEntry | null;
  consumeClickSuppression: ConsumeDragClickSuppression;
  dndContextProps: SidebarReorderDndContextProps;
  itemIdsByParentKey: ReadonlyMap<string, readonly string[]>;
  onClickCapture: MouseEventHandler<HTMLElement>;
  dragOverParentKey: string | null;
  dropPreview: SidebarDropPreviewPlacement | null;
  nestTarget: SectionThreadNestTarget | null;
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
  pinnedThreads: readonly ThreadListEntry[];
  pinnedRootNodes?: readonly ProjectThreadNode[];
  onReorderPinnedThread: (
    request: NeighborReorderRequest,
    callbacks: { onSettled: () => void },
  ) => void;
}

interface SectionThreadDndLookup {
  sectionParentKeyBySectionId: Map<string, string>;
  sectionSectionIdByParentKey: Map<string, SidebarSectionId>;
  sectionIdByParentKey: Map<string, string | null>;
  sectionNameByParentKey: Map<string, string>;
  itemIdsByParentKey: Map<string, string[]>;
  itemKindById: Map<string, ProjectThreadItem["kind"]>;
  parentKeyByItemId: Map<string, string>;
  threadByItemId: Map<string, ThreadListEntry>;
  nodeByItemId: Map<string, ProjectThreadNode>;
  nestParentIdByItemId: Map<string, string>;
}

interface SectionThreadDropTarget {
  activeId: string;
  fromParentKey: string;
  toParentKey: string;
}

export type SectionThreadDropDecision =
  | { kind: "move"; activeId: string; sectionId: string | null }
  | { kind: "detach"; activeId: string; sectionId?: string | null }
  | { kind: "pin"; activeId: string; detach: boolean }
  | {
      kind: "unpin";
      activeId: string;
      sectionId: string | null;
      move: boolean;
    }
  | { kind: "reorder-pinned"; activeId: string; overId: string }
  | {
      kind: "nest";
      activeId: string;
      parentThreadId: string;
      sectionId?: string | null;
      unpin: boolean;
    }
  | {
      kind: "rejected";
      activeId: string;
      overThreadId: string;
      reason: "own-subtree" | "already-child";
    };

interface ThreadRowPointerInfo {
  threadId: string;
  relativeY: number;
  nesting: boolean;
}

interface ResolveThreadRowNestCollisionsArgs {
  collisions: Collision[];
  droppableRects: ReadonlyMap<UniqueIdentifier, ClientRect>;
  pointerCoordinates: { x: number; y: number } | null;
  getBandFraction: (threadId: string) => number | null;
  onRowPointer?: (info: ThreadRowPointerInfo) => void;
}

interface RowDropState {
  threadId: string;
  sectionId: string | null;
  state: SidebarNestTargetState;
}

interface CollectSectionThreadDndLookupOptions {
  groups?: boolean;
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
  pinnedThreads: readonly ThreadListEntry[] = [],
  pinnedRootNodes: readonly ProjectThreadNode[] = [],
  options: CollectSectionThreadDndLookupOptions = {},
): SectionThreadDndLookup {
  const lookup: SectionThreadDndLookup = {
    sectionParentKeyBySectionId: new Map([
      ["threads", containerId],
      ["pinned", PINNED_THREAD_PARENT_KEY],
    ]),
    sectionSectionIdByParentKey: new Map([
      [containerId, "threads"],
      [PINNED_THREAD_PARENT_KEY, "pinned"],
    ]),
    sectionIdByParentKey: new Map([[containerId, null]]),
    sectionNameByParentKey: new Map([
      [containerId, "Threads"],
      [PINNED_THREAD_PARENT_KEY, "Pinned"],
    ]),
    itemIdsByParentKey: new Map([
      [PINNED_THREAD_PARENT_KEY, pinnedThreads.map((thread) => thread.id)],
    ]),
    itemKindById: new Map(),
    parentKeyByItemId: new Map(),
    threadByItemId: new Map(),
    nodeByItemId: new Map(),
    nestParentIdByItemId: new Map(),
  };

  const registerNestedChildren = (
    node: ProjectThreadNode,
    parentKey: string,
  ) => {
    for (const child of node.children) {
      if (child.kind !== "thread") continue;
      const childId = child.node.thread.id;
      lookup.itemKindById.set(childId, "thread");
      lookup.parentKeyByItemId.set(childId, parentKey);
      lookup.threadByItemId.set(childId, child.node.thread);
      lookup.nodeByItemId.set(childId, child.node);
      lookup.nestParentIdByItemId.set(childId, node.thread.id);
      registerNestedChildren(child.node, parentKey);
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
        lookup.threadByItemId.set(itemId, item.node.thread);
        lookup.nodeByItemId.set(itemId, item.node);
        registerNestedChildren(item.node, parentKey);
      } else if (item.kind === "section") {
        const sectionId = options.groups
          ? parseGroupSectionId(item.group.key)
          : buildSidebarEntitySectionId("section", item.group.id);
        lookup.sectionParentKeyBySectionId.set(sectionId, item.group.key);
        lookup.sectionSectionIdByParentKey.set(item.group.key, sectionId);
        lookup.sectionIdByParentKey.set(item.group.key, item.group.id);
        lookup.sectionNameByParentKey.set(item.group.key, item.group.name);
        walk(item.group.items, item.group.key);
      }
    }
  };

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
  onRowPointer,
}: ResolveThreadRowNestCollisionsArgs): Collision[] {
  let rowCollision: Collision | null = null;
  let rowThreadId: string | null = null;
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
    }
  }
  if (rowCollision === null || rowThreadId === null || !pointerCoordinates) {
    return otherCollisions;
  }
  const rect = droppableRects.get(rowCollision.id);
  if (!rect || rect.height <= 0) return otherCollisions;
  const { x, y } = pointerCoordinates;
  const withinRect =
    x >= rect.left &&
    x <= rect.left + rect.width &&
    y >= rect.top &&
    y <= rect.top + rect.height;
  if (!withinRect) return otherCollisions;
  const relativeY = (y - rect.top) / rect.height;
  const bandFraction = getBandFraction(rowThreadId);
  const nesting =
    bandFraction !== null && Math.abs(relativeY - 0.5) <= bandFraction / 2;
  onRowPointer?.({ threadId: rowThreadId, relativeY, nesting });
  return nesting ? [rowCollision, ...otherCollisions] : otherCollisions;
}

export function buildPinInsertRequest(
  lookup: SectionThreadDndLookup,
  activeId: string,
  target: SectionThreadReorderTarget,
): NeighborReorderRequest | null {
  const pinnedIds = lookup.itemIdsByParentKey.get(PINNED_THREAD_PARENT_KEY);
  if (!pinnedIds) return null;
  const index = pinnedIds.indexOf(target.threadId);
  if (index === -1 || target.threadId === activeId) return null;
  return target.placement === "before"
    ? {
        itemId: activeId,
        previousItemId: pinnedIds[index - 1] ?? null,
        nextItemId: target.threadId,
      }
    : {
        itemId: activeId,
        previousItemId: target.threadId,
        nextItemId: pinnedIds[index + 1] ?? null,
      };
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

export function resolveSectionThreadDropTarget(
  lookup: SectionThreadDndLookup,
  activeId: string,
  overId: string | null,
): SectionThreadDropTarget | null {
  if (overId === null || activeId === overId) return null;
  const activeKind = lookup.itemKindById.get(activeId);
  const fromParentKey = lookup.parentKeyByItemId.get(activeId);
  if (activeKind !== "thread" || !fromParentKey) return null;
  const toParentKey = resolveSectionThreadDropParentKey(lookup, overId);
  if (!toParentKey) return null;
  if (
    fromParentKey === toParentKey &&
    !lookup.nestParentIdByItemId.has(activeId)
  ) {
    return null;
  }
  return { activeId, fromParentKey, toParentKey };
}

interface ResolveSectionThreadDropDecisionOptions {
  groups?: boolean;
}

function resolveNestDecision(
  lookup: SectionThreadDndLookup,
  activeId: string,
  parentThreadId: string,
  options: ResolveSectionThreadDropDecisionOptions,
): SectionThreadDropDecision | null {
  const parentThread = lookup.threadByItemId.get(parentThreadId);
  const fromParentKey = lookup.parentKeyByItemId.get(activeId);
  const parentKey = lookup.parentKeyByItemId.get(parentThreadId);
  if (!parentThread || !fromParentKey || !parentKey) return null;
  const fromPinned = fromParentKey === PINNED_THREAD_PARENT_KEY;
  const parentPinned = parentKey === PINNED_THREAD_PARENT_KEY;
  if (isThreadWithinSubtree(lookup, activeId, parentThreadId)) {
    return {
      kind: "rejected",
      activeId,
      overThreadId: parentThreadId,
      reason: "own-subtree",
    };
  }
  if (lookup.nestParentIdByItemId.get(activeId) === parentThreadId) {
    return {
      kind: "rejected",
      activeId,
      overThreadId: parentThreadId,
      reason: "already-child",
    };
  }
  if (options.groups) {
    return { kind: "nest", activeId, parentThreadId, unpin: fromPinned };
  }
  const sectionId = parentPinned
    ? (parentThread.sectionId ?? null)
    : (lookup.sectionIdByParentKey.get(parentKey) ?? null);
  return {
    kind: "nest",
    activeId,
    parentThreadId,
    sectionId,
    unpin: fromPinned,
  };
}

export function resolveSectionThreadDropDecision(
  lookup: SectionThreadDndLookup,
  activeId: string,
  overId: string | null,
  projectedParentKey: string | null = null,
  projectedNestParentId: string | null = null,
  options: ResolveSectionThreadDropDecisionOptions = {},
): SectionThreadDropDecision | null {
  const activeThread = lookup.threadByItemId.get(activeId);
  const fromParentKey = lookup.parentKeyByItemId.get(activeId);
  if (!activeThread || !fromParentKey) return null;

  const overRowThreadId =
    overId === null ? null : parseSidebarThreadRowDroppableId(overId);
  if (overRowThreadId !== null && overRowThreadId !== activeId) {
    return resolveNestDecision(lookup, activeId, overRowThreadId, options);
  }
  const isSelfCollision = overId === activeId || overRowThreadId === activeId;
  if (isSelfCollision && projectedNestParentId !== null) {
    return resolveNestDecision(
      lookup,
      activeId,
      projectedNestParentId,
      options,
    );
  }

  const directParentKey = isSelfCollision
    ? null
    : resolveSectionThreadDropParentKey(lookup, overId);
  const toParentKey =
    directParentKey ??
    (isSelfCollision && projectedParentKey !== null
      ? projectedParentKey
      : null);
  if (!toParentKey) return null;

  const fromPinned = fromParentKey === PINNED_THREAD_PARENT_KEY;
  const toPinned = toParentKey === PINNED_THREAD_PARENT_KEY;
  const nested = lookup.nestParentIdByItemId.has(activeId);
  if (toPinned) {
    if (nested) return { kind: "pin", activeId, detach: true };
    if (!fromPinned) return { kind: "pin", activeId, detach: false };
    if (
      overId !== null &&
      overId !== activeId &&
      lookup.parentKeyByItemId.get(overId) === PINNED_THREAD_PARENT_KEY
    ) {
      return { kind: "reorder-pinned", activeId, overId };
    }
    return null;
  }

  if (!lookup.sectionIdByParentKey.has(toParentKey)) return null;
  if (options.groups) {
    if (nested) return { kind: "detach", activeId };
    if (fromPinned) {
      return { kind: "unpin", activeId, sectionId: null, move: false };
    }
    return null;
  }
  const sectionId = lookup.sectionIdByParentKey.get(toParentKey) ?? null;
  if (nested) return { kind: "detach", activeId, sectionId };
  if (fromPinned) {
    return {
      kind: "unpin",
      activeId,
      sectionId,
      move: activeThread.sectionId !== sectionId,
    };
  }
  if (fromParentKey === toParentKey) return null;
  return { kind: "move", activeId, sectionId };
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

export function resolveProjectedSectionThreadDropTarget(
  lookup: SectionThreadDndLookup,
  activeId: string,
  projectedParentKey: string | null,
): SectionThreadDropTarget | null {
  if (projectedParentKey === null) return null;
  const fromParentKey = lookup.parentKeyByItemId.get(activeId);
  if (
    lookup.itemKindById.get(activeId) !== "thread" ||
    !fromParentKey ||
    (fromParentKey === projectedParentKey &&
      !lookup.nestParentIdByItemId.has(activeId)) ||
    !lookup.sectionIdByParentKey.has(projectedParentKey)
  ) {
    return null;
  }
  return { activeId, fromParentKey, toParentKey: projectedParentKey };
}

export class SectionThreadProjectionGate {
  private inputGeneration = 0;
  private appliedInputGeneration = -1;
  private readonly visitedTargets = new Set<string | null>();

  noteInput(): void {
    this.inputGeneration += 1;
  }

  reset(): void {
    this.inputGeneration = 0;
    this.appliedInputGeneration = -1;
    this.visitedTargets.clear();
  }

  allow(current: string | null, target: string | null): boolean {
    if (this.appliedInputGeneration !== this.inputGeneration) {
      this.appliedInputGeneration = this.inputGeneration;
      this.visitedTargets.clear();
      this.visitedTargets.add(current);
    } else if (this.visitedTargets.has(target)) {
      return false;
    }
    this.visitedTargets.add(target);
    return true;
  }
}

const PROJECTION_INPUT_EVENTS = [
  "pointermove",
  "touchmove",
  "wheel",
  "keydown",
] as const;

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
    return {
      threadId: decision.parentThreadId,
      sectionId: decision.sectionId ?? null,
      state: "valid",
    };
  }
  if (decision?.kind === "rejected") {
    return {
      threadId: decision.overThreadId,
      sectionId: null,
      state: decision.reason === "own-subtree" ? "blocked" : "unchanged",
    };
  }
  return null;
}

function getRowDropTargetKey(rowDrop: RowDropState): string {
  return `row:${rowDrop.threadId}:${rowDrop.state}`;
}

function isCoarseActivator(activatorEvent: Event | null): boolean {
  return activatorEvent !== null && "touches" in activatorEvent;
}

const SECTION_AUTO_EXPAND_MS = 200;
const DROP_SETTLE_MS = 220;

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
        { groups },
      ),
    [containerId, groups, pinnedRootNodes, pinnedThreads, rootItems],
  );
  const decisionOptions = useMemo(() => ({ groups }), [groups]);
  const topLevelSectionIds = useMemo(
    () => new Set<string>(topLevelSectionOrder),
    [topLevelSectionOrder],
  );
  const activeIdRef = useRef<string | null>(null);
  const armedNestThreadIdRef = useRef<string | null>(null);
  const coarsePointerRef = useRef(false);
  const pinnedInsertRef = useRef<SectionThreadReorderTarget | null>(null);
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
      if (isPinnedItem(threadId)) {
        return armed
          ? PINNED_NEST_BAND_ARMED_FRACTION
          : PINNED_NEST_BAND_FRACTION;
      }
      if (coarsePointerRef.current) return 1;
      return armed ? NEST_BAND_ARMED_FRACTION : NEST_BAND_FRACTION;
    },
    [isPinnedItem, lookup],
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
  const collisionDetection = useCallback<CollisionDetection>(
    (args) => {
      if (
        typeof args.active.id === "string" &&
        topLevelSectionIds.has(args.active.id)
      ) {
        return sidebarReorderCollisionDetection({
          ...args,
          droppableContainers: args.droppableContainers.filter(({ id }) =>
            typeof id === "string" ? topLevelSectionIds.has(id) : false,
          ),
        });
      }
      pinnedInsertRef.current = null;
      const collisions = resolveThreadRowNestCollisions({
        collisions: sidebarReorderCollisionDetection(args),
        droppableRects: args.droppableRects,
        pointerCoordinates: args.pointerCoordinates,
        getBandFraction: getNestBandFraction,
        onRowPointer: handleRowPointer,
      });
      const nestedCollisions = collisions.filter(({ id }) =>
        typeof id === "string" ? !topLevelSectionIds.has(id) : true,
      );
      return nestedCollisions.length > 0 ? nestedCollisions : collisions;
    },
    [getNestBandFraction, handleRowPointer, topLevelSectionIds],
  );
  const updateThread = useUpdateThread();
  const pinThread = usePinThread();
  const unpinThread = useUnpinThread();
  const unpinAndMoveThread = useUnpinAndMoveThread();
  const { handleDragEnd: handlePinnedDragEnd, itemIds: pinnedItemIds } =
    useNeighborReorderSortable({
      disabled: pinnedReorderPending || pinnedThreads.length < 2,
      getId: (thread: ThreadListEntry) => thread.id,
      items: pinnedThreads,
      onReorder: onReorderPinnedThread,
    });
  const setCollapsedSections = useSetAtom(sidebarCollapsedThreadSectionsAtom);
  const [activeThread, setActiveThread] = useState<ThreadListEntry | null>(
    null,
  );
  const [dragOverParentKey, setDragOverParentKey] = useState<string | null>(
    null,
  );
  const [rowDrop, setRowDrop] = useState<RowDropState | null>(null);
  const [reorderTarget, setReorderTarget] =
    useState<SectionThreadReorderTarget | null>(null);
  const draggingThreadRef = useRef(false);
  const dwellTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dropSettleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dwellTargetKeyRef = useRef<string | null>(null);
  const projectionGateRef = useRef(new SectionThreadProjectionGate());
  const stopProjectionInputTrackingRef = useRef<(() => void) | null>(null);

  const stopProjectionInputTracking = useCallback(() => {
    stopProjectionInputTrackingRef.current?.();
    stopProjectionInputTrackingRef.current = null;
  }, []);
  const startProjectionInputTracking = useCallback(() => {
    stopProjectionInputTracking();
    const gate = projectionGateRef.current;
    gate.reset();
    const noteInput = () => gate.noteInput();
    for (const type of PROJECTION_INPUT_EVENTS) {
      document.addEventListener(type, noteInput, {
        capture: true,
        passive: true,
      });
    }
    stopProjectionInputTrackingRef.current = () => {
      for (const type of PROJECTION_INPUT_EVENTS) {
        document.removeEventListener(type, noteInput, { capture: true });
      }
    };
  }, [stopProjectionInputTracking]);

  const clearDropDwell = useCallback(() => {
    if (dwellTimerRef.current !== null) clearTimeout(dwellTimerRef.current);
    dwellTimerRef.current = null;
    dwellTargetKeyRef.current = null;
  }, []);
  const clearDropSettle = useCallback(() => {
    if (dropSettleTimerRef.current !== null) {
      clearTimeout(dropSettleTimerRef.current);
    }
    dropSettleTimerRef.current = null;
  }, []);
  const clearDropState = useCallback(() => {
    setActiveThread(null);
    setDragOverParentKey(null);
    setRowDrop(null);
    setReorderTarget(null);
    armedNestThreadIdRef.current = null;
    activeIdRef.current = null;
    pinnedInsertRef.current = null;
  }, []);
  const clearProjectedDrag = useCallback(() => {
    clearDropSettle();
    clearDropState();
  }, [clearDropSettle, clearDropState]);

  useEffect(
    () => () => {
      clearDropDwell();
      clearDropSettle();
      stopProjectionInputTracking();
    },
    [clearDropDwell, clearDropSettle, stopProjectionInputTracking],
  );

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const activeId =
        typeof event.active.id === "string" ? event.active.id : null;
      const thread = activeId
        ? (lookup.threadByItemId.get(activeId) ?? null)
        : null;
      draggingThreadRef.current = thread !== null;
      activeIdRef.current = thread ? activeId : null;
      armedNestThreadIdRef.current = null;
      pinnedInsertRef.current = null;
      coarsePointerRef.current = isCoarseActivator(
        event.activatorEvent ?? null,
      );
      clearDropSettle();
      clearDropDwell();
      startProjectionInputTracking();
      setActiveThread(thread);
      setDragOverParentKey(null);
      setRowDrop(null);
      setReorderTarget(null);
    },
    [clearDropDwell, clearDropSettle, lookup, startProjectionInputTracking],
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
      const directDrop = resolveSectionThreadDropTarget(
        lookup,
        activeId,
        overId,
      );
      const drop =
        directDrop ??
        (overId === activeId && dragOverParentKey !== null
          ? resolveProjectedSectionThreadDropTarget(
              lookup,
              activeId,
              dragOverParentKey,
            )
          : null);
      const targetParentKey =
        decision === null ||
        nextRowDrop !== null ||
        decision.kind === "reorder-pinned"
          ? null
          : decision.kind === "pin"
            ? PINNED_THREAD_PARENT_KEY
            : (drop?.toParentKey ?? null);
      const nextReorderTarget =
        decision?.kind === "reorder-pinned"
          ? (() => {
              const placement = resolvePinnedReorderPlacement(
                lookup,
                activeId,
                decision.overId,
              );
              return placement
                ? { threadId: decision.overId, placement }
                : null;
            })()
          : null;
      const targetKey =
        nextRowDrop !== null
          ? getRowDropTargetKey(nextRowDrop)
          : nextReorderTarget !== null
            ? `reorder:${nextReorderTarget.threadId}:${nextReorderTarget.placement}`
            : targetParentKey;
      if (targetKey === dwellTargetKeyRef.current) return;
      if (
        !projectionGateRef.current.allow(dwellTargetKeyRef.current, targetKey)
      ) {
        return;
      }

      clearDropDwell();
      dwellTargetKeyRef.current = targetKey;
      armedNestThreadIdRef.current = nextRowDrop?.threadId ?? null;
      setDragOverParentKey(targetParentKey);
      setRowDrop(nextRowDrop);
      if (isPinnedRoot(activeId)) setReorderTarget(nextReorderTarget);
      if (nextRowDrop?.state === "valid") {
        const parentThreadId = nextRowDrop.threadId;
        dwellTimerRef.current = setTimeout(() => {
          dwellTimerRef.current = null;
          if (
            !draggingThreadRef.current ||
            dwellTargetKeyRef.current !== targetKey
          ) {
            return;
          }
          onExpandThread?.(parentThreadId);
        }, SECTION_AUTO_EXPAND_MS);
        return;
      }
      if (
        targetParentKey === null ||
        targetParentKey === containerId ||
        targetParentKey === PINNED_THREAD_PARENT_KEY
      ) {
        return;
      }

      dwellTimerRef.current = setTimeout(() => {
        dwellTimerRef.current = null;
        if (
          !draggingThreadRef.current ||
          dwellTargetKeyRef.current !== targetKey
        ) {
          return;
        }
        setCollapsedSections((current) =>
          current.includes(targetParentKey)
            ? current.filter((key) => key !== targetParentKey)
            : current,
        );
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

  const commitNest = useCallback(
    (decision: Extract<SectionThreadDropDecision, { kind: "nest" }>) => {
      const applyNest = () =>
        updateThread.mutate({
          id: decision.activeId,
          parentThreadId: decision.parentThreadId,
          ...(decision.sectionId !== undefined
            ? { sectionId: decision.sectionId }
            : {}),
        });
      if (decision.unpin) {
        unpinThread
          .mutateAsync({ id: decision.activeId })
          .then(applyNest)
          .catch(() => undefined);
      } else {
        applyNest();
      }
    },
    [unpinThread, updateThread],
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      draggingThreadRef.current = false;
      clearDropDwell();
      stopProjectionInputTracking();
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
      switch (decision.kind) {
        case "move":
          updateThread.mutate({
            id: decision.activeId,
            sectionId: decision.sectionId,
          });
          break;
        case "detach":
          updateThread.mutate({
            id: decision.activeId,
            parentThreadId: null,
            ...(decision.sectionId !== undefined
              ? { sectionId: decision.sectionId }
              : {}),
          });
          break;
        case "nest":
          commitNest(decision);
          break;
        case "pin": {
          const insertRequest = reorderTarget
            ? buildPinInsertRequest(lookup, decision.activeId, reorderTarget)
            : null;
          const pin = () =>
            pinThread.mutateAsync({ id: decision.activeId }).then(() => {
              if (insertRequest) {
                onReorderPinnedThread(insertRequest, {
                  onSettled: () => undefined,
                });
              }
            });
          if (decision.detach) {
            updateThread
              .mutateAsync({ id: decision.activeId, parentThreadId: null })
              .then(pin)
              .catch(() => undefined);
          } else {
            pin().catch(() => undefined);
          }
          break;
        }
        case "unpin":
          if (decision.move) {
            unpinAndMoveThread.mutate({
              id: decision.activeId,
              sectionId: decision.sectionId,
            });
          } else {
            unpinThread.mutate({ id: decision.activeId });
          }
          break;
        case "reorder-pinned":
          handlePinnedDragEnd(event);
          clearProjectedDrag();
          return;
        case "rejected":
          clearProjectedDrag();
          return;
      }
      clearDropSettle();
      dropSettleTimerRef.current = setTimeout(() => {
        dropSettleTimerRef.current = null;
        clearDropState();
      }, DROP_SETTLE_MS);
    },
    [
      clearDropDwell,
      clearDropSettle,
      clearDropState,
      clearProjectedDrag,
      commitNest,
      decisionOptions,
      dragOverParentKey,
      enabled,
      handlePinnedDragEnd,
      lookup,
      onReorderPinnedThread,
      onTopLevelSectionOrderChange,
      pinThread,
      projectedNestParentId,
      reorderTarget,
      stopProjectionInputTracking,
      topLevelSectionIds,
      topLevelSectionOrder,
      updateThread,
      unpinAndMoveThread,
      unpinThread,
    ],
  );

  const handleDragCancel = useCallback(() => {
    draggingThreadRef.current = false;
    clearDropDwell();
    stopProjectionInputTracking();
    clearProjectedDrag();
  }, [clearDropDwell, clearProjectedDrag, stopProjectionInputTracking]);

  const { consumeClickSuppression, dndContextProps, onClickCapture } =
    useSidebarReorderDnd({
      collisionDetection,
      onDragEnd: handleDragEnd,
      onDragStart: handleDragStart,
      onDragMove: handleDragMove,
      onDragOver: handleDragOver,
      onDragCancel: handleDragCancel,
    });

  if (!enabled) return null;
  return {
    activeThread,
    consumeClickSuppression,
    dndContextProps,
    itemIdsByParentKey: lookup.itemIdsByParentKey,
    onClickCapture,
    dragOverParentKey,
    dropPreview: null,
    nestTarget: rowDrop
      ? { threadId: rowDrop.threadId, state: rowDrop.state }
      : null,
    reorderTarget,
    pinnedItemIds,
    pinnedReorderPending,
  };
}
