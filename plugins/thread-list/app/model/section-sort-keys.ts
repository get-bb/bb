import { compareCodepoint } from "./compare-codepoint.js";
import {
  isSidebarProjectThread,
  type ProjectThreadItem,
  type ThreadComparator,
} from "./project-thread-groups.js";
import type { SidebarThread } from "./sidebar-thread.js";

export type SidebarSortKeys = ReadonlyMap<string, number>;

export const SIDEBAR_SORT_KEY_FIELD = "sidebarSortKey";

export function readSidebarSortKey(metadata: {
  readonly [key: string]: unknown;
}): number | null {
  const value = metadata[SIDEBAR_SORT_KEY_FIELD];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function isSidebarSortKeyCandidate(thread: SidebarThread): boolean {
  return (
    thread.originPluginId !== null &&
    thread.sectionId !== null &&
    isSidebarProjectThread(thread)
  );
}

export function findSortKeyedSectionIds(
  threads: readonly SidebarThread[],
  sortKeys: SidebarSortKeys,
): ReadonlySet<string> {
  if (sortKeys.size === 0) {
    return new Set();
  }
  const visibleThreads = threads.filter(isSidebarProjectThread);
  const visibleThreadIds = new Set(visibleThreads.map((thread) => thread.id));
  const keyedSectionIds = new Set<string>();
  const unkeyedSectionIds = new Set<string>();
  for (const thread of visibleThreads) {
    if (
      thread.sectionId === null ||
      (thread.parentThreadId !== null &&
        visibleThreadIds.has(thread.parentThreadId))
    ) {
      continue;
    }
    if (sortKeys.has(thread.id)) {
      keyedSectionIds.add(thread.sectionId);
    } else {
      unkeyedSectionIds.add(thread.sectionId);
    }
  }
  for (const sectionId of unkeyedSectionIds) {
    keyedSectionIds.delete(sectionId);
  }
  return keyedSectionIds;
}

function representativeThread(item: ProjectThreadItem): SidebarThread | null {
  switch (item.kind) {
    case "thread":
      return item.node.thread;
    case "environment":
      return item.group.nodes[0].thread;
    case "section":
      return null;
  }
}

export function sortKeyedSectionsSoonestFirst(
  compareThreads: ThreadComparator,
  sortKeys: SidebarSortKeys,
  keyedSectionIds: ReadonlySet<string>,
): ThreadComparator {
  if (keyedSectionIds.size === 0) {
    return compareThreads;
  }
  const keyedSectionOf = (thread: SidebarThread): string | null =>
    thread.sectionId !== null && keyedSectionIds.has(thread.sectionId)
      ? thread.sectionId
      : null;
  const compareKeyed = (
    left: SidebarThread,
    right: SidebarThread,
    leftSectionId: string,
    rightSectionId: string,
  ): number => {
    if (leftSectionId !== rightSectionId) {
      return compareCodepoint(leftSectionId, rightSectionId);
    }
    const leftKey = sortKeys.get(left.id);
    const rightKey = sortKeys.get(right.id);
    if (leftKey === undefined || rightKey === undefined) {
      if (leftKey !== rightKey) {
        return leftKey === undefined ? 1 : -1;
      }
      return compareThreads(left, right);
    }
    return leftKey - rightKey || compareCodepoint(left.id, right.id);
  };
  const compare: ThreadComparator = (left, right) => {
    const leftSectionId = keyedSectionOf(left);
    const rightSectionId = keyedSectionOf(right);
    if (leftSectionId === null && rightSectionId === null) {
      return compareThreads(left, right);
    }
    if (leftSectionId === null || rightSectionId === null) {
      return leftSectionId === null ? 1 : -1;
    }
    return compareKeyed(left, right, leftSectionId, rightSectionId);
  };
  const compareItems = compareThreads.compareItems;
  if (compareItems) {
    compare.compareItems = (left, right) => {
      const leftThread = representativeThread(left);
      const rightThread = representativeThread(right);
      if (
        leftThread === null ||
        rightThread === null ||
        (keyedSectionOf(leftThread) === null &&
          keyedSectionOf(rightThread) === null)
      ) {
        return compareItems(left, right);
      }
      return compare(leftThread, rightThread);
    };
  }
  return compare;
}
