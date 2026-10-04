import { useState } from "react";
import type { SidebarThread } from "../model/sidebar-thread.js";
import type { ThreadUnreadPredicate } from "../model/project-thread-groups.js";

interface HeldReadStatus {
  threadId: string;
  isUnread: boolean;
}

let lastHeldReadStatus: HeldReadStatus | null = null;

export function useHeldReadStatus(
  threads: readonly SidebarThread[],
  selectedThreadId: string | undefined,
): HeldReadStatus | null {
  const [held, setHeld] = useState<HeldReadStatus | null>(() =>
    lastHeldReadStatus?.threadId === selectedThreadId
      ? lastHeldReadStatus
      : null,
  );
  if (held?.threadId === selectedThreadId) {
    return held;
  }
  const thread =
    selectedThreadId === undefined
      ? undefined
      : threads.find((candidate) => candidate.id === selectedThreadId);
  const next = thread
    ? { threadId: thread.id, isUnread: thread.isUnread }
    : null;
  lastHeldReadStatus = next;
  if (next !== null || held !== null) {
    setHeld(next);
  }
  return next;
}

export function createThreadUnreadPredicate(
  threads: readonly SidebarThread[],
  held: HeldReadStatus | null,
): ThreadUnreadPredicate {
  const threadById = new Map(threads.map((thread) => [thread.id, thread]));
  const unreadThreadIds = new Set<string>();
  for (const thread of threads) {
    const isUnread =
      held !== null && thread.id === held.threadId
        ? held.isUnread
        : thread.isUnread;
    if (thread.isHidden || !isUnread) continue;
    let current: SidebarThread | undefined = thread;
    while (current !== undefined && !unreadThreadIds.has(current.id)) {
      unreadThreadIds.add(current.id);
      current =
        current.parentThreadId === null
          ? undefined
          : threadById.get(current.parentThreadId);
    }
  }
  return (thread) => unreadThreadIds.has(thread.id);
}
