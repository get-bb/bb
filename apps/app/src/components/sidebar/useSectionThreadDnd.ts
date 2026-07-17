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
  CollisionDetection,
  DragEndEvent,
  DragOverEvent,
  DragStartEvent,
} from "@dnd-kit/core";
import type { ThreadListEntry } from "@bb/domain";
import {
  usePinThread,
  useUnpinAndMoveThread,
  useUnpinThread,
  useUpdateThread,
} from "@/hooks/mutations/thread-state-mutations";
import type { NeighborReorderRequest } from "@/lib/neighbor-reorder";
import {
  getSidebarDndItemId,
  type ProjectThreadItem,
} from "./projectThreadGroups";
import {
  sidebarCollapsedThreadSectionsAtom,
  type SidebarSectionId,
} from "./sidebarCollapsedAtoms";
import {
  buildSidebarEntitySectionId,
  reorderSidebarSectionOrder,
} from "./sidebarSectionOrder";
import {
  sidebarReorderCollisionDetection,
  useSidebarReorderDnd,
  type SidebarReorderDndContextProps,
} from "./useSidebarReorderDnd";
import type { ConsumeDragClickSuppression } from "@/components/ui/use-drag-click-suppression";
import { useNeighborReorderSortable } from "./useNeighborReorderSortable";

export const PINNED_THREAD_PARENT_KEY = "sidebar:pinned-threads";

export interface SectionThreadDndState {
  activeThread: ThreadListEntry | null;
  consumeClickSuppression: ConsumeDragClickSuppression;
  dndContextProps: SidebarReorderDndContextProps;
  itemIdsByParentKey: ReadonlyMap<string, readonly string[]>;
  onClickCapture: MouseEventHandler<HTMLElement>;
  dragOverParentKey: string | null;
  /** `undefined` means no projection; `null` means the loose Threads section. */
  projectedSectionId: string | null | undefined;
  pinnedItemIds: readonly string[];
  pinnedReorderPending: boolean;
}

interface UseSectionThreadDndArgs {
  containerId: string;
  enabled: boolean;
  rootItems: readonly ProjectThreadItem[];
  topLevelSectionOrder: readonly SidebarSectionId[];
  onTopLevelSectionOrderChange: (order: SidebarSectionId[]) => void;
  pinnedReorderPending: boolean;
  pinnedThreads: readonly ThreadListEntry[];
  onReorderPinnedThread: (
    request: NeighborReorderRequest,
    callbacks: { onSettled: () => void },
  ) => void;
}

export interface SectionThreadDndLookup {
  sectionParentKeyBySectionId: Map<string, string>;
  sectionSectionIdByParentKey: Map<string, SidebarSectionId>;
  sectionIdByParentKey: Map<string, string | null>;
  itemIdsByParentKey: Map<string, string[]>;
  itemKindById: Map<string, ProjectThreadItem["kind"]>;
  parentKeyByItemId: Map<string, string>;
  threadByItemId: Map<string, ThreadListEntry>;
}

export interface SectionThreadDropTarget {
  activeId: string;
  fromParentKey: string;
  toParentKey: string;
}

export type SectionThreadDropDecision =
  | { kind: "move"; activeId: string; sectionId: string | null }
  | { kind: "pin"; activeId: string }
  | {
      kind: "unpin";
      activeId: string;
      sectionId: string | null;
      move: boolean;
    }
  | { kind: "reorder-pinned"; activeId: string; overId: string };

export function collectSectionThreadDndLookup(
  items: readonly ProjectThreadItem[],
  containerId: string,
  pinnedThreads: readonly ThreadListEntry[] = [],
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
    itemIdsByParentKey: new Map([
      [PINNED_THREAD_PARENT_KEY, pinnedThreads.map((thread) => thread.id)],
    ]),
    itemKindById: new Map(),
    parentKeyByItemId: new Map(),
    threadByItemId: new Map(),
  };

  for (const thread of pinnedThreads) {
    lookup.itemKindById.set(thread.id, "thread");
    lookup.parentKeyByItemId.set(thread.id, PINNED_THREAD_PARENT_KEY);
    lookup.threadByItemId.set(thread.id, thread);
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
      } else if (item.kind === "section") {
        const sectionId = buildSidebarEntitySectionId("section", item.group.id);
        lookup.sectionParentKeyBySectionId.set(sectionId, item.group.key);
        lookup.sectionSectionIdByParentKey.set(item.group.key, sectionId);
        lookup.sectionIdByParentKey.set(item.group.key, item.group.id);
        walk(item.group.items, item.group.key);
      }
    }
  };

  walk(items, containerId);
  return lookup;
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
  if (!toParentKey || fromParentKey === toParentKey) return null;
  return { activeId, fromParentKey, toParentKey };
}

export function resolveSectionThreadDropDecision(
  lookup: SectionThreadDndLookup,
  activeId: string,
  overId: string | null,
  projectedParentKey: string | null = null,
): SectionThreadDropDecision | null {
  const activeThread = lookup.threadByItemId.get(activeId);
  const fromParentKey = lookup.parentKeyByItemId.get(activeId);
  if (!activeThread || !fromParentKey) return null;

  const directParentKey =
    overId === activeId
      ? null
      : resolveSectionThreadDropParentKey(lookup, overId);
  const toParentKey =
    directParentKey ??
    (overId === activeId && projectedParentKey !== null
      ? projectedParentKey
      : null);
  if (!toParentKey) return null;

  const fromPinned = fromParentKey === PINNED_THREAD_PARENT_KEY;
  const toPinned = toParentKey === PINNED_THREAD_PARENT_KEY;
  if (toPinned) {
    if (!fromPinned) return { kind: "pin", activeId };
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
  const sectionId = lookup.sectionIdByParentKey.get(toParentKey) ?? null;
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
    fromParentKey === projectedParentKey ||
    !lookup.sectionIdByParentKey.has(projectedParentKey)
  ) {
    return null;
  }
  return { activeId, fromParentKey, toParentKey: projectedParentKey };
}

function getEventIds(event: DragOverEvent | DragEndEvent) {
  return {
    activeId: typeof event.active.id === "string" ? event.active.id : null,
    overId: typeof event.over?.id === "string" ? event.over.id : null,
  };
}

const SECTION_AUTO_EXPAND_MS = 200;
const DROP_SETTLE_MS = 220;

export function useSectionThreadDnd({
  containerId,
  enabled,
  rootItems,
  topLevelSectionOrder,
  onTopLevelSectionOrderChange,
  pinnedReorderPending,
  pinnedThreads,
  onReorderPinnedThread,
}: UseSectionThreadDndArgs): SectionThreadDndState | null {
  const lookup = useMemo(
    () => collectSectionThreadDndLookup(rootItems, containerId, pinnedThreads),
    [containerId, pinnedThreads, rootItems],
  );
  const topLevelSectionIds = useMemo(
    () => new Set<string>(topLevelSectionOrder),
    [topLevelSectionOrder],
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
      const collisions = sidebarReorderCollisionDetection(args);
      const nestedCollisions = collisions.filter(({ id }) =>
        typeof id === "string" ? !topLevelSectionIds.has(id) : true,
      );
      return nestedCollisions.length > 0 ? nestedCollisions : collisions;
    },
    [topLevelSectionIds],
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
  const draggingThreadRef = useRef(false);
  const dwellTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dropSettleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dwellParentKeyRef = useRef<string | null>(null);

  const clearDropDwell = useCallback(() => {
    if (dwellTimerRef.current !== null) clearTimeout(dwellTimerRef.current);
    dwellTimerRef.current = null;
    dwellParentKeyRef.current = null;
  }, []);
  const clearDropSettle = useCallback(() => {
    if (dropSettleTimerRef.current !== null) {
      clearTimeout(dropSettleTimerRef.current);
    }
    dropSettleTimerRef.current = null;
  }, []);
  const clearProjectedDrag = useCallback(() => {
    clearDropSettle();
    setActiveThread(null);
    setDragOverParentKey(null);
  }, [clearDropSettle]);

  useEffect(
    () => () => {
      clearDropDwell();
      clearDropSettle();
    },
    [clearDropDwell, clearDropSettle],
  );

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const activeId =
        typeof event.active.id === "string" ? event.active.id : null;
      const thread = activeId
        ? (lookup.threadByItemId.get(activeId) ?? null)
        : null;
      draggingThreadRef.current = thread !== null;
      clearDropSettle();
      clearDropDwell();
      setActiveThread(thread);
      setDragOverParentKey(null);
    },
    [clearDropDwell, clearDropSettle, lookup],
  );

  const handleDragOver = useCallback(
    (event: DragOverEvent) => {
      if (!enabled || !draggingThreadRef.current) return;
      const { activeId, overId } = getEventIds(event);
      if (activeId === null) return;
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
      const decision = resolveSectionThreadDropDecision(
        lookup,
        activeId,
        overId,
        dragOverParentKey,
      );
      const targetParentKey =
        decision?.kind === "reorder-pinned"
          ? null
          : (drop?.toParentKey ??
            (decision?.kind === "pin" ? PINNED_THREAD_PARENT_KEY : null));
      if (targetParentKey === dwellParentKeyRef.current) return;

      clearDropDwell();
      dwellParentKeyRef.current = targetParentKey;
      setDragOverParentKey(targetParentKey);
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
          dwellParentKeyRef.current !== targetParentKey
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
      dragOverParentKey,
      enabled,
      lookup,
      setCollapsedSections,
    ],
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      draggingThreadRef.current = false;
      clearDropDwell();
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
        const sectionOverId = resolveSectionThreadSectionOverId(lookup, overId);
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
        case "pin":
          pinThread.mutate({ id: decision.activeId });
          break;
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
      }
      clearDropSettle();
      dropSettleTimerRef.current = setTimeout(() => {
        dropSettleTimerRef.current = null;
        setActiveThread(null);
        setDragOverParentKey(null);
      }, DROP_SETTLE_MS);
    },
    [
      clearDropDwell,
      clearDropSettle,
      clearProjectedDrag,
      dragOverParentKey,
      enabled,
      handlePinnedDragEnd,
      lookup,
      onTopLevelSectionOrderChange,
      pinThread,
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
    clearProjectedDrag();
  }, [clearDropDwell, clearProjectedDrag]);

  const { consumeClickSuppression, dndContextProps, onClickCapture } =
    useSidebarReorderDnd({
      collisionDetection,
      onDragEnd: handleDragEnd,
      onDragStart: handleDragStart,
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
    projectedSectionId:
      activeThread && dragOverParentKey !== null
        ? lookup.sectionIdByParentKey.get(dragOverParentKey)
        : undefined,
    pinnedItemIds,
    pinnedReorderPending,
  };
}
