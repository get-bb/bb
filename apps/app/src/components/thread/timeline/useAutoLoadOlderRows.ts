import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useBottomAnchoredScroll } from "@/components/ui/bottom-anchored-scroll-body.js";

const AUTO_LOAD_OLDER_ROWS_PREFETCH_MARGIN_PX = 600;

interface UseAutoLoadOlderRowsArgs {
  hasOlderTimelineRows: boolean;
  isLoadingOlderTimelineRows: boolean;
  onLoadOlderRows: (() => Promise<void> | void) | undefined;
}

interface AutoLoadOlderRows {
  sentinelRef: (node: HTMLElement | null) => void;
  isAutoLoadEnabled: boolean;
  loadOlderRows: () => void;
}

function isSentinelWithinPrefetchRange({
  scrollElement,
  sentinel,
}: {
  scrollElement: HTMLElement;
  sentinel: HTMLElement;
}): boolean {
  const scrollRect = scrollElement.getBoundingClientRect();
  const sentinelRect = sentinel.getBoundingClientRect();
  return (
    sentinelRect.bottom >=
      scrollRect.top - AUTO_LOAD_OLDER_ROWS_PREFETCH_MARGIN_PX &&
    sentinelRect.top <= scrollRect.bottom
  );
}

export function useAutoLoadOlderRows({
  hasOlderTimelineRows,
  isLoadingOlderTimelineRows,
  onLoadOlderRows,
}: UseAutoLoadOlderRowsArgs): AutoLoadOlderRows {
  const bottomAnchor = useBottomAnchoredScroll();
  const sentinelNodeRef = useRef<HTMLElement | null>(null);
  const loadInFlightRef = useRef(false);
  const [autoLoadFailed, setAutoLoadFailed] = useState(false);

  const sentinelRef = useCallback((node: HTMLElement | null) => {
    sentinelNodeRef.current = node;
  }, []);

  const isAutoLoadEnabled =
    bottomAnchor !== null &&
    hasOlderTimelineRows &&
    onLoadOlderRows !== undefined &&
    !autoLoadFailed;

  const startLoad = useCallback(() => {
    if (!onLoadOlderRows) {
      return;
    }
    loadInFlightRef.current = true;
    void (async () => {
      try {
        await onLoadOlderRows();
      } catch {
        setAutoLoadFailed(true);
      } finally {
        loadInFlightRef.current = false;
      }
    })();
  }, [onLoadOlderRows]);

  const loadOlderRows = useCallback(() => {
    setAutoLoadFailed(false);
    startLoad();
  }, [startLoad]);

  const liveRef = useRef({
    isAutoLoadEnabled,
    isLoadingOlderTimelineRows,
    startLoad,
  });
  useLayoutEffect(() => {
    liveRef.current = {
      isAutoLoadEnabled,
      isLoadingOlderTimelineRows,
      startLoad,
    };
  });

  const loadIfSentinelInRange = useCallback(() => {
    const live = liveRef.current;
    if (
      !live.isAutoLoadEnabled ||
      live.isLoadingOlderTimelineRows ||
      loadInFlightRef.current
    ) {
      return;
    }
    const sentinel = sentinelNodeRef.current;
    const scrollElement = bottomAnchor?.getScrollElement();
    if (!sentinel?.isConnected || !scrollElement) {
      return;
    }
    if (isSentinelWithinPrefetchRange({ scrollElement, sentinel })) {
      live.startLoad();
    }
  }, [bottomAnchor]);

  const positionKeeper = bottomAnchor?.positionKeeper ?? null;
  useEffect(() => {
    if (positionKeeper === null) return;
    let timeout: number | null = null;
    const unsubscribe = positionKeeper.subscribePosition(() => {
      timeout ??= window.setTimeout(() => {
        timeout = null;
        loadIfSentinelInRange();
      }, 0);
    });
    return () => {
      unsubscribe();
      if (timeout !== null) window.clearTimeout(timeout);
    };
  }, [loadIfSentinelInRange, positionKeeper]);

  useEffect(() => {
    loadIfSentinelInRange();
  }, [
    isAutoLoadEnabled,
    isLoadingOlderTimelineRows,
    loadIfSentinelInRange,
    startLoad,
  ]);

  return { sentinelRef, isAutoLoadEnabled, loadOlderRows };
}
