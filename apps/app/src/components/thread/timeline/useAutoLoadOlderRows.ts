import { useCallback, useEffect, useRef, useState } from "react";
import { useBottomAnchoredScroll } from "@/components/ui/bottom-anchored-scroll-body.js";

/**
 * Begin fetching this far before the top of the loaded window actually reaches
 * the viewport, so the next page is usually in place by the time the user gets
 * there and the timeline reads as continuous rather than paged.
 */
const AUTO_LOAD_OLDER_ROWS_PREFETCH_MARGIN_PX = 600;

interface UseAutoLoadOlderRowsArgs {
  hasOlderTimelineRows: boolean;
  isLoadingOlderTimelineRows: boolean;
  onLoadOlderRows: (() => Promise<void> | void) | undefined;
}

interface AutoLoadOlderRows {
  /**
   * Attach to the element marking the top of the loaded window. Null-safe to
   * attach even when auto-loading is off.
   */
  sentinelRef: (node: HTMLElement | null) => void;
  /**
   * True when scrolling to the top loads the next page on its own, so the
   * caller can show progress instead of a button to press.
   */
  isAutoLoadEnabled: boolean;
  /** Manual trigger. Also clears a previous failure so the retry can proceed. */
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

  const sentinelRef = useCallback((node: HTMLElement | null) => {
    sentinelNodeRef.current = node;
    // Re-run the observer effect once the node actually mounts; a plain ref
    // assignment is invisible to the effect's dependency list.
    setSentinelVersion((version) => version + 1);
  }, []);

  /**
   * Prepending older rows only keeps the reading position because the bottom
   * anchor re-applies the height delta afterwards. Without that context (some
   * embedded surfaces render no scroll body) auto-loading would yank the view
   * on every fetch, so scroll-triggered loading stays off and the manual button
   * remains the only path.
   */
  const isAutoLoadEnabled =
    bottomAnchor !== null &&
    hasOlderTimelineRows &&
    onLoadOlderRows !== undefined &&
    !autoLoadFailed;

  const startLoad = useCallback(() => {
    if (!onLoadOlderRows) {
      return;
    }
    bottomAnchor?.captureScrollAnchor();
    void (async () => {
      try {
        await onLoadOlderRows();
      } catch {
        // Without this the sentinel is still on screen when the loading flag
        // clears, so a persistently failing page would be re-requested in a
        // tight loop. Stop auto-loading and let the button offer a retry.
        setAutoLoadFailed(true);
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
    // The observer state can be stale during a prepend. Chromium may move the
    // scroll position to preserve its native anchor before IntersectionObserver
    // reports that the sentinel left the prefetch range. Starting another page
    // from that stale `true` captures the transient scroll position and
    // overwrites the anchor for the page that just landed.
    if (!isSentinelWithinPrefetchRange({ scrollElement, sentinel })) {
      isIntersectingRef.current = false;
      return;
    }
    // Re-checked whenever a load settles, not only on an intersection change:
    // a page that did not fill the viewport leaves the sentinel visible, and
    // IntersectionObserver reports changes rather than steady state, so it
    // would not fire again on its own.
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
