import { useEffect, useRef, useState } from "react";
import type { Thread } from "@bb/domain";
import { isThreadRead } from "@/lib/thread-read-state";
import { useMarkThreadRead } from "../../hooks/mutations/thread-state-mutations";

interface UseThreadReadTrackingParams {
  markThreadRead: ReturnType<typeof useMarkThreadRead>;
  thread?: Thread;
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
  const markedReadKeysRef = useRef<Set<string>>(new Set());
  const isVisible = useDocumentVisible();

  useEffect(() => {
    if (!isVisible) {
      return;
    }
    if (!thread) {
      return;
    }
    if (isThreadRead(thread)) {
      return;
    }

    const marker = `${thread.id}:${thread.latestAttentionAt}`;
    if (markedReadKeysRef.current.has(marker)) {
      return;
    }

    markedReadKeysRef.current.add(marker);
    markThreadRead.mutate(thread.id, {
      onError: () => {
        markedReadKeysRef.current.delete(marker);
      },
    });
  }, [isVisible, markThreadRead, thread]);
}
