import { useState } from "react";
import type { ThreadTimelineUnreadDividerPlacement } from "@/components/thread/timeline";

interface ThreadUnreadDividerThreadState {
  id: string;
  lastReadAt: number | null;
  latestAttentionAt: number;
}

interface ThreadUnreadDividerSnapshot {
  attentionAt: number;
  autoScroll: boolean;
  placement: ThreadTimelineUnreadDividerPlacement | null;
  threadId: string;
}

interface ThreadUnreadDividerState {
  autoScroll: boolean;
  placement: ThreadTimelineUnreadDividerPlacement | null;
}

interface ShouldTrackThreadUnreadDividerArgs {
  routeThreadId: string | undefined;
  threadId: string | undefined;
}

interface UseThreadUnreadDividerStateArgs {
  routeThreadId: string | undefined;
  thread: ThreadUnreadDividerThreadState | undefined;
}

const NO_UNREAD_DIVIDER_STATE: ThreadUnreadDividerState = {
  autoScroll: false,
  placement: null,
};

function shouldTrackThreadUnreadDivider({
  routeThreadId,
  threadId,
}: ShouldTrackThreadUnreadDividerArgs): boolean {
  if (threadId === undefined || routeThreadId !== threadId) {
    return false;
  }

  return true;
}

function buildUnreadDividerPlacement(
  thread: ThreadUnreadDividerThreadState,
): ThreadTimelineUnreadDividerPlacement | null {
  if (thread.lastReadAt === null) {
    return { kind: "before-first" };
  }
  if (thread.lastReadAt < thread.latestAttentionAt) {
    return { kind: "after-cutoff", cutoffAt: thread.lastReadAt };
  }
  return null;
}

function nextThreadUnreadDividerSnapshot(
  currentSnapshot: ThreadUnreadDividerSnapshot | null,
  thread: ThreadUnreadDividerThreadState,
): ThreadUnreadDividerSnapshot {
  if (
    currentSnapshot?.threadId === thread.id &&
    currentSnapshot.attentionAt === thread.latestAttentionAt
  ) {
    if (thread.lastReadAt === null) {
      if (currentSnapshot.placement?.kind === "before-first") {
        return currentSnapshot;
      }
      return {
        attentionAt: thread.latestAttentionAt,
        autoScroll:
          currentSnapshot.placement !== null && currentSnapshot.autoScroll,
        placement: { kind: "before-first" },
        threadId: thread.id,
      };
    }
    return currentSnapshot;
  }

  const placement = buildUnreadDividerPlacement(thread);
  return {
    attentionAt: thread.latestAttentionAt,
    autoScroll: currentSnapshot?.threadId !== thread.id && placement !== null,
    placement,
    threadId: thread.id,
  };
}

export function useThreadUnreadDividerState({
  routeThreadId,
  thread,
}: UseThreadUnreadDividerStateArgs): ThreadUnreadDividerState {
  const [snapshot, setSnapshot] = useState<ThreadUnreadDividerSnapshot | null>(
    null,
  );
  const threadId = thread?.id;
  const threadLastReadAt = thread?.lastReadAt;
  const threadLatestAttentionAt = thread?.latestAttentionAt;
  const trackedThread: ThreadUnreadDividerThreadState | null =
    threadId === undefined ||
    threadLastReadAt === undefined ||
    threadLatestAttentionAt === undefined ||
    !shouldTrackThreadUnreadDivider({ routeThreadId, threadId })
      ? null
      : {
          id: threadId,
          lastReadAt: threadLastReadAt,
          latestAttentionAt: threadLatestAttentionAt,
        };
  const currentSnapshot =
    trackedThread === null
      ? null
      : nextThreadUnreadDividerSnapshot(snapshot, trackedThread);
  if (currentSnapshot !== snapshot) {
    setSnapshot(currentSnapshot);
  }

  if (currentSnapshot === null) {
    return NO_UNREAD_DIVIDER_STATE;
  }

  return {
    autoScroll: currentSnapshot.autoScroll,
    placement: currentSnapshot.placement,
  };
}
