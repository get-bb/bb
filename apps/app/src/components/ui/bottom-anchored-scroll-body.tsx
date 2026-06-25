import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import { useStore } from "jotai";
import { cn } from "@/lib/utils";
import { PAGE_SHELL_CONTENT_STYLE } from "./page-shell-content-style.js";
import {
  threadTimelineScrollAnchorAtomFamily,
  type ScrollAnchor,
} from "@/lib/thread-timeline-scroll-anchor.js";

// BottomAnchoredScrollBody owns "follow the bottom" behavior for streaming
// surfaces. It combines two mechanisms because neither is sufficient alone:
//
// - At the bottom, CSS scroll anchoring is redirected to the trailing 1px
//   `.scroll-bottom-anchor` sentinel. That lets Chromium/Firefox keep the
//   bottom pinned through width-driven markdown reflow without anchoring to a
//   random message row.
// - ResizeObserver plus a short rAF restore loop covers layout changes that
//   browser anchoring does not reliably handle, such as sidebar collapse,
//   prompt/footer height changes, and async content settling.
//
// When the user intentionally scrolls away, the sentinel class is removed so
// normal browser anchoring can preserve the visible row while reading in the
// middle of the timeline. User intent is inferred from wheel/touch/keyboard
// input and pointer-drag scrolling before a non-bottom scroll event.

export interface BottomAnchorContextValue {
  getScrollElement: () => HTMLElement | null;
  isAtBottom: boolean;
  scrollToBottom: () => void;
  scrollElementIntoView: (args: ScrollElementIntoViewArgs) => void;
  /**
   * Scroll only far enough to reveal the element, clamped to the scroll area's
   * max offset. If the resulting position is near max, stick-to-bottom is
   * re-enabled so near-bottom reveals keep following later timeline growth.
   */
  scrollElementIntoViewClampedToMaxScroll: (
    args: ScrollElementIntoViewClampedToMaxScrollArgs,
  ) => void;
  // Snapshot the scroll area so the next height growth (e.g. prepending older
  // messages) keeps the visible row at the same Y position instead of jumping.
  captureScrollAnchor: () => void;
}

export interface BottomAnchoredScrollBodyProps {
  children: ReactNode;
  footer: ReactNode;
  scrollOverlay?: ReactNode;
  scrollAreaClassName?: string;
  contentClassName?: string;
  maxWidthClassName: string;
  // When set, the scroll position is captured continuously (throttled) into the
  // per-thread anchor atom and restored on mount, so switching away and back to
  // a thread preserves where the user was reading instead of snapping to the
  // bottom. Absent ⇒ no capture/restore (e.g. surfaces without a thread id).
  scrollAnchorThreadId?: string;
}

export interface ScrollElementIntoViewArgs {
  element: HTMLElement;
  options?: ScrollIntoViewOptions;
}

export interface ScrollElementIntoViewClampedToMaxScrollArgs {
  element: HTMLElement;
}

interface ElementVisibilityArgs {
  element: HTMLElement;
  scrollArea: HTMLElement;
}

const BOTTOM_ANCHOR_THRESHOLD_PX = 4;
const USER_SCROLL_INTENT_MS = 1_000;
// ResizeObserver can fire before related flex/sidebar/prompt layout settles.
// Re-applying briefly covers cascading layout work without an unbounded loop.
const BOTTOM_RESTORE_SETTLE_FRAME_COUNT = 3;
// Throttle continuous scroll-anchor capture so a fast scroll writes the atom at
// most this often, plus a trailing write for the final resting position.
const SCROLL_ANCHOR_CAPTURE_THROTTLE_MS = 100;
// While a saved anchor's row hasn't hydrated yet, the ResizeObserver re-applies
// the restore as content settles. Give up (fall back to bottom) after this many
// observed re-applies so a deleted/never-arriving row can't hang at the top.
const SCROLL_ANCHOR_RESTORE_MAX_ATTEMPTS = 8;
const TIMELINE_ROW_ID_SELECTOR = "[data-timeline-row-id]";
const SCROLL_INTENT_KEYS = new Set([
  "ArrowDown",
  "ArrowUp",
  "End",
  "Home",
  "PageDown",
  "PageUp",
  " ",
]);

const BottomAnchorContext = createContext<BottomAnchorContextValue | null>(
  null,
);

export function useBottomAnchoredScroll(): BottomAnchorContextValue | null {
  return useContext(BottomAnchorContext);
}

function getMaxScrollOffset(element: HTMLElement) {
  return Math.max(0, element.scrollHeight - element.clientHeight);
}

function isScrolledNearBottom(element: HTMLElement) {
  return (
    getMaxScrollOffset(element) - element.scrollTop <=
    BOTTOM_ANCHOR_THRESHOLD_PX
  );
}

function scrollElementToBottom(element: HTMLElement) {
  element.scrollTop = getMaxScrollOffset(element);
}

function isElementFullyVisibleInScrollArea({
  element,
  scrollArea,
}: ElementVisibilityArgs) {
  const elementRect = element.getBoundingClientRect();
  const scrollAreaRect = scrollArea.getBoundingClientRect();
  return (
    elementRect.top >= scrollAreaRect.top &&
    elementRect.bottom <= scrollAreaRect.bottom
  );
}

function getScrollOffsetToRevealElement({
  element,
  scrollArea,
}: ElementVisibilityArgs) {
  const elementRect = element.getBoundingClientRect();
  const scrollAreaRect = scrollArea.getBoundingClientRect();
  return Math.max(
    0,
    elementRect.top - scrollAreaRect.top + scrollArea.scrollTop,
  );
}

function getRevealScrollOffsetClampedToMax(args: ElementVisibilityArgs) {
  return Math.min(
    getMaxScrollOffset(args.scrollArea),
    getScrollOffsetToRevealElement(args),
  );
}

interface TopMostVisibleRow {
  rowId: string;
  offsetWithinRow: number;
}

// The top-most timeline row whose bottom edge is below the scroll area's top
// edge — i.e. the first row still (at least partially) visible. `offsetWithinRow`
// is how far the scroll area's top sits past that row's top, so restore can
// reproduce a mid-row reading position.
function getTopMostVisibleRow(
  scrollArea: HTMLElement,
): TopMostVisibleRow | null {
  const scrollAreaTop = scrollArea.getBoundingClientRect().top;
  const rows = scrollArea.querySelectorAll<HTMLElement>(
    TIMELINE_ROW_ID_SELECTOR,
  );
  for (const row of rows) {
    const rowId = row.dataset.timelineRowId;
    if (!rowId) continue;
    const rowRect = row.getBoundingClientRect();
    if (rowRect.bottom <= scrollAreaTop + 1) continue;
    return {
      rowId,
      offsetWithinRow: Math.max(0, scrollAreaTop - rowRect.top),
    };
  }
  return null;
}

function findTimelineRowElement(
  scrollArea: HTMLElement,
  rowId: string,
): HTMLElement | null {
  // Match by dataset rather than building a CSS attribute selector so arbitrary
  // row ids never need escaping.
  const rows = scrollArea.querySelectorAll<HTMLElement>(
    TIMELINE_ROW_ID_SELECTOR,
  );
  for (const row of rows) {
    if (row.dataset.timelineRowId === rowId) return row;
  }
  return null;
}

function isScrollIntentKey(event: KeyboardEvent) {
  return SCROLL_INTENT_KEYS.has(event.key);
}

function isEditableKeyboardTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;

  return (
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT" ||
    target.isContentEditable ||
    target.closest("[contenteditable='true']") !== null
  );
}

function isKeyboardEventFromScrollArea(
  event: KeyboardEvent,
  scrollArea: HTMLElement,
) {
  const target = event.target;
  if (!(target instanceof Node)) return true;
  if (target === document.body || target === document.documentElement) {
    return true;
  }
  return scrollArea.contains(target);
}

export function BottomAnchoredScrollBody({
  scrollAreaClassName,
  contentClassName,
  maxWidthClassName,
  footer,
  scrollOverlay,
  children,
  scrollAnchorThreadId,
}: BottomAnchoredScrollBodyProps) {
  const store = useStore();
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const scrollContentRef = useRef<HTMLDivElement>(null);
  const shouldStickToBottomRef = useRef(true);
  const userScrollIntentUntilRef = useRef(0);
  const pointerScrollIntentRef = useRef(false);
  const restoreFrameRef = useRef<number | null>(null);
  const restoreFramesRemainingRef = useRef(0);
  const pendingPrependAnchorRef = useRef<{
    scrollHeight: number;
    scrollTop: number;
  } | null>(null);
  // A non-bottom anchor being restored. It stays pending across ResizeObserver
  // settle frames because the mount layout pass can read stale row geometry
  // (rows hydrate after mount); re-applying converges on the right position.
  // `attemptsRemaining` bounds the wait so a deleted/never-arriving row falls
  // back to bottom; `lastAppliedScrollTop` lets us stop early once the computed
  // position is stable across two consecutive applications.
  const pendingScrollRestoreRef = useRef<{
    anchor: ScrollAnchor;
    attemptsRemaining: number;
    lastAppliedScrollTop: number | null;
  } | null>(null);
  const scrollAnchorCaptureThrottleRef = useRef<{
    lastWriteAt: number;
    trailingTimeout: number | null;
  }>({ lastWriteAt: 0, trailingTimeout: null });
  const userDetachedFromBottomRef = useRef(false);
  const [isAtBottom, setIsAtBottom] = useState(true);

  const getScrollElement = useCallback(() => scrollAreaRef.current, []);

  const cancelPendingScrollRestore = useCallback(() => {
    pendingScrollRestoreRef.current = null;
  }, []);

  const cancelQueuedRestore = useCallback(() => {
    if (restoreFrameRef.current === null) return;
    window.cancelAnimationFrame(restoreFrameRef.current);
    restoreFrameRef.current = null;
    restoreFramesRemainingRef.current = 0;
  }, []);

  // Snap scrollTop back to the bottom if anchoring has let us drift away.
  // Returns whether it actually scrolled, so the rAF settle tail can stop early
  // once we're pinned again.
  //
  // CSS scroll anchoring (the trailing sentinel) keeps scrollTop pinned at
  // sub-pixel precision during content growth/shrink. `scrollElementToBottom`
  // sets `scrollTop = scrollHeight - clientHeight` — both integer-rounded
  // Web API values — so calling it while we're already within sub-pixel
  // range yanks scrollTop by ±1px against the browser's fractional value,
  // producing visible jitter on every frame of a row expand/collapse.
  // Restore only when anchoring has actually let us drift away from bottom.
  const restoreBottomOnce = useCallback(() => {
    const scrollArea = scrollAreaRef.current;
    if (!scrollArea || !shouldStickToBottomRef.current) return false;
    if (isScrolledNearBottom(scrollArea)) return false;
    scrollElementToBottom(scrollArea);
    return true;
  }, []);

  const queueBottomRestore = useCallback(() => {
    if (!shouldStickToBottomRef.current) return;
    // Restore synchronously in the frame the size change was observed.
    // ResizeObserver callbacks run after layout but before paint, so setting
    // scrollTop here takes effect this frame. CSS scroll anchoring does not
    // compensate for the scrollport's own size changing (only for content
    // shifts above the anchor), so a window/panel vertical resize drifts us
    // off-bottom with nothing to correct it within the frame. Deferring the
    // first restore to a rAF paints that drifted frame; during a continuous
    // resize drag the one-frame lag recurs every frame and reads as the
    // timeline fighting the browser and jumping. The rAF tail still covers
    // cascading layout (sidebar collapse, prompt/footer height changes) that
    // isn't final in the observed frame.
    restoreBottomOnce();
    restoreFramesRemainingRef.current = BOTTOM_RESTORE_SETTLE_FRAME_COUNT;
    if (restoreFrameRef.current !== null) return;
    const runQueuedRestore = () => {
      restoreFrameRef.current = null;
      if (!restoreBottomOnce()) {
        restoreFramesRemainingRef.current = 0;
        return;
      }
      restoreFramesRemainingRef.current -= 1;
      if (restoreFramesRemainingRef.current > 0) {
        restoreFrameRef.current =
          window.requestAnimationFrame(runQueuedRestore);
      }
    };
    restoreFrameRef.current = window.requestAnimationFrame(runQueuedRestore);
  }, [restoreBottomOnce]);

  const scrollToBottom = useCallback(() => {
    const scrollArea = scrollAreaRef.current;
    cancelPendingScrollRestore();
    userScrollIntentUntilRef.current = 0;
    pointerScrollIntentRef.current = false;
    userDetachedFromBottomRef.current = false;
    shouldStickToBottomRef.current = true;
    setIsAtBottom(true);
    if (scrollArea) {
      scrollElementToBottom(scrollArea);
    }
    queueBottomRestore();
  }, [cancelPendingScrollRestore, queueBottomRestore]);

  const scrollElementIntoView = useCallback(
    ({ element, options }: ScrollElementIntoViewArgs) => {
      const scrollArea = scrollAreaRef.current;
      if (
        scrollArea &&
        isElementFullyVisibleInScrollArea({ element, scrollArea })
      ) {
        return;
      }
      shouldStickToBottomRef.current = false;
      setIsAtBottom(false);
      cancelQueuedRestore();
      element.scrollIntoView(options);
    },
    [cancelQueuedRestore],
  );

  const scrollElementIntoViewClampedToMaxScroll = useCallback(
    ({ element }: ScrollElementIntoViewClampedToMaxScrollArgs) => {
      const scrollArea = scrollAreaRef.current;
      if (!scrollArea) {
        element.scrollIntoView({ block: "start", inline: "nearest" });
        return;
      }

      scrollArea.scrollTop = getRevealScrollOffsetClampedToMax({
        element,
        scrollArea,
      });

      const targetIsAtBottom = isScrolledNearBottom(scrollArea);
      shouldStickToBottomRef.current = targetIsAtBottom;
      setIsAtBottom(targetIsAtBottom);

      if (targetIsAtBottom) {
        queueBottomRestore();
        return;
      }

      cancelQueuedRestore();
    },
    [cancelQueuedRestore, queueBottomRestore],
  );

  const captureScrollAnchor = useCallback(() => {
    const scrollArea = scrollAreaRef.current;
    if (!scrollArea) return;
    pendingPrependAnchorRef.current = {
      scrollHeight: scrollArea.scrollHeight,
      scrollTop: scrollArea.scrollTop,
    };
  }, []);

  useLayoutEffect(() => {
    const scrollArea = scrollAreaRef.current;
    const anchor = pendingPrependAnchorRef.current;
    if (!scrollArea || !anchor) return;
    const delta = scrollArea.scrollHeight - anchor.scrollHeight;
    if (delta <= 0) return;
    scrollArea.scrollTop = anchor.scrollTop + delta;
    pendingPrependAnchorRef.current = null;
  });

  const hasRecentUserScrollIntent = useCallback(() => {
    return (
      pointerScrollIntentRef.current ||
      window.performance.now() <= userScrollIntentUntilRef.current
    );
  }, []);

  // Persist the current scroll position (top-most visible row + within-row
  // offset + atBottom) into the per-thread atom so returning to this thread
  // restores it. Continuous capture keeps the atom current while mounted; cleanup
  // flushes through the effect-captured scroll area because refs can be nulled
  // during unmount.
  const writeScrollAnchor = useCallback(
    (scrollAreaOverride?: HTMLElement) => {
      if (scrollAnchorThreadId === undefined) return;
      const scrollArea = scrollAreaOverride ?? scrollAreaRef.current;
      if (!scrollArea) return;
      const atBottomByGeometry = isScrolledNearBottom(scrollArea);
      const recentUserIntent = hasRecentUserScrollIntent();
      const anchorAtom =
        threadTimelineScrollAnchorAtomFamily(scrollAnchorThreadId);
      if (atBottomByGeometry) {
        userDetachedFromBottomRef.current = false;
        store.set(anchorAtom, {
          rowId: "",
          offsetWithinRow: 0,
          atBottom: true,
        });
        return;
      }
      if (recentUserIntent) {
        userDetachedFromBottomRef.current = true;
      }
      if (
        shouldStickToBottomRef.current &&
        !userDetachedFromBottomRef.current
      ) {
        store.set(anchorAtom, {
          rowId: "",
          offsetWithinRow: 0,
          atBottom: true,
        });
        return;
      }
      const topMostRow = getTopMostVisibleRow(scrollArea);
      // No rows yet: don't clobber a good anchor with an empty one.
      if (!topMostRow) return;
      store.set(anchorAtom, {
        rowId: topMostRow.rowId,
        offsetWithinRow: topMostRow.offsetWithinRow,
        atBottom: false,
      });
    },
    [hasRecentUserScrollIntent, scrollAnchorThreadId, store],
  );

  const captureScrollAnchorThrottled = useCallback(() => {
    if (scrollAnchorThreadId === undefined) return;
    const throttle = scrollAnchorCaptureThrottleRef.current;
    const now = window.performance.now();
    const elapsed = now - throttle.lastWriteAt;
    if (elapsed >= SCROLL_ANCHOR_CAPTURE_THROTTLE_MS) {
      throttle.lastWriteAt = now;
      writeScrollAnchor();
      return;
    }
    // Trailing write so the final resting position is always recorded even when
    // scrolling stops inside the throttle window.
    if (throttle.trailingTimeout !== null) return;
    throttle.trailingTimeout = window.setTimeout(() => {
      throttle.trailingTimeout = null;
      throttle.lastWriteAt = window.performance.now();
      writeScrollAnchor();
    }, SCROLL_ANCHOR_CAPTURE_THROTTLE_MS - elapsed);
  }, [scrollAnchorThreadId, writeScrollAnchor]);

  // Bring the saved anchor row into view (plus its within-row offset). Returns
  // the resulting scrollTop when the row was found, or null when it isn't yet
  // present (async hydration) so the caller keeps re-applying as content
  // settles.
  const applyScrollRestore = useCallback(
    (anchor: ScrollAnchor): number | null => {
      const scrollArea = scrollAreaRef.current;
      if (!scrollArea) return null;
      const rowElement = findTimelineRowElement(scrollArea, anchor.rowId);
      if (!rowElement) return null;
      // Suppress stick-to-bottom; this is the same state scrollElementIntoView
      // sets, inlined here so we can add the within-row offset afterward.
      shouldStickToBottomRef.current = false;
      setIsAtBottom(false);
      cancelQueuedRestore();
      const revealOffset = getScrollOffsetToRevealElement({
        element: rowElement,
        scrollArea,
      });
      const targetScrollTop = Math.min(
        getMaxScrollOffset(scrollArea),
        revealOffset + anchor.offsetWithinRow,
      );
      scrollArea.scrollTop = targetScrollTop;
      return targetScrollTop;
    },
    [cancelQueuedRestore],
  );

  const markUserScrollIntent = useCallback(() => {
    userScrollIntentUntilRef.current =
      window.performance.now() + USER_SCROLL_INTENT_MS;
  }, []);

  const markWheelScrollIntent = useCallback(() => {
    markUserScrollIntent();
  }, [markUserScrollIntent]);

  const markTouchStartScrollIntent = useCallback(() => {
    markUserScrollIntent();
  }, [markUserScrollIntent]);

  const markTouchMoveScrollIntent = useCallback(() => {
    markUserScrollIntent();
  }, [markUserScrollIntent]);

  const startPointerScrollIntent = useCallback(() => {
    pointerScrollIntentRef.current = true;
  }, []);

  const endPointerScrollIntent = useCallback(() => {
    pointerScrollIntentRef.current = false;
  }, []);

  const markKeyboardScrollIntent = useCallback(
    (event: KeyboardEvent) => {
      const scrollArea = scrollAreaRef.current;
      if (!scrollArea) return;
      if (!isScrollIntentKey(event)) return;
      if (isEditableKeyboardTarget(event.target)) return;
      if (!isKeyboardEventFromScrollArea(event, scrollArea)) return;

      markUserScrollIntent();
    },
    [markUserScrollIntent],
  );

  const syncBottomStateFromScroll = useCallback(() => {
    const scrollArea = scrollAreaRef.current;
    if (!scrollArea) return;

    if (isScrolledNearBottom(scrollArea)) {
      userDetachedFromBottomRef.current = false;
      shouldStickToBottomRef.current = true;
      setIsAtBottom(true);
      // A deliberate scroll to the bottom during the restore settle window means
      // the user no longer wants the saved row; stop re-applying it.
      pendingScrollRestoreRef.current = null;
      return;
    }

    if (!hasRecentUserScrollIntent()) return;

    userDetachedFromBottomRef.current = true;
    shouldStickToBottomRef.current = false;
    setIsAtBottom(false);
    cancelQueuedRestore();
    // The user is scrolling on their own; don't yank them back to the anchor.
    pendingScrollRestoreRef.current = null;
  }, [cancelQueuedRestore, hasRecentUserScrollIntent]);

  const handleScroll = useCallback(() => {
    syncBottomStateFromScroll();
    captureScrollAnchorThrottled();
  }, [syncBottomStateFromScroll, captureScrollAnchorThrottled]);

  // Drive a pending row restore as content settles. ResizeObserver fires as
  // rows hydrate / heights change after mount, so each pass re-applies the
  // restore against fresh geometry. Stop once the computed position is stable
  // (two consecutive applications agree) or attempts run out — falling back to
  // bottom only if the row never appeared.
  const advancePendingScrollRestore = useCallback((): boolean => {
    const pending = pendingScrollRestoreRef.current;
    if (!pending) return false;
    pending.attemptsRemaining -= 1;
    const appliedScrollTop = applyScrollRestore(pending.anchor);
    if (appliedScrollTop !== null) {
      if (pending.lastAppliedScrollTop === appliedScrollTop) {
        pendingScrollRestoreRef.current = null;
        return true;
      }
      pending.lastAppliedScrollTop = appliedScrollTop;
    }
    if (pending.attemptsRemaining <= 0) {
      pendingScrollRestoreRef.current = null;
      // The row never appeared; fall back to bottom. A row that was found keeps
      // its last restored position (stick-to-bottom stays suppressed).
      if (appliedScrollTop === null) {
        shouldStickToBottomRef.current = true;
        setIsAtBottom(true);
        // Scroll to the bottom in this same call. We return true below, so the
        // caller (`handleScrollAreaResize`) early-returns and won't run its own
        // `queueBottomRestore()`; without this the view would stay pinned at the
        // top until some later resize happened to fire.
        queueBottomRestore();
      }
    }
    return true;
  }, [applyScrollRestore, queueBottomRestore]);

  const handleScrollAreaResize = useCallback(() => {
    // While a restore is pending, the ResizeObserver is the settle signal; the
    // bottom-restore is suppressed (stick-to-bottom is false) anyway.
    if (advancePendingScrollRestore()) return;
    queueBottomRestore();
  }, [advancePendingScrollRestore, queueBottomRestore]);

  // Begin restoring the saved scroll position on mount, before the listener
  // effect's `queueBottomRestore()` runs (a useEffect, which runs after layout
  // effects), so suppressing stick-to-bottom here wins. A bottom or absent
  // anchor leaves the default stick-to-bottom intact. The actual row reveal is
  // driven through `advancePendingScrollRestore` (here + ResizeObserver settle)
  // because the mount layout pass can read stale, pre-hydration row geometry.
  useLayoutEffect(() => {
    if (scrollAnchorThreadId === undefined) return;
    const anchor = store.get(
      threadTimelineScrollAnchorAtomFamily(scrollAnchorThreadId),
    );
    if (!anchor || anchor.atBottom) return;
    shouldStickToBottomRef.current = false;
    setIsAtBottom(false);
    pendingScrollRestoreRef.current = {
      anchor,
      attemptsRemaining: SCROLL_ANCHOR_RESTORE_MAX_ATTEMPTS,
      lastAppliedScrollTop: null,
    };
    advancePendingScrollRestore();
  }, [scrollAnchorThreadId, store, advancePendingScrollRestore]);

  const bottomAnchorContextValue = useMemo<BottomAnchorContextValue>(
    () => ({
      getScrollElement,
      isAtBottom,
      scrollToBottom,
      scrollElementIntoView,
      scrollElementIntoViewClampedToMaxScroll,
      captureScrollAnchor,
    }),
    [
      getScrollElement,
      isAtBottom,
      scrollToBottom,
      scrollElementIntoView,
      scrollElementIntoViewClampedToMaxScroll,
      captureScrollAnchor,
    ],
  );

  const flushScrollAnchorCapture = useCallback(
    (scrollArea: HTMLElement) => {
      const captureThrottle = scrollAnchorCaptureThrottleRef.current;
      if (captureThrottle.trailingTimeout !== null) {
        window.clearTimeout(captureThrottle.trailingTimeout);
        captureThrottle.trailingTimeout = null;
      }
      writeScrollAnchor(scrollArea);
    },
    [writeScrollAnchor],
  );

  useLayoutEffect(() => {
    const scrollArea = scrollAreaRef.current;
    if (!scrollArea) return;

    return () => {
      flushScrollAnchorCapture(scrollArea);
    };
  }, [flushScrollAnchorCapture]);

  useEffect(() => {
    const scrollArea = scrollAreaRef.current;
    const scrollContent = scrollContentRef.current;
    if (!scrollArea || !scrollContent) return;

    let resizeObserver: ResizeObserver | undefined;
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(handleScrollAreaResize);
      resizeObserver.observe(scrollArea);
      resizeObserver.observe(scrollContent);
    }

    scrollArea.addEventListener("scroll", handleScroll, {
      passive: true,
    });
    scrollArea.addEventListener("wheel", markWheelScrollIntent, {
      passive: true,
    });
    scrollArea.addEventListener("touchstart", markTouchStartScrollIntent, {
      passive: true,
    });
    scrollArea.addEventListener("touchmove", markTouchMoveScrollIntent, {
      passive: true,
    });
    // Captures scrollbar-thumb drags and other pointer-driven scrolling that
    // can produce `scroll` without a preceding wheel/touch event. The matching
    // window listeners clear the flag even if the pointer leaves the scrollport.
    scrollArea.addEventListener("pointerdown", startPointerScrollIntent, {
      passive: true,
    });
    window.addEventListener("pointerup", endPointerScrollIntent);
    window.addEventListener("pointercancel", endPointerScrollIntent);
    window.addEventListener("keydown", markKeyboardScrollIntent);

    queueBottomRestore();

    return () => {
      resizeObserver?.disconnect();
      scrollArea.removeEventListener("scroll", handleScroll);
      scrollArea.removeEventListener("wheel", markWheelScrollIntent);
      scrollArea.removeEventListener("touchstart", markTouchStartScrollIntent);
      scrollArea.removeEventListener("touchmove", markTouchMoveScrollIntent);
      scrollArea.removeEventListener("pointerdown", startPointerScrollIntent);
      window.removeEventListener("pointerup", endPointerScrollIntent);
      window.removeEventListener("pointercancel", endPointerScrollIntent);
      window.removeEventListener("keydown", markKeyboardScrollIntent);
      cancelQueuedRestore();
    };
  }, [
    cancelQueuedRestore,
    endPointerScrollIntent,
    handleScroll,
    handleScrollAreaResize,
    markKeyboardScrollIntent,
    markTouchMoveScrollIntent,
    markTouchStartScrollIntent,
    markWheelScrollIntent,
    queueBottomRestore,
    startPointerScrollIntent,
  ]);

  return (
    <BottomAnchorContext.Provider value={bottomAnchorContextValue}>
      <div className="grid min-h-0 flex-1 overflow-hidden">
        <div
          ref={scrollAreaRef}
          className={cn(
            "@container/page col-start-1 row-start-1 min-h-0 overflow-x-hidden overflow-y-auto",
            scrollAreaClassName,
          )}
        >
          <div
            ref={scrollContentRef}
            className={cn(
              "flex min-h-full min-w-0 flex-col",
              isAtBottom && "scroll-bottom-anchor-content",
            )}
          >
            <div
              className={cn(
                "mx-auto flex w-full min-w-0 flex-1 flex-col px-4 pb-4 pt-2",
                maxWidthClassName,
                contentClassName,
              )}
              style={PAGE_SHELL_CONTENT_STYLE}
            >
              {children}
              <div className="scroll-bottom-anchor" aria-hidden />
            </div>
            {footer ? (
              <div className="sticky bottom-0 z-20 shrink-0">{footer}</div>
            ) : null}
          </div>
        </div>
        {scrollOverlay ? (
          <div
            data-scroll-overlay=""
            className="pointer-events-none z-30 col-start-1 row-start-1 flex min-h-0 min-w-0 items-center justify-end px-3 py-3"
          >
            <div className="pointer-events-auto">{scrollOverlay}</div>
          </div>
        ) : null}
      </div>
    </BottomAnchorContext.Provider>
  );
}
