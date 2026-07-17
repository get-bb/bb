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
  sidebarCollapsedFoldersAtom,
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

export interface FolderThreadDndState {
  activeThread: ThreadListEntry | null;
  consumeClickSuppression: ConsumeDragClickSuppression;
  dndContextProps: SidebarReorderDndContextProps;
  itemIdsByParentKey: ReadonlyMap<string, readonly string[]>;
  onClickCapture: MouseEventHandler<HTMLElement>;
  dragOverParentKey: string | null;
  /** `undefined` means no projection; `null` means the loose Threads section. */
  projectedFolderId: string | null | undefined;
  pinnedItemIds: readonly string[];
  pinnedReorderPending: boolean;
}

interface UseFolderThreadDndArgs {
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

export interface FolderThreadDndLookup {
  folderParentKeyBySectionId: Map<string, string>;
  folderSectionIdByParentKey: Map<string, SidebarSectionId>;
  folderIdByParentKey: Map<string, string | null>;
  itemIdsByParentKey: Map<string, string[]>;
  itemKindById: Map<string, ProjectThreadItem["kind"]>;
  parentKeyByItemId: Map<string, string>;
  threadByItemId: Map<string, ThreadListEntry>;
}

export interface FolderThreadDropTarget {
  activeId: string;
  fromParentKey: string;
  toParentKey: string;
}

export type FolderThreadDropDecision =
  | { kind: "move"; activeId: string; folderId: string | null }
  | { kind: "pin"; activeId: string }
  | {
      kind: "unpin";
      activeId: string;
      folderId: string | null;
      move: boolean;
    }
  | { kind: "reorder-pinned"; activeId: string; overId: string };

export function collectFolderThreadDndLookup(
  items: readonly ProjectThreadItem[],
  containerId: string,
  pinnedThreads: readonly ThreadListEntry[] = [],
): FolderThreadDndLookup {
  const lookup: FolderThreadDndLookup = {
    folderParentKeyBySectionId: new Map([
      ["threads", containerId],
      ["pinned", PINNED_THREAD_PARENT_KEY],
    ]),
    folderSectionIdByParentKey: new Map([
      [containerId, "threads"],
      [PINNED_THREAD_PARENT_KEY, "pinned"],
    ]),
    folderIdByParentKey: new Map([[containerId, null]]),
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
      } else if (item.kind === "folder") {
        const sectionId = buildSidebarEntitySectionId("folder", item.group.id);
        lookup.folderParentKeyBySectionId.set(sectionId, item.group.key);
        lookup.folderSectionIdByParentKey.set(item.group.key, sectionId);
        lookup.folderIdByParentKey.set(item.group.key, item.group.id);
        walk(item.group.items, item.group.key);
      }
    }
  };

  walk(items, containerId);
  return lookup;
}

function resolveFolderThreadDropParentKey(
  lookup: FolderThreadDndLookup,
  overId: string | null,
): string | null {
  if (overId === null) return null;
  const overKind = lookup.itemKindById.get(overId);
  let parentKey = overKind ? lookup.parentKeyByItemId.get(overId) : undefined;
  const sectionParentKey = lookup.folderParentKeyBySectionId.get(overId);
  if (sectionParentKey) parentKey = sectionParentKey;
  if (!overKind && lookup.folderIdByParentKey.has(overId)) {
    parentKey = overId;
  } else if (overKind === "folder") {
    parentKey = overId;
  }
  return parentKey ?? null;
}

export function resolveFolderThreadDropTarget(
  lookup: FolderThreadDndLookup,
  activeId: string,
  overId: string | null,
): FolderThreadDropTarget | null {
  if (overId === null || activeId === overId) return null;
  const activeKind = lookup.itemKindById.get(activeId);
  const fromParentKey = lookup.parentKeyByItemId.get(activeId);
  if (activeKind !== "thread" || !fromParentKey) return null;
  const toParentKey = resolveFolderThreadDropParentKey(lookup, overId);
  if (!toParentKey || fromParentKey === toParentKey) return null;
  return { activeId, fromParentKey, toParentKey };
}

export function resolveFolderThreadDropDecision(
  lookup: FolderThreadDndLookup,
  activeId: string,
  overId: string | null,
  projectedParentKey: string | null = null,
): FolderThreadDropDecision | null {
  const activeThread = lookup.threadByItemId.get(activeId);
  const fromParentKey = lookup.parentKeyByItemId.get(activeId);
  if (!activeThread || !fromParentKey) return null;

  const directParentKey =
    overId === activeId
      ? null
      : resolveFolderThreadDropParentKey(lookup, overId);
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

  if (!lookup.folderIdByParentKey.has(toParentKey)) return null;
  const folderId = lookup.folderIdByParentKey.get(toParentKey) ?? null;
  if (fromPinned) {
    return {
      kind: "unpin",
      activeId,
      folderId,
      move: activeThread.folderId !== folderId,
    };
  }
  if (fromParentKey === toParentKey) return null;
  return { kind: "move", activeId, folderId };
}

export function resolveFolderThreadSectionOverId(
  lookup: FolderThreadDndLookup,
  overId: string,
): string {
  const overParentKey = lookup.parentKeyByItemId.get(overId);
  return (
    lookup.folderSectionIdByParentKey.get(overId) ??
    (overParentKey
      ? lookup.folderSectionIdByParentKey.get(overParentKey)
      : undefined) ??
    overId
  );
}

export function resolveProjectedFolderThreadDropTarget(
  lookup: FolderThreadDndLookup,
  activeId: string,
  projectedParentKey: string | null,
): FolderThreadDropTarget | null {
  if (projectedParentKey === null) return null;
  const fromParentKey = lookup.parentKeyByItemId.get(activeId);
  if (
    lookup.itemKindById.get(activeId) !== "thread" ||
    !fromParentKey ||
    fromParentKey === projectedParentKey ||
    !lookup.folderIdByParentKey.has(projectedParentKey)
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

const FOLDER_AUTO_EXPAND_MS = 200;
const DROP_SETTLE_MS = 220;

export function useFolderThreadDnd({
  containerId,
  enabled,
  rootItems,
  topLevelSectionOrder,
  onTopLevelSectionOrderChange,
  pinnedReorderPending,
  pinnedThreads,
  onReorderPinnedThread,
}: UseFolderThreadDndArgs): FolderThreadDndState | null {
  const lookup = useMemo(
    () => collectFolderThreadDndLookup(rootItems, containerId, pinnedThreads),
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
  const setCollapsedFolders = useSetAtom(sidebarCollapsedFoldersAtom);
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
      const directDrop = resolveFolderThreadDropTarget(
        lookup,
        activeId,
        overId,
      );
      const drop =
        directDrop ??
        (overId === activeId && dragOverParentKey !== null
          ? resolveProjectedFolderThreadDropTarget(
              lookup,
              activeId,
              dragOverParentKey,
            )
          : null);
      const decision = resolveFolderThreadDropDecision(
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
        setCollapsedFolders((current) =>
          current.includes(targetParentKey)
            ? current.filter((key) => key !== targetParentKey)
            : current,
        );
      }, FOLDER_AUTO_EXPAND_MS);
    },
    [
      clearDropDwell,
      containerId,
      dragOverParentKey,
      enabled,
      lookup,
      setCollapsedFolders,
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
        const sectionOverId = resolveFolderThreadSectionOverId(lookup, overId);
        const nextOrder = reorderSidebarSectionOrder({
          activeId,
          overId: sectionOverId,
          order: topLevelSectionOrder,
        });
        if (nextOrder) onTopLevelSectionOrderChange(nextOrder);
        clearProjectedDrag();
        return;
      }

      const decision = resolveFolderThreadDropDecision(
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
            folderId: decision.folderId,
          });
          break;
        case "pin":
          pinThread.mutate({ id: decision.activeId });
          break;
        case "unpin":
          if (decision.move) {
            unpinAndMoveThread.mutate({
              id: decision.activeId,
              folderId: decision.folderId,
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
    projectedFolderId:
      activeThread && dragOverParentKey !== null
        ? lookup.folderIdByParentKey.get(dragOverParentKey)
        : undefined,
    pinnedItemIds,
    pinnedReorderPending,
  };
}
