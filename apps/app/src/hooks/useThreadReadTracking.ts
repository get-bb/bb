import { useEffect, useRef } from "react";
import type { Thread } from "@bb/domain";
import { isThreadRead, type ThreadReadState } from "@bb/client-core";
import {
  isDocumentVisible,
  useDocumentVisibilityRevision,
} from "@/lib/document-visibility";

type ThreadReadTrackingState = ThreadReadState & Pick<Thread, "id">;

interface MarkThreadReadMutation {
  mutate: (
    input: { signal?: AbortSignal; threadId: string },
    options?: { onError?: () => void; onSettled?: () => void },
  ) => void;
}

interface UseThreadReadTrackingParams {
  markThreadRead: MarkThreadReadMutation;
  thread?: ThreadReadTrackingState;
}

interface ReadTrackingSnapshot {
  isVisible: boolean;
  isRead: boolean | null;
  latestAttentionAt: number | null;
  threadId: string | null;
}

export function useThreadReadTracking({
  markThreadRead,
  thread,
}: UseThreadReadTrackingParams) {
  const failedReadKeysRef = useRef<Set<string>>(new Set());
  const pendingReadControllersRef = useRef<Map<string, AbortController>>(
    new Map(),
  );
  const suppressedManualUnreadKeysRef = useRef<Set<string>>(new Set());
  const previousSnapshotRef = useRef<ReadTrackingSnapshot | null>(null);
  const visibilityRevision = useDocumentVisibilityRevision();
  const isVisible = isDocumentVisible();

  useEffect(() => {
    const previousSnapshot = previousSnapshotRef.current;
    const threadIsRead = thread ? isThreadRead(thread) : null;
    const currentSnapshot: ReadTrackingSnapshot = {
      isVisible,
      isRead: threadIsRead,
      latestAttentionAt: thread?.latestAttentionAt ?? null,
      threadId: thread?.id ?? null,
    };
    previousSnapshotRef.current = currentSnapshot;

    if (previousSnapshot?.threadId !== currentSnapshot.threadId) {
      const previousMarker = previousSnapshot?.threadId
        ? `${previousSnapshot.threadId}:${previousSnapshot.latestAttentionAt}`
        : null;
      if (previousMarker) {
        pendingReadControllersRef.current.get(previousMarker)?.abort();
        pendingReadControllersRef.current.delete(previousMarker);
      }
    }

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
      failedReadKeysRef.current.delete(marker);
      pendingReadControllersRef.current.delete(marker);
      suppressedManualUnreadKeysRef.current.delete(marker);
      return;
    }

    const becameVisible =
      previousSnapshot?.threadId === thread.id &&
      previousSnapshot.isVisible === false;
    const isRetry = failedReadKeysRef.current.has(marker);
    const becameManuallyUnread =
      previousSnapshot?.threadId === thread.id &&
      previousSnapshot.latestAttentionAt === thread.latestAttentionAt &&
      previousSnapshot.isVisible &&
      previousSnapshot.isRead === true &&
      !isRetry;

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

    if (!isOpenedThread && !hasNewAttention && !becameVisible && !isRetry) {
      return;
    }
    if (pendingReadControllersRef.current.has(marker)) {
      return;
    }

    failedReadKeysRef.current.delete(marker);
    const controller = new AbortController();
    pendingReadControllersRef.current.set(marker, controller);
    markThreadRead.mutate(
      { signal: controller.signal, threadId: thread.id },
      {
        onError: () => {
          pendingReadControllersRef.current.delete(marker);
          failedReadKeysRef.current.add(marker);
        },
        onSettled: () => {
          pendingReadControllersRef.current.delete(marker);
        },
      },
    );
  }, [isVisible, markThreadRead, thread, visibilityRevision]);
}
