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
import { cn } from "@bb/shared-ui/lib/utils";
import { PAGE_SHELL_CONTENT_STYLE } from "./page-shell-content-style.js";
import { supportsScrollAnchoring } from "@/lib/scroll-anchoring-support";
import {
  threadTimelineScrollAnchorAtomFamily,
  type ScrollAnchor,
} from "@/lib/thread-timeline-scroll-anchor.js";

// BottomAnchoredScrollBody owns "follow the bottom" behavior for streaming
// surfaces. It combines two mechanisms because neither is sufficient alone:
//
// - At the bottom, CSS scroll anchoring is redirected to the trailing 1px
//   `.scroll-bottom-anchor` sentinel by excluding the content wrapper
//   (`overflow-anchor: none` on the wrapper alone; the sentinel sits outside
//   it). That lets Chromium/Firefox keep the bottom pinned through
//   width-driven markdown reflow without anchoring to a random message row.
//   WebKit has no scroll anchoring, so the class is never applied there.
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

interface BottomAnchoredScrollBodyProps {
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

interface ScrollElementIntoViewArgs {
  element: HTMLElement;
  options?: ScrollIntoViewOptions;
}

interface ScrollElementIntoViewClampedToMaxScrollArgs {
  element: HTMLElement;
}

interface ElementVisibilityArgs {
  element: HTMLElement;
  scrollArea: HTMLElement;
}

const BOTTOM_ANCHOR_THRESHOLD_PX = 4;
const USER_SCROLL_INTENT_MS = 1_000;
const SCROLLBAR_IDLE_DELAY_MS = 600;
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
const TOP_LEVEL_TIMELINE_ROW_LIST_SELECTOR =
  '[data-timeline-row-list="top-level"]';
const DIRECT_TIMELINE_ROW_SELECTOR = [
  `:scope > ${TIMELINE_ROW_ID_SELECTOR}`,
  `:scope > [data-timeline-virtual-spacer] > ${TIMELINE_ROW_ID_SELECTOR}`,
].join(", ");
const SCROLL_INTENT_KEYS = new Set([
  "ArrowDown",
  "ArrowUp",
  "End",
  "Home",
  "PageDown",
  "PageUp",
  " ",
]);

export const BottomAnchorContext =
  createContext<BottomAnchorContextValue | null>(null);

/**
 * A virtualized timeline pins this one row during initial navigation restore;
 * otherwise the saved row would not exist in the DOM for the scroll body to
 * measure. It remains separate from BottomAnchorContext so embedded/test
 * consumers do not need to implement virtualizer policy.
 */
export const TimelineScrollRestoreRowIdContext = createContext<string | null>(
  null,
);

export function useBottomAnchoredScroll(): BottomAnchorContextValue | null {
  return useContext(BottomAnchorContext);
}

// Reading `scrollHeight`/`clientHeight` forces synchronous layout (WebKit
// especially), so only the cache-refresh paths may call this — never
// per-scroll-event code. See `refreshMaxScrollOffset` in the component.
function getMaxScrollOffset(element: HTMLElement) {
  return Math.max(0, element.scrollHeight - element.clientHeight);
}

function isScrolledNearBottom(maxScrollOffset: number, scrollTop: number) {
  return maxScrollOffset - scrollTop <= BOTTOM_ANCHOR_THRESHOLD_PX;
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

interface TopMostVisibleRow {
  rowId: string;
  offsetWithinRow: number;
}

function getScrollAnchorRows(scrollArea: HTMLElement): NodeListOf<HTMLElement> {
  const topLevelList = scrollArea.querySelector<HTMLElement>(
    TOP_LEVEL_TIMELINE_ROW_LIST_SELECTOR,
  );
  if (topLevelList) {
    return topLevelList.querySelectorAll<HTMLElement>(
      DIRECT_TIMELINE_ROW_SELECTOR,
    );
  }
  // Embedded/test surfaces may render timeline rows without the app's
  // top-level list wrapper.
  return scrollArea.querySelectorAll<HTMLElement>(TIMELINE_ROW_ID_SELECTOR);
}

// The top-most timeline row whose bottom edge is below the scroll area's top
// edge — i.e. the first row still (at least partially) visible. `offsetWithinRow`
// is how far the scroll area's top sits past that row's top, so restore can
// reproduce a mid-row reading position.
function getTopMostVisibleRow(
  scrollArea: HTMLElement,
): TopMostVisibleRow | null {
  const scrollAreaTop = scrollArea.getBoundingClientRect().top;
  const rows = getScrollAnchorRows(scrollArea);
  let low = 0;
  let high = rows.length - 1;
  let visibleRow: HTMLElement | null = null;
  let visibleRowRect: DOMRect | null = null;

  // Top-level timeline rows are laid out in document order without overlap, so
  // their bottom edges are monotonic. Binary search avoids the old O(n) walk
  // from the first loaded row on every throttled scroll-anchor capture. On a
  // long thread near the bottom, that walk forced hundreds of layout reads per
  // sample while the browser was already busy scrolling.
  while (low <= high) {
    const index = low + Math.floor((high - low) / 2);
    const row = rows[index];
    if (!row) break;
    const rowRect = row.getBoundingClientRect();
    if (rowRect.bottom <= scrollAreaTop + 1) {
      low = index + 1;
      continue;
    }
    visibleRow = row;
    visibleRowRect = rowRect;
    high = index - 1;
  }

  const rowId = visibleRow?.dataset.timelineRowId;
  if (!rowId || !visibleRowRect) return null;
  return {
    rowId,
    offsetWithinRow: Math.max(0, scrollAreaTop - visibleRowRect.top),
  };
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
  // Cached `scrollHeight - clientHeight` of the scroll area. Reading those two
  // properties forces synchronous layout in WebKit, which on an unvirtualized
  // timeline (thousands of DOM nodes) stalls every scroll event. Mirroring
  // useStickyBottomScroll, per-scroll-event handlers read only `scrollTop`
  // plus this cache; it is refreshed where layout legitimately changes — the
  // ResizeObserver (which watches both the scroll port and the content
  // wrapper, so every size change lands there), the programmatic
  // scroll/restore paths, which need fresh geometry anyway, and one fresh
  // verification read on the attach->detach edge (see
  // syncBottomStateFromScroll for the content-shrink race it covers).
  const maxScrollOffsetRef = useRef(0);
  // The cache is only authoritative once the ResizeObserver has delivered:
  // without deliveries (no ResizeObserver in the environment, or a no-op
  // polyfill that never fires) nothing keeps it fresh, so reads fall back to
  // live geometry — the pre-cache behavior — instead of trusting a frozen
  // value that would classify every position as at-bottom.
  const resizeObserverHasDeliveredRef = useRef(false);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const initialScrollRestoreRowId = useMemo(() => {
    if (scrollAnchorThreadId === undefined) return null;
    const anchor = store.get(
      threadTimelineScrollAnchorAtomFamily(scrollAnchorThreadId),
    );
    return anchor !== null && anchor !== undefined && !anchor.atBottom
      ? anchor.rowId
      : null;
  }, [scrollAnchorThreadId, store]);

  const getScrollElement = useCallback(() => scrollAreaRef.current, []);

  const refreshMaxScrollOffset = useCallback((scrollArea: HTMLElement) => {
    const maxScrollOffset = getMaxScrollOffset(scrollArea);
    maxScrollOffsetRef.current = maxScrollOffset;
    return maxScrollOffset;
  }, []);

  // Hot-path read: the cache once the ResizeObserver has delivered, a live
  // read before that (and forever, when no observer will ever fire).
  const readMaxScrollOffset = useCallback(
    (scrollArea: HTMLElement) =>
      resizeObserverHasDeliveredRef.current
        ? maxScrollOffsetRef.current
        : refreshMaxScrollOffset(scrollArea),
    [refreshMaxScrollOffset],
  );

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
  // sub-pixel precision during content growth/shrink. Setting
  // `scrollTop = scrollHeight - clientHeight` — both integer-rounded Web API
  // values — while we're already within sub-pixel range yanks scrollTop by
  // ±1px against the browser's fractional value, producing visible jitter on
  // every frame of a row expand/collapse. Restore only when anchoring has
  // actually let us drift away from bottom.
  //
  // This runs after observed size changes, so it deliberately reads fresh
  // geometry — layout has genuinely changed — and refreshes the cache with it.
  const restoreBottomOnce = useCallback(() => {
    const scrollArea = scrollAreaRef.current;
    if (!scrollArea || !shouldStickToBottomRef.current) return false;
    const maxScrollOffset = refreshMaxScrollOffset(scrollArea);
    if (isScrolledNearBottom(maxScrollOffset, scrollArea.scrollTop)) {
      return false;
    }
    scrollArea.scrollTop = maxScrollOffset;
    return true;
  }, [refreshMaxScrollOffset]);

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
      scrollArea.scrollTop = refreshMaxScrollOffset(scrollArea);
    }
    queueBottomRestore();
  }, [cancelPendingScrollRestore, queueBottomRestore, refreshMaxScrollOffset]);

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

      const maxScrollOffset = refreshMaxScrollOffset(scrollArea);
      scrollArea.scrollTop = Math.min(
        maxScrollOffset,
        getScrollOffsetToRevealElement({ element, scrollArea }),
      );

      const targetIsAtBottom = isScrolledNearBottom(
        maxScrollOffset,
        scrollArea.scrollTop,
      );
      shouldStickToBottomRef.current = targetIsAtBottom;
      setIsAtBottom(targetIsAtBottom);

      if (targetIsAtBottom) {
        queueBottomRestore();
        return;
      }

      cancelQueuedRestore();
    },
    [cancelQueuedRestore, queueBottomRestore, refreshMaxScrollOffset],
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
    // Content height just changed under us; fold it into the cache now instead
    // of waiting for the ResizeObserver delivery at the end of the frame.
    refreshMaxScrollOffset(scrollArea);
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
      let atBottomByGeometry = isScrolledNearBottom(
        readMaxScrollOffset(scrollArea),
        scrollArea.scrollTop,
      );
      if (!atBottomByGeometry && shouldStickToBottomRef.current) {
        // Same content-shrink edge as syncBottomStateFromScroll: while still
        // attached, verify an off-bottom reading with fresh geometry before
        // letting it demote the anchor to a mid-timeline row.
        atBottomByGeometry = isScrolledNearBottom(
          refreshMaxScrollOffset(scrollArea),
          scrollArea.scrollTop,
        );
      }
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
    [
      hasRecentUserScrollIntent,
      readMaxScrollOffset,
      refreshMaxScrollOffset,
      scrollAnchorThreadId,
      store,
    ],
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
        refreshMaxScrollOffset(scrollArea),
        revealOffset + anchor.offsetWithinRow,
      );
      scrollArea.scrollTop = targetScrollTop;
      return targetScrollTop;
    },
    [cancelQueuedRestore, refreshMaxScrollOffset],
  );

  const markUserScrollIntent = useCallback(() => {
    userScrollIntentUntilRef.current =
      window.performance.now() + USER_SCROLL_INTENT_MS;
  }, []);

  const markWheelScrollIntent = useCallback(
    (event: WheelEvent) => {
      const scrollArea = scrollAreaRef.current;
      // Wheel events fire at scroll rate; run on the cached max offset and
      // spend a fresh verification read only when a still-attached viewport
      // reads as off-bottom (the content-shrink edge described in
      // syncBottomStateFromScroll). While detached, wheeling stays cache-only.
      if (event.deltaY > 0 && scrollArea) {
        const nearBottom =
          isScrolledNearBottom(
            readMaxScrollOffset(scrollArea),
            scrollArea.scrollTop,
          ) ||
          (shouldStickToBottomRef.current &&
            isScrolledNearBottom(
              refreshMaxScrollOffset(scrollArea),
              scrollArea.scrollTop,
            ));
        if (nearBottom) {
          userScrollIntentUntilRef.current = 0;
          return;
        }
      }
      markUserScrollIntent();
    },
    [markUserScrollIntent, readMaxScrollOffset, refreshMaxScrollOffset],
  );

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

  // Resume following the bottom. Shared by the scroll handler (a scroll event
  // landing near the bottom) and the resize path (a content shrink clamping a
  // detached viewport onto the bottom).
  const attachToBottom = useCallback(() => {
    userDetachedFromBottomRef.current = false;
    shouldStickToBottomRef.current = true;
    userScrollIntentUntilRef.current = 0;
    setIsAtBottom(true);
    // A deliberate arrival at the bottom during the restore settle window means
    // the user no longer wants the saved row; stop re-applying it.
    pendingScrollRestoreRef.current = null;
  }, []);

  const syncBottomStateFromScroll = useCallback(() => {
    const scrollArea = scrollAreaRef.current;
    if (!scrollArea) return;

    if (
      pendingPrependAnchorRef.current !== null &&
      hasRecentUserScrollIntent()
    ) {
      // Native scroll anchoring can temporarily move a user-scrolled viewport
      // to the current maximum while prepended rows mount. That is not a user
      // request to resume following the bottom. Keep sticky-bottom disabled
      // until the captured prepend anchor is applied; otherwise the
      // ResizeObserver races the layout effect and yanks the viewport down.
      userDetachedFromBottomRef.current = true;
      shouldStickToBottomRef.current = false;
      setIsAtBottom(false);
      cancelQueuedRestore();
      return;
    }

    // Cached max offset: this runs on every scroll event of an unvirtualized
    // timeline, where a scrollHeight/clientHeight read would force a full
    // layout pass per event.
    let nearBottom = isScrolledNearBottom(
      readMaxScrollOffset(scrollArea),
      scrollArea.scrollTop,
    );
    if (
      !nearBottom &&
      shouldStickToBottomRef.current &&
      hasRecentUserScrollIntent()
    ) {
      // Attach -> detach edge. On a content-shrink frame this scroll event
      // outruns the ResizeObserver refresh: the browser has already clamped
      // scrollTop to the new, smaller maximum while the cache still holds the
      // old one, so a still-pinned viewport reads as a user detach — with no
      // recovery, because the bottom-restore is suppressed once
      // stick-to-bottom is off (deterministic on iOS, e.g. tap-collapsing a
      // long tool output while pinned). Spend one fresh read on this edge
      // only to re-test; steady-state scrolling stays cache-only.
      nearBottom = isScrolledNearBottom(
        refreshMaxScrollOffset(scrollArea),
        scrollArea.scrollTop,
      );
    }

    if (nearBottom) {
      attachToBottom();
      return;
    }

    if (!hasRecentUserScrollIntent()) return;

    userDetachedFromBottomRef.current = true;
    shouldStickToBottomRef.current = false;
    setIsAtBottom(false);
    cancelQueuedRestore();
    // The user is scrolling on their own; don't yank them back to the anchor.
    pendingScrollRestoreRef.current = null;
  }, [
    attachToBottom,
    cancelQueuedRestore,
    hasRecentUserScrollIntent,
    readMaxScrollOffset,
    refreshMaxScrollOffset,
  ]);

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
    const scrollArea = scrollAreaRef.current;
    let shrankOntoBottomWhileDetached = false;
    if (scrollArea) {
      // The steady-state cache refresh: the observer watches both the scroll
      // port and the content wrapper, so every legitimate
      // scrollHeight/clientHeight change passes through here. The first
      // delivery is also what makes the cache authoritative for hot-path
      // reads (see resizeObserverHasDeliveredRef).
      const previousMaxScrollOffset = maxScrollOffsetRef.current;
      const cacheWasAuthoritative = resizeObserverHasDeliveredRef.current;
      const maxScrollOffset = refreshMaxScrollOffset(scrollArea);
      resizeObserverHasDeliveredRef.current = true;
      shrankOntoBottomWhileDetached =
        cacheWasAuthoritative &&
        !shouldStickToBottomRef.current &&
        maxScrollOffset < previousMaxScrollOffset &&
        isScrolledNearBottom(maxScrollOffset, scrollArea.scrollTop);
    }
    // While a restore is pending, the ResizeObserver is the settle signal; the
    // bottom-restore is suppressed (stick-to-bottom is false) anyway.
    if (advancePendingScrollRestore()) return;
    if (shrankOntoBottomWhileDetached && scrollArea) {
      // The detached mirror of the attach->detach edge in
      // syncBottomStateFromScroll: a content shrink (collapsing a long tool
      // output near the end) clamped a detached viewport onto the new,
      // smaller maximum. The browser delivered that clamp's scroll event
      // before this refresh, so the scroll handler classified it against the
      // stale, larger cache and left the viewport detached. A live read used
      // to re-attach on that very scroll event; do the same here, against
      // fresh geometry, so streaming content keeps following the bottom.
      attachToBottom();
      writeScrollAnchor(scrollArea);
    }
    queueBottomRestore();
  }, [
    advancePendingScrollRestore,
    attachToBottom,
    queueBottomRestore,
    refreshMaxScrollOffset,
    writeScrollAnchor,
  ]);

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
      // One-shot unmount flush: the cache may lag the final layout by a frame
      // and this write decides where the user comes back to, so read fresh.
      refreshMaxScrollOffset(scrollArea);
      writeScrollAnchor(scrollArea);
    },
    [refreshMaxScrollOffset, writeScrollAnchor],
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

    let scrollbarIdleTimeout: number | null = null;
    const handleScrollWithTransientScrollbar = () => {
      scrollArea.dataset.scrollbarScrolling = "true";
      if (scrollbarIdleTimeout !== null) {
        window.clearTimeout(scrollbarIdleTimeout);
      }
      scrollbarIdleTimeout = window.setTimeout(() => {
        scrollbarIdleTimeout = null;
        scrollArea.removeAttribute("data-scrollbar-scrolling");
      }, SCROLLBAR_IDLE_DELAY_MS);
      handleScroll();
    };

    let resizeObserver: ResizeObserver | undefined;
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(handleScrollAreaResize);
      resizeObserver.observe(scrollArea);
      resizeObserver.observe(scrollContent);
    }

    scrollArea.addEventListener("scroll", handleScrollWithTransientScrollbar, {
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
      scrollArea.removeEventListener(
        "scroll",
        handleScrollWithTransientScrollbar,
      );
      scrollArea.removeEventListener("wheel", markWheelScrollIntent);
      scrollArea.removeEventListener("touchstart", markTouchStartScrollIntent);
      scrollArea.removeEventListener("touchmove", markTouchMoveScrollIntent);
      scrollArea.removeEventListener("pointerdown", startPointerScrollIntent);
      window.removeEventListener("pointerup", endPointerScrollIntent);
      window.removeEventListener("pointercancel", endPointerScrollIntent);
      window.removeEventListener("keydown", markKeyboardScrollIntent);
      if (scrollbarIdleTimeout !== null) {
        window.clearTimeout(scrollbarIdleTimeout);
      }
      scrollArea.removeAttribute("data-scrollbar-scrolling");
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
      <TimelineScrollRestoreRowIdContext.Provider
        value={initialScrollRestoreRowId}
      >
        <div className="grid min-h-0 flex-1 overflow-hidden">
          <div
            ref={scrollAreaRef}
            className={cn(
              "thread-scrollbar @container/page col-start-1 row-start-1 min-h-0 overflow-x-hidden overflow-y-auto",
              scrollAreaClassName,
            )}
          >
            <div
              ref={scrollContentRef}
              className="flex min-h-full min-w-0 flex-col"
            >
              {/* `.scroll-bottom-anchor-content` sets `overflow-anchor: none` on
                this wrapper only. Scroll anchoring skips an excluded element's
                whole subtree, so one class on one element redirects anchoring
                to the trailing sentinel without a descendant rule that would
                restyle every timeline node each time the bottom attaches or
                detaches. Browsers without scroll anchoring (WebKit) never get
                the class: the toggle would be a pure invalidation cost. */}
              <div
                className={cn(
                  "mx-auto flex w-full min-w-0 flex-1 flex-col px-4 pb-4 pt-2",
                  maxWidthClassName,
                  contentClassName,
                  isAtBottom &&
                    supportsScrollAnchoring() &&
                    "scroll-bottom-anchor-content",
                )}
                style={PAGE_SHELL_CONTENT_STYLE}
              >
                {children}
              </div>
              <div className="scroll-bottom-anchor" aria-hidden />
              {footer ? (
                // The sticky footer is excluded from anchor selection outright:
                // it moves with the scrollport, so anchoring to it (or to a
                // control inside it) would turn its own height changes into
                // scroll jumps. Static exclusion keeps the previous
                // `.scroll-bottom-anchor-content *` coverage of this subtree
                // without a toggling class; while the wrapper is not excluded
                // it always wins selection anyway, so nothing else changes.
                <div
                  data-scroll-footer=""
                  className="sticky bottom-0 z-20 shrink-0 [overflow-anchor:none]"
                >
                  {footer}
                </div>
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
      </TimelineScrollRestoreRowIdContext.Provider>
    </BottomAnchorContext.Provider>
  );
}
