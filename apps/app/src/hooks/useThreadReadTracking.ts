import { useEffect, useRef, useState } from "react";
import type { Thread } from "@bb/domain";
import {
  isThreadRead,
  type ThreadReadState,
} from "@/lib/thread-read-state";

type ThreadReadTrackingState = ThreadReadState & Pick<Thread, "id">;

interface MarkThreadReadMutation {
  mutate: (
    threadId: string,
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

function isDocumentVisible(): boolean {
  return (
    typeof document === "undefined" || document.visibilityState === "visible"
  );
}

function useDocumentVisible(): boolean {
  const [visible, setVisible] = useState(isDocumentVisible);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    const handleVisibilityChange = () => {
      setVisible(isDocumentVisible());
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  return visible;
}

export function useThreadReadTracking({
  markThreadRead,
  thread,
}: UseThreadReadTrackingParams) {
  const failedReadKeysRef = useRef<Set<string>>(new Set());
  const pendingReadKeysRef = useRef<Set<string>>(new Set());
  const suppressedManualUnreadKeysRef = useRef<Set<string>>(new Set());
  const previousSnapshotRef = useRef<ReadTrackingSnapshot | null>(null);
  const isVisible = useDocumentVisible();

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
      pendingReadKeysRef.current.delete(marker);
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
    if (pendingReadKeysRef.current.has(marker)) {
      return;
    }

    failedReadKeysRef.current.delete(marker);
    pendingReadKeysRef.current.add(marker);
    markThreadRead.mutate(thread.id, {
      onError: () => {
        pendingReadKeysRef.current.delete(marker);
        failedReadKeysRef.current.add(marker);
      },
      onSettled: () => {
        pendingReadKeysRef.current.delete(marker);
      },
    });
  }, [isVisible, markThreadRead, thread]);
}
