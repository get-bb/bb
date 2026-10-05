import type { SidebarThread } from "./sidebar-thread.js";
import type {
  ProjectThreadItem,
  ThreadComparator,
} from "./project-thread-groups.js";
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

function itemThread(item: ProjectThreadItem): SidebarThread | null {
  switch (item.kind) {
    case "thread":
      return item.node.thread;
    case "environment":
      return item.group.nodes[0].thread;
    case "section":
      return null;
  }
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
    grouped.compareItems = (left, right) => {
      const leftThread = itemThread(left);
      const rightThread = itemThread(right);
      const readStatusDelta =
        leftThread && rightThread
          ? compareReadStatus(leftThread, rightThread)
          : 0;
      return readStatusDelta || compareItems(left, right);
    };
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
