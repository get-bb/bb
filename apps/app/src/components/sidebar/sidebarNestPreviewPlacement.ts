import type { ThreadListEntry } from "@bb/domain";
import {
  buildPinnedSidebarState,
  buildSectionThreadList,
  getProjectThreadItemDescendants,
  type ProjectThreadItem,
  type ProjectThreadNode,
  type SidebarSectionDefinition,
  type ThreadComparator,
} from "@bb/client-core";
import { getSidebarItemKey } from "./sidebarItemKeys";

interface ResolveNestPreviewBeforeKeyArgs {
  activeThread: ThreadListEntry;
  compareThreads: ThreadComparator | undefined;
  draftThreadIds: ReadonlySet<string>;
  parentThreadId: string;
  pinnedRootNodes: readonly ProjectThreadNode[];
  sections: readonly SidebarSectionDefinition[];
  threads: readonly ThreadListEntry[];
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

function nodesToItems(
  nodes: readonly ProjectThreadNode[],
): ProjectThreadItem[] {
  return nodes.map((node) => ({ kind: "thread", node }));
}

export function resolveSidebarNestPreviewBeforeKey({
  activeThread,
  compareThreads,
  draftThreadIds,
  parentThreadId,
  pinnedRootNodes,
  sections,
  threads,
}: ResolveNestPreviewBeforeKeyArgs): string | null {
  const pinnedItems = nodesToItems(pinnedRootNodes);
  if (findThreadNode(pinnedItems, parentThreadId)) {
    const projected = buildPinnedSidebarState({
      draftThreadIds,
      threads: withPatchedThread(getProjectThreadItemDescendants(pinnedItems), {
        ...activeThread,
        parentThreadId,
        pinnedAt: null,
      }),
    });
    const parentNode = findThreadNode(
      nodesToItems(projected.rootNodes),
      parentThreadId,
    );
    return parentNode
      ? beforeKeyAfterThread(parentNode.children, activeThread.id)
      : null;
  }
  const projected = buildSectionThreadList(
    withPatchedThread(threads, { ...activeThread, parentThreadId }),
    compareThreads,
    sections,
    draftThreadIds,
  );
  const parentNode = findThreadNode(projected, parentThreadId);
  return parentNode
    ? beforeKeyAfterThread(parentNode.children, activeThread.id)
    : null;
}
