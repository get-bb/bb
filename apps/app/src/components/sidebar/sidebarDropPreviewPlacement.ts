import type { ThreadListEntry } from "@bb/domain";
import {
  buildPinnedSidebarState,
  buildProjectThreadGroups,
  buildSectionThreadList,
  CHRONOLOGICAL_CONTAINER_ID,
  type ProjectThreadItem,
  type ProjectThreadNode,
  type SidebarSectionDefinition,
  type ThreadComparator,
} from "@bb/client-core";

export type SidebarDropPreviewTarget =
  | { kind: "container"; parentKey: string; sectionId: string | null }
  | { kind: "group"; parentKey: string; items: readonly ProjectThreadItem[] }
  | { kind: "nest"; parentThreadId: string }
  | { kind: "pinned"; parentKey: string };

export interface SidebarDropPreviewPlacement {
  parentKey: string;
  beforeItemKey: string | null;
}

interface ResolveSidebarDropPreviewPlacementArgs {
  activeThread: ThreadListEntry;
  compareThreads: ThreadComparator | undefined;
  draftThreadIds: ReadonlySet<string>;
  pinnedRootNodes: readonly ProjectThreadNode[];
  sections: readonly SidebarSectionDefinition[];
  target: SidebarDropPreviewTarget;
  threads: readonly ThreadListEntry[];
}

export function getSidebarItemKey(item: ProjectThreadItem): string {
  switch (item.kind) {
    case "thread":
      return `thread:${item.node.thread.id}`;
    case "environment":
      return `env:${item.group.environmentId}`;
    case "section":
      return `section:${item.group.key}`;
  }
}

export function getSidebarNestParentKey(parentThreadId: string): string {
  return `nest:${parentThreadId}`;
}

function flattenNodeThreads(
  items: readonly ProjectThreadItem[],
  out: ThreadListEntry[] = [],
): ThreadListEntry[] {
  for (const item of items) {
    if (item.kind === "thread") {
      out.push(item.node.thread);
      flattenNodeThreads(item.node.children, out);
    } else if (item.kind === "environment") {
      for (const node of item.group.nodes) {
        out.push(node.thread);
        flattenNodeThreads(node.children, out);
      }
    } else {
      flattenNodeThreads(item.group.items, out);
    }
  }
  return out;
}

function findThreadNode(
  items: readonly ProjectThreadItem[],
  threadId: string,
): ProjectThreadNode | null {
  for (const item of items) {
    if (item.kind === "thread") {
      if (item.node.thread.id === threadId) return item.node;
      const nested = findThreadNode(item.node.children, threadId);
      if (nested) return nested;
    } else if (item.kind === "environment") {
      for (const node of item.group.nodes) {
        if (node.thread.id === threadId) return node;
        const nested = findThreadNode(node.children, threadId);
        if (nested) return nested;
      }
    } else {
      const nested = findThreadNode(item.group.items, threadId);
      if (nested) return nested;
    }
  }
  return null;
}

function itemHoldsThread(item: ProjectThreadItem, threadId: string): boolean {
  if (item.kind === "thread") return item.node.thread.id === threadId;
  if (item.kind === "environment") {
    return item.group.nodes.some((node) => node.thread.id === threadId);
  }
  return false;
}

function beforeKeyAfterThread(
  siblings: readonly ProjectThreadItem[],
  threadId: string,
): string | null {
  const index = siblings.findIndex((item) => itemHoldsThread(item, threadId));
  if (index === -1) return null;
  const next = siblings[index + 1];
  return next ? getSidebarItemKey(next) : null;
}

function withPatchedThread(
  threads: readonly ThreadListEntry[],
  patched: ThreadListEntry,
): ThreadListEntry[] {
  const others = threads.filter((thread) => thread.id !== patched.id);
  return [...others, patched];
}

function findSectionItems(
  items: readonly ProjectThreadItem[],
  sectionKey: string,
): readonly ProjectThreadItem[] {
  for (const item of items) {
    if (item.kind === "section" && item.group.key === sectionKey) {
      return item.group.items;
    }
  }
  return [];
}

function nodesToItems(
  nodes: readonly ProjectThreadNode[],
): ProjectThreadItem[] {
  return nodes.map((node) => ({ kind: "thread", node }));
}

export function resolveSidebarDropPreviewPlacement({
  activeThread,
  compareThreads,
  draftThreadIds,
  pinnedRootNodes,
  sections,
  target,
  threads,
}: ResolveSidebarDropPreviewPlacementArgs): SidebarDropPreviewPlacement {
  const pinnedItems = nodesToItems(pinnedRootNodes);
  if (target.kind === "pinned") {
    const projected = buildPinnedSidebarState({
      draftThreadIds,
      threads: withPatchedThread(flattenNodeThreads(pinnedItems), {
        ...activeThread,
        parentThreadId: null,
        pinnedAt: Number.MAX_SAFE_INTEGER,
        pinSortKey: null,
      }),
    });
    return {
      parentKey: target.parentKey,
      beforeItemKey: beforeKeyAfterThread(
        nodesToItems(projected.rootNodes),
        activeThread.id,
      ),
    };
  }

  if (target.kind === "group") {
    const projected = buildProjectThreadGroups(
      withPatchedThread(flattenNodeThreads(target.items), {
        ...activeThread,
        parentThreadId: null,
      }),
      compareThreads,
      draftThreadIds,
    );
    return {
      parentKey: target.parentKey,
      beforeItemKey: beforeKeyAfterThread(projected, activeThread.id),
    };
  }

  if (target.kind === "nest") {
    const parentKey = getSidebarNestParentKey(target.parentThreadId);
    if (findThreadNode(pinnedItems, target.parentThreadId)) {
      const projected = buildPinnedSidebarState({
        draftThreadIds,
        threads: withPatchedThread(flattenNodeThreads(pinnedItems), {
          ...activeThread,
          parentThreadId: target.parentThreadId,
          pinnedAt: null,
        }),
      });
      const parentNode = findThreadNode(
        nodesToItems(projected.rootNodes),
        target.parentThreadId,
      );
      return {
        parentKey,
        beforeItemKey: parentNode
          ? beforeKeyAfterThread(parentNode.children, activeThread.id)
          : null,
      };
    }
    const projected = buildSectionThreadList(
      withPatchedThread(threads, {
        ...activeThread,
        parentThreadId: target.parentThreadId,
      }),
      compareThreads,
      sections,
      draftThreadIds,
    );
    const parentNode = findThreadNode(projected, target.parentThreadId);
    return {
      parentKey,
      beforeItemKey: parentNode
        ? beforeKeyAfterThread(parentNode.children, activeThread.id)
        : null,
    };
  }

  const projected = buildSectionThreadList(
    withPatchedThread(threads, {
      ...activeThread,
      parentThreadId: null,
      sectionId: target.sectionId,
    }),
    compareThreads,
    sections,
    draftThreadIds,
  );
  const siblings =
    target.parentKey === CHRONOLOGICAL_CONTAINER_ID
      ? projected.filter((item) => item.kind !== "section")
      : findSectionItems(projected, target.parentKey);
  return {
    parentKey: target.parentKey,
    beforeItemKey: beforeKeyAfterThread(siblings, activeThread.id),
  };
}
