import type { SidebarThread } from "./sidebar-thread.js";
import type { ThreadComparator } from "./project-thread-groups.js";
import { isUnreadDoneThread } from "./thread-activity.js";

export interface HeldReadStatus {
  threadId: string;
  isUnread: boolean;
}

export type ThreadUnreadPredicate = (thread: SidebarThread) => boolean;

export function createThreadUnreadPredicate(
  held: HeldReadStatus | null,
): ThreadUnreadPredicate {
  return (thread) =>
    isUnreadDoneThread(
      held !== null && thread.id === held.threadId
        ? { ...thread, isUnread: held.isUnread }
        : thread,
    );
}

export function groupComparatorByReadStatus(
  compareThreads: ThreadComparator,
  isUnread: ThreadUnreadPredicate,
): ThreadComparator {
  const compareReadStatus = (left: SidebarThread, right: SidebarThread) =>
    Number(isUnread(right)) - Number(isUnread(left));
  const grouped: ThreadComparator = (left, right) =>
    compareReadStatus(left, right) || compareThreads(left, right);
  const compareItems = compareThreads.compareItems;
  if (compareItems) {
    grouped.compareItems = (left, right) =>
      (left.kind === "thread" && right.kind === "thread"
        ? compareReadStatus(left.node.thread, right.node.thread)
        : 0) || compareItems(left, right);
  }
  return grouped;
}

export function collapseParentThreads(
  threads: readonly SidebarThread[],
  expandedThreadIds: readonly string[],
): Set<string> {
  const expanded = new Set(expandedThreadIds);
  const collapsed = new Set<string>();
  for (const thread of threads) {
    if (
      thread.parentThreadId !== null &&
      !expanded.has(thread.parentThreadId)
    ) {
      collapsed.add(thread.parentThreadId);
    }
  }
  return collapsed;
}
