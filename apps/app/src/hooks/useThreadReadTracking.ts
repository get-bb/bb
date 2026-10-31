import { useEffect, useRef } from "react";
import type { Thread } from "@bb/domain";
import { isThreadRead, type ThreadReadState } from "@bb/client-core";
import {
  useDocumentVisibilityRevision,
  useDocumentVisible,
} from "@/lib/document-visibility";
import { useUserActive } from "@/lib/user-activity";

type ThreadReadTrackingState = ThreadReadState & Pick<Thread, "id">;

interface MarkThreadReadMutation {
  hasFailed: (threadId: string, latestAttentionAt: number) => boolean;
  noteSeenRead: (threadId: string) => void;
  mutateAsync: (input: {
    threadId: string;
    throughAttentionAt: number;
  }) => Promise<unknown>;
}

interface UseThreadReadTrackingParams {
  markThreadRead: MarkThreadReadMutation;
  thread?: ThreadReadTrackingState;
}

interface ReadTrackingSnapshot {
  isActive: boolean;
  isVisible: boolean;
  isRead: boolean | null;
  latestAttentionAt: number | null;
  threadId: string | null;
  visibilityRevision: number;
}

export function useThreadReadTracking({
  markThreadRead,
  thread,
}: UseThreadReadTrackingParams) {
  const suppressedManualUnreadKeysRef = useRef<Set<string>>(new Set());
  const previousSnapshotRef = useRef<ReadTrackingSnapshot | null>(null);
  const visibilityRevision = useDocumentVisibilityRevision();
  const isVisible = useDocumentVisible();
  const isActive = useUserActive();

  useEffect(() => {
    const previousSnapshot = previousSnapshotRef.current;
    const threadIsRead = thread ? isThreadRead(thread) : null;
    const currentSnapshot: ReadTrackingSnapshot = {
      isActive,
      isVisible,
      isRead: threadIsRead,
      latestAttentionAt: thread?.latestAttentionAt ?? null,
      threadId: thread?.id ?? null,
      visibilityRevision,
    };
    previousSnapshotRef.current = currentSnapshot;

    if (!isVisible) {
      return;
    }
    if (!thread) {
      return;
    }

    const marker = `${thread.id}:${thread.latestAttentionAt}`;
    const isOpenedThread =
      previousSnapshot === null || previousSnapshot.threadId !== thread.id;
    const hasNewAttention =
      previousSnapshot?.threadId === thread.id &&
      previousSnapshot.latestAttentionAt !== thread.latestAttentionAt;
    if (isOpenedThread || hasNewAttention) {
      suppressedManualUnreadKeysRef.current.clear();
    }

    if (threadIsRead) {
      markThreadRead.noteSeenRead(thread.id);
      suppressedManualUnreadKeysRef.current.delete(marker);
      return;
    }

    const readFailed = markThreadRead.hasFailed(
      thread.id,
      thread.latestAttentionAt,
    );
    const becameManuallyUnread =
      previousSnapshot?.threadId === thread.id &&
      previousSnapshot.latestAttentionAt === thread.latestAttentionAt &&
      previousSnapshot.isVisible &&
      previousSnapshot.isRead === true &&
      !readFailed;

    if (becameManuallyUnread) {
      suppressedManualUnreadKeysRef.current.add(marker);
    }
    if (
      suppressedManualUnreadKeysRef.current.has(marker) &&
      !isOpenedThread &&
      !hasNewAttention
    ) {
      return;
    }

    if (!isActive) {
      return;
    }
    const becameActive =
      previousSnapshot?.threadId === thread.id &&
      previousSnapshot.isActive === false;
    const retryFailedRead =
      readFailed && previousSnapshot?.visibilityRevision !== visibilityRevision;
    if (
      !isOpenedThread &&
      !hasNewAttention &&
      !becameActive &&
      !retryFailedRead
    ) {
      return;
    }

    void markThreadRead
      .mutateAsync({
        threadId: thread.id,
        throughAttentionAt: thread.latestAttentionAt,
      })
      .catch(() => undefined);
  }, [isActive, isVisible, markThreadRead, thread, visibilityRevision]);
}
