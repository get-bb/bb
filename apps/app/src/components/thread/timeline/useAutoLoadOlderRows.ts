import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";
import type { LoadOlderTimelineRows } from "./load-older-timeline-rows.js";
import { useBottomAnchoredScroll } from "@/components/ui/bottom-anchored-scroll-body.js";

const AUTO_LOAD_OLDER_ROWS_PREFETCH_MARGIN_PX = 600;
const SCROLL_IDLE_DELAY_MS = 200;

interface UseAutoLoadOlderRowsArgs {
  hasOlderTimelineRows: boolean;
  isLoadingOlderTimelineRows: boolean;
  onLoadOlderRows: LoadOlderTimelineRows | undefined;
}

interface ScrollActivity {
  touching: boolean;
  lastScrollAt: number;
}

function waitForScrollIdle(
  activity: ScrollActivity,
  signal: AbortSignal,
): Promise<boolean> {
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout>;
    const finish = (idle: boolean) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      resolve(idle);
    };
    const abort = () => finish(false);
    const check = () => {
      if (signal.aborted) return finish(false);
      const remaining =
        SCROLL_IDLE_DELAY_MS - (performance.now() - activity.lastScrollAt);
      if (!activity.touching && remaining <= 0) return finish(true);
      timer = setTimeout(
        check,
        activity.touching ? 50 : Math.max(1, remaining),
      );
    };
    signal.addEventListener("abort", abort, { once: true });
    check();
  });
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
  const isIntersectingRef = useRef(false);
  const [sentinelVersion, setSentinelVersion] = useState(0);
  const [intersectionTick, setIntersectionTick] = useState(0);
  const [autoLoadFailed, setAutoLoadFailed] = useState(false);
  const pendingLoadRef = useRef<AbortController | null>(null);
  const scrollActivityRef = useRef<ScrollActivity>({
    touching: false,
    lastScrollAt: -Infinity,
  });
  const getScrollElement = bottomAnchor?.getScrollElement;

  useEffect(() => {
    const scrollElement = getScrollElement?.();
    if (!scrollElement) return;
    const activity = scrollActivityRef.current;
    const onScroll = () => {
      activity.lastScrollAt = performance.now();
    };
    const onTouchStart = () => {
      activity.touching = true;
    };
    const onTouchEnd = () => {
      activity.touching = false;
      onScroll();
    };
    scrollElement.addEventListener("scroll", onScroll, { passive: true });
    scrollElement.addEventListener("touchstart", onTouchStart, {
      passive: true,
    });
    scrollElement.addEventListener("touchend", onTouchEnd, { passive: true });
    scrollElement.addEventListener("touchcancel", onTouchEnd, {
      passive: true,
    });
    return () => {
      scrollElement.removeEventListener("scroll", onScroll);
      scrollElement.removeEventListener("touchstart", onTouchStart);
      scrollElement.removeEventListener("touchend", onTouchEnd);
      scrollElement.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [getScrollElement]);

  useLayoutEffect(
    () => () => {
      pendingLoadRef.current?.abort();
      pendingLoadRef.current = null;
    },
    [],
  );

  const sentinelRef = useCallback((node: HTMLElement | null) => {
    sentinelNodeRef.current = node;
    setSentinelVersion((version) => version + 1);
  }, []);

  const isAutoLoadEnabled =
    bottomAnchor !== null &&
    hasOlderTimelineRows &&
    onLoadOlderRows !== undefined &&
    !autoLoadFailed;

  const startLoad = useCallback(() => {
    if (!onLoadOlderRows || pendingLoadRef.current !== null) {
      return;
    }
    const pending = new AbortController();
    pendingLoadRef.current = pending;
    void (async () => {
      try {
        await onLoadOlderRows(async (update) => {
          if (
            !(await waitForScrollIdle(
              scrollActivityRef.current,
              pending.signal,
            )) ||
            pending.signal.aborted
          )
            return;
          const finish = bottomAnchor?.captureScrollAnchor();
          try {
            flushSync(update);
            finish?.(true);
          } finally {
            finish?.(false);
          }
        });
      } catch {
        if (pendingLoadRef.current === pending) setAutoLoadFailed(true);
      } finally {
        if (pendingLoadRef.current === pending) pendingLoadRef.current = null;
      }
    })();
  }, [bottomAnchor, onLoadOlderRows]);

  const loadOlderRows = useCallback(() => {
    setAutoLoadFailed(false);
    startLoad();
  }, [startLoad]);

  useEffect(() => {
    if (!isAutoLoadEnabled) {
      isIntersectingRef.current = false;
      return;
    }
    const sentinel = sentinelNodeRef.current;
    if (!sentinel) {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries.at(-1);
        isIntersectingRef.current = entry?.isIntersecting ?? false;
        if (isIntersectingRef.current) {
          setIntersectionTick((tick) => tick + 1);
        }
      },
      {
        root: bottomAnchor?.getScrollElement() ?? null,
        rootMargin: `${AUTO_LOAD_OLDER_ROWS_PREFETCH_MARGIN_PX}px 0px 0px 0px`,
      },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [bottomAnchor, isAutoLoadEnabled, sentinelVersion]);

  useEffect(() => {
    if (
      !isAutoLoadEnabled ||
      isLoadingOlderTimelineRows ||
      !isIntersectingRef.current
    ) {
      return;
    }
    const sentinel = sentinelNodeRef.current;
    const scrollElement = bottomAnchor?.getScrollElement();
    if (!sentinel || !scrollElement) {
      return;
    }
    if (!isSentinelWithinPrefetchRange({ scrollElement, sentinel })) {
      isIntersectingRef.current = false;
      return;
    }
    startLoad();
  }, [
    bottomAnchor,
    intersectionTick,
    isAutoLoadEnabled,
    isLoadingOlderTimelineRows,
    startLoad,
  ]);

  return { sentinelRef, isAutoLoadEnabled, loadOlderRows };
}
