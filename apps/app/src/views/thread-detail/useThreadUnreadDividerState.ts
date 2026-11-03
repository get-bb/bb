import { useState } from "react";
import type {
  ThreadTimelineUnreadDividerAnchor,
  ThreadTimelineUnreadDividerPlacement,
} from "@/components/thread/timeline";

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
  ready: boolean;
  autoScroll: boolean;
  placement: ThreadTimelineUnreadDividerPlacement | null;
}

interface ShouldTrackThreadUnreadDividerArgs {
  routeThreadId: string | undefined;
  threadId: string | undefined;
}

interface UseThreadUnreadDividerStateArgs {
  anchor: ThreadTimelineUnreadDividerAnchor;
  hasFreshThread: boolean;
  routeThreadId: string | undefined;
  thread: ThreadUnreadDividerThreadState | undefined;
}

const NO_UNREAD_DIVIDER_STATE: ThreadUnreadDividerState = {
  ready: false,
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
  anchor: ThreadTimelineUnreadDividerAnchor,
): ThreadTimelineUnreadDividerPlacement | null {
  if (
    thread.lastReadAt === null ||
    thread.lastReadAt >= thread.latestAttentionAt
  ) {
    return null;
  }
  return { anchor, cutoffAt: thread.lastReadAt };
}

function nextThreadUnreadDividerSnapshot(
  currentSnapshot: ThreadUnreadDividerSnapshot | null,
  thread: ThreadUnreadDividerThreadState,
  hasFreshThread: boolean,
  anchor: ThreadTimelineUnreadDividerAnchor,
): ThreadUnreadDividerSnapshot | null {
  const isOpening = currentSnapshot?.threadId !== thread.id;
  if (isOpening && !hasFreshThread) {
    return null;
  }
  if (
    currentSnapshot?.threadId === thread.id &&
    currentSnapshot.attentionAt === thread.latestAttentionAt
  ) {
    return currentSnapshot;
  }

  const placement = buildUnreadDividerPlacement(thread, anchor);
  return {
    attentionAt: thread.latestAttentionAt,
    autoScroll: isOpening && placement !== null,
    placement,
    threadId: thread.id,
  };
}

export function useThreadUnreadDividerState({
  anchor,
  hasFreshThread,
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
      : nextThreadUnreadDividerSnapshot(
          snapshot,
          trackedThread,
          hasFreshThread,
          anchor,
        );
  if (currentSnapshot !== snapshot) {
    setSnapshot(currentSnapshot);
  }

  if (currentSnapshot === null) {
    return NO_UNREAD_DIVIDER_STATE;
  }

  return {
    ready: true,
    autoScroll: currentSnapshot.autoScroll,
    placement: currentSnapshot.placement,
  };
}
