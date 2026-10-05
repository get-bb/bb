import { useEffect, useState } from "react";
import type { SidebarThread } from "../model/sidebar-thread.js";
import type { ThreadUnreadPredicate } from "../model/project-thread-groups.js";
import { isUnreadDoneThread } from "../model/thread-activity.js";

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
  useEffect(() => {
    lastHeldReadStatus = held;
  }, [held]);
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
  if (next !== null || held !== null) {
    setHeld(next);
  }
  return next;
}

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
