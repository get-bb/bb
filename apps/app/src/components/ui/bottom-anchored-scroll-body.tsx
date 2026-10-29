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
import { flushSync } from "react-dom";
import { useStore } from "jotai";
import { cn } from "@bb/shared-ui/lib/utils";
import { usePointerCoarse } from "@bb/shared-ui/hooks/use-pointer-coarse";
import { PAGE_SHELL_CONTENT_STYLE } from "./page-shell-content-style.js";
import { PAGE_SCROLL_TO_TOP_EVENT } from "@/lib/page-scroll-to-top";
import { isIOSWebKit } from "@/lib/ios-webkit";
import { threadTimelineScrollAnchorAtomFamily } from "@/lib/thread-timeline-scroll-anchor.js";
import {
  ScrollPositionKeeper,
  getDirectTimelineRows,
} from "./scroll-position-keeper.js";
import { TitleBarScrollFade } from "./title-bar-scroll-fade.js";

export interface BottomAnchorContextValue {
  getScrollElement: () => HTMLElement | null;
  isAtBottom: boolean;
  scrollToBottom: () => void;
  scrollElementIntoView: (args: ScrollElementIntoViewArgs) => void;
  holdContentPosition: (args: HoldContentPositionArgs) => void;
  positionKeeper: ScrollPositionKeeper;
}

export interface TimelineScrollRestore {
  key: string;
  offset: number;
}

interface BottomAnchoredScrollBodyProps {
  children: ReactNode;
  footer: ReactNode;
  scrollOverlay?: ReactNode;
  contentInsetEndPx?: number;
  scrollAreaClassName?: string;
  contentClassName?: string;
  maxWidthClassName: string;
  scrollAnchorThreadId?: string;
}

interface ScrollElementIntoViewArgs {
  element: HTMLElement;
  options?: ScrollIntoViewOptions;
}

interface HoldContentPositionArgs {
  edge: "top" | "bottom";
  element: HTMLElement;
  update: () => void;
}

const BOTTOM_ANCHOR_THRESHOLD_PX = 4;
const SCROLLBAR_IDLE_DELAY_MS = 600;
const SCROLL_ANCHOR_CAPTURE_THROTTLE_MS = 100;
const COARSE_SCROLL_ANCHOR_CAPTURE_THROTTLE_MS = 250;
const NATIVE_PAGE_SCROLL_KEYS = new Set(["PageDown", "PageUp", " "]);
const EDITABLE_KEY_TARGET_SELECTOR =
  "input, textarea, select, [contenteditable]:not([contenteditable='false'])";
const TOP_LEVEL_TIMELINE_ROW_LIST_SELECTOR =
  '[data-timeline-row-list="top-level"]';
const TIMELINE_ROW_ID_SELECTOR = "[data-timeline-row-id]";

export const BottomAnchorContext =
  createContext<BottomAnchorContextValue | null>(null);

export const TimelineScrollRestoreContext =
  createContext<TimelineScrollRestore | null>(null);

export function useBottomAnchoredScroll(): BottomAnchorContextValue | null {
  return useContext(BottomAnchorContext);
}

function getTopLevelRows(scrollArea: HTMLElement): ArrayLike<HTMLElement> {
  const topLevelList = scrollArea.querySelector<HTMLElement>(
    TOP_LEVEL_TIMELINE_ROW_LIST_SELECTOR,
  );
  return topLevelList
    ? getDirectTimelineRows(topLevelList)
    : scrollArea.querySelectorAll<HTMLElement>(TIMELINE_ROW_ID_SELECTOR);
}

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function BottomAnchoredScrollBody({
  scrollAreaClassName,
  contentClassName,
  maxWidthClassName,
  footer,
  scrollOverlay,
  contentInsetEndPx,
  children,
  scrollAnchorThreadId,
}: BottomAnchoredScrollBodyProps) {
  const store = useStore();
  const isPointerCoarse = usePointerCoarse();
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const scrollContentRef = useRef<HTMLDivElement>(null);
  const pageContentRef = useRef<HTMLDivElement>(null);
  const scrollFooterRef = useRef<HTMLDivElement>(null);
  const scrollFloorRef = useRef<HTMLDivElement>(null);
  const hasFooter = Boolean(footer);
  const scrollAnchorCaptureThrottleRef = useRef<{
    lastWriteAt: number;
    trailingTimeout: number | null;
  }>({ lastWriteAt: 0, trailingTimeout: null });
  const initialRestore = useMemo<TimelineScrollRestore | null>(() => {
    if (scrollAnchorThreadId === undefined) return null;
    const anchor = store.get(
      threadTimelineScrollAnchorAtomFamily(scrollAnchorThreadId),
    );
    return anchor !== null && !anchor.atBottom
      ? { key: anchor.rowId, offset: -anchor.offsetWithinRow }
      : null;
  }, [scrollAnchorThreadId, store]);
  const [isAtBottom, setIsAtBottom] = useState(true);

  const getScrollElement = useCallback(() => scrollAreaRef.current, []);

  const [positionKeeper] = useState(
    () =>
      new ScrollPositionKeeper({
        bottomThresholdPx: BOTTOM_ANCHOR_THRESHOLD_PX,
        deferWritesWhileScrolling: isIOSWebKit(navigator),
        getContentElement: () => pageContentRef.current,
        getFloorElement: () => scrollFloorRef.current,
        getFooterElement: () => scrollFooterRef.current,
        getScrollElement: () => scrollAreaRef.current,
        getTopLevelRows,
        initiallyAttached: true,
      }),
  );

  useLayoutEffect(
    () =>
      positionKeeper.subscribe(() => {
        setIsAtBottom(positionKeeper.isAttached());
      }),
    [positionKeeper],
  );

  const scrollToBottom = useCallback(() => {
    positionKeeper.scrollToBottom();
  }, [positionKeeper]);

  const scrollElementIntoView = useCallback(
    ({ element, options }: ScrollElementIntoViewArgs) => {
      positionKeeper.revealElement(element, options ?? {});
    },
    [positionKeeper],
  );

  const holdContentPosition = useCallback(
    ({ edge, element, update }: HoldContentPositionArgs) => {
      positionKeeper.hold(element, edge);
      flushSync(update);
      positionKeeper.reconcile();
    },
    [positionKeeper],
  );

  const writeScrollAnchor = useCallback(() => {
    if (scrollAnchorThreadId === undefined) return;
    const saved = positionKeeper.savedPosition();
    if (saved === null) return;
    store.set(
      threadTimelineScrollAnchorAtomFamily(scrollAnchorThreadId),
      saved,
    );
  }, [positionKeeper, scrollAnchorThreadId, store]);

  const scrollAnchorCaptureThrottleMs = isPointerCoarse
    ? COARSE_SCROLL_ANCHOR_CAPTURE_THROTTLE_MS
    : SCROLL_ANCHOR_CAPTURE_THROTTLE_MS;

  const captureScrollAnchorThrottled = useCallback(() => {
    if (scrollAnchorThreadId === undefined) return;
    const throttle = scrollAnchorCaptureThrottleRef.current;
    const now = window.performance.now();
    const elapsed = now - throttle.lastWriteAt;
    if (elapsed >= scrollAnchorCaptureThrottleMs) {
      throttle.lastWriteAt = now;
      writeScrollAnchor();
      return;
    }
    if (throttle.trailingTimeout !== null) return;
    throttle.trailingTimeout = window.setTimeout(() => {
      throttle.trailingTimeout = null;
      throttle.lastWriteAt = window.performance.now();
      writeScrollAnchor();
    }, scrollAnchorCaptureThrottleMs - elapsed);
  }, [scrollAnchorCaptureThrottleMs, scrollAnchorThreadId, writeScrollAnchor]);

  useLayoutEffect(() => {
    if (initialRestore !== null) {
      positionKeeper.restore({
        rowId: initialRestore.key,
        offsetWithinRow: -initialRestore.offset,
        atBottom: false,
      });
    }
  }, [initialRestore, positionKeeper]);

  useLayoutEffect(() => {
    const scrollArea = scrollAreaRef.current;
    if (!scrollArea) return;
    const captureThrottle = scrollAnchorCaptureThrottleRef.current;
    const disconnect = positionKeeper.connect(scrollArea);
    return () => {
      if (captureThrottle.trailingTimeout !== null) {
        window.clearTimeout(captureThrottle.trailingTimeout);
        captureThrottle.trailingTimeout = null;
      }
      writeScrollAnchor();
      disconnect();
    };
  }, [positionKeeper, writeScrollAnchor]);

  useEffect(() => {
    const scrollArea = scrollAreaRef.current;
    if (!scrollArea) return;
    const scrollToTop = (event: Event) => {
      event.preventDefault();
      if (scrollArea.scrollHeight <= scrollArea.clientHeight) return;
      positionKeeper.scrollTo(0, prefersReducedMotion() ? "instant" : "smooth");
    };
    scrollArea.addEventListener(PAGE_SCROLL_TO_TOP_EVENT, scrollToTop);
    return () => {
      scrollArea.removeEventListener(PAGE_SCROLL_TO_TOP_EVENT, scrollToTop);
    };
  }, [positionKeeper]);

  useLayoutEffect(() => {
    const scrollArea = scrollAreaRef.current;
    const scrollFooter = scrollFooterRef.current;
    if (!scrollArea || !scrollFooter) return;

    let clearScrollPaddingFrame: number | null = null;
    const clearScrollPadding = () => {
      clearScrollPaddingFrame = null;
      scrollArea.style.removeProperty("scroll-padding-bottom");
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!NATIVE_PAGE_SCROLL_KEYS.has(event.key)) return;
      const target = event.target;
      if (!(target instanceof Node) || scrollFooter.contains(target)) return;
      if (target !== document.body && !scrollArea.contains(target)) return;
      if (
        target instanceof Element &&
        target.closest(EDITABLE_KEY_TARGET_SELECTOR)
      ) {
        return;
      }
      scrollArea.style.scrollPaddingBottom = `${scrollFooter.getBoundingClientRect().height}px`;
      clearScrollPaddingFrame ??= requestAnimationFrame(clearScrollPadding);
    };
    window.addEventListener("keydown", handleKeyDown, true);

    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      if (clearScrollPaddingFrame !== null) {
        cancelAnimationFrame(clearScrollPaddingFrame);
      }
      scrollArea.style.removeProperty("scroll-padding-bottom");
    };
  }, [hasFooter]);

  useEffect(() => {
    const scrollArea = scrollAreaRef.current;
    if (!scrollArea) return;

    let scrollbarIdleTimeout: number | null = null;
    const handleScrollEvent = () => {
      if (scrollArea.dataset.scrollbarScrolling !== "true") {
        scrollArea.dataset.scrollbarScrolling = "true";
      }
      if (scrollbarIdleTimeout !== null) {
        window.clearTimeout(scrollbarIdleTimeout);
      }
      scrollbarIdleTimeout = window.setTimeout(() => {
        scrollbarIdleTimeout = null;
        scrollArea.removeAttribute("data-scrollbar-scrolling");
      }, SCROLLBAR_IDLE_DELAY_MS);
      captureScrollAnchorThrottled();
    };
    scrollArea.addEventListener("scroll", handleScrollEvent, {
      passive: true,
    });
    return () => {
      scrollArea.removeEventListener("scroll", handleScrollEvent);
      if (scrollbarIdleTimeout !== null) {
        window.clearTimeout(scrollbarIdleTimeout);
      }
      scrollArea.removeAttribute("data-scrollbar-scrolling");
    };
  }, [captureScrollAnchorThrottled]);

  const bottomAnchorContextValue = useMemo<BottomAnchorContextValue>(
    () => ({
      getScrollElement,
      isAtBottom,
      scrollToBottom,
      scrollElementIntoView,
      holdContentPosition,
      positionKeeper,
    }),
    [
      getScrollElement,
      isAtBottom,
      scrollToBottom,
      scrollElementIntoView,
      holdContentPosition,
      positionKeeper,
    ],
  );

  return (
    <BottomAnchorContext.Provider value={bottomAnchorContextValue}>
      <TimelineScrollRestoreContext.Provider value={initialRestore}>
        <div className="relative grid min-h-0 flex-1 grid-rows-[minmax(auto,1fr)] overflow-hidden">
          <TitleBarScrollFade tone="background" />
          <div
            ref={scrollAreaRef}
            data-page-scroll-viewport=""
            className={cn(
              "thread-scrollbar @container/page col-start-1 row-start-1 min-h-0 overflow-x-hidden overflow-y-auto",
              scrollAreaClassName,
            )}
          >
            <div
              ref={scrollContentRef}
              className="flex min-h-full min-w-0 flex-col"
              style={
                contentInsetEndPx ? { paddingInlineEnd: contentInsetEndPx } : undefined
              }
            >
              <div
                ref={scrollFloorRef}
                aria-hidden="true"
                className="pointer-events-none invisible w-px shrink-0"
              />
              <div
                ref={pageContentRef}
                data-scroll-attached={isAtBottom ? "" : undefined}
                className={cn(
                  "mx-auto flex w-full min-w-0 flex-1 flex-col px-4 pb-4 pt-2",
                  maxWidthClassName,
                  contentClassName,
                )}
                style={PAGE_SHELL_CONTENT_STYLE}
              >
                {children}
              </div>
              {footer ? (
                <div
                  ref={scrollFooterRef}
                  data-scroll-footer=""
                  className="sticky bottom-0 z-20 shrink-0"
                >
                  {footer}
                </div>
              ) : null}
            </div>
          </div>
          {scrollOverlay ? (
            <div
              data-scroll-overlay=""
              className="pointer-events-none z-30 col-start-1 row-start-1 flex min-h-0 min-w-0 flex-col items-end px-3 py-3"
            >
              {scrollOverlay}
            </div>
          ) : null}
        </div>
      </TimelineScrollRestoreContext.Provider>
    </BottomAnchorContext.Provider>
  );
}
