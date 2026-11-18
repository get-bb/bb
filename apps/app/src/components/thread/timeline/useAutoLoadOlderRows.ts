import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { useBottomAnchoredScroll } from "@/components/ui/bottom-anchored-scroll-body.js";

const AUTO_LOAD_OLDER_ROWS_PREFETCH_MARGIN_PX = 600;
const AUTO_LOAD_OLDER_ROWS_PREFETCH_SCREENS = 3;

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
  const margin = Math.max(
    AUTO_LOAD_OLDER_ROWS_PREFETCH_MARGIN_PX,
    scrollRect.height * AUTO_LOAD_OLDER_ROWS_PREFETCH_SCREENS,
  );
  return (
    sentinelRect.bottom >= scrollRect.top - margin &&
    sentinelRect.top <= scrollRect.bottom
  );
}

async function runOlderRowsLoad(
  onLoadOlderRows: () => Promise<void> | void,
  loadInFlightRef: RefObject<boolean>,
  setAutoLoadFailed: (failed: boolean) => void,
): Promise<void> {
  try {
    await onLoadOlderRows();
  } catch {
    setAutoLoadFailed(true);
  } finally {
    loadInFlightRef.current = false;
  }
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
    void runOlderRowsLoad(onLoadOlderRows, loadInFlightRef, setAutoLoadFailed);
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
    const scheduled: { timeout: number | null } = { timeout: null };
    const unsubscribe = positionKeeper.subscribePosition(() => {
      if (scheduled.timeout !== null) return;
      scheduled.timeout = window.setTimeout(() => {
        scheduled.timeout = null;
        loadIfSentinelInRange();
      }, 0);
    });
    return () => {
      unsubscribe();
      if (scheduled.timeout !== null) window.clearTimeout(scheduled.timeout);
    };
  }, [loadIfSentinelInRange, positionKeeper]);

  useEffect(() => {
    let timeout: number | null = null;
    const frame = window.requestAnimationFrame(() => {
      timeout = window.setTimeout(loadIfSentinelInRange, 0);
    });
    return () => {
      window.cancelAnimationFrame(frame);
      if (timeout !== null) window.clearTimeout(timeout);
    };
  }, [
    isAutoLoadEnabled,
    isLoadingOlderTimelineRows,
    loadIfSentinelInRange,
    startLoad,
  ]);

  return { sentinelRef, isAutoLoadEnabled, loadOlderRows };
}
