import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEventHandler,
  type RefObject,
  type TouchEventHandler,
  type UIEventHandler,
  type WheelEventHandler,
} from "react";
import {
  ScrollPositionKeeper,
  getDirectTimelineRows,
} from "@/components/ui/scroll-position-keeper";

interface StickyBottomScrollBinding<TElement extends HTMLElement> {
  contentRef: RefObject<HTMLDivElement | null>;
  onPointerDown: PointerEventHandler<TElement>;
  onScroll: UIEventHandler<TElement>;
  onTouchMove: TouchEventHandler<TElement>;
  onTouchStart: TouchEventHandler<TElement>;
  onWheel: WheelEventHandler<TElement>;
  positionKeeper: ScrollPositionKeeper;
  ref: RefObject<TElement | null>;
}

interface UseStickyBottomScrollArgs {
  contentKey: string;
  streaming: boolean;
}

const STICKY_BOTTOM_THRESHOLD_PX = 4;
const USER_SCROLL_INTENT_MS = 350;
const SMOOTH_SCROLL_MIN_GAP_MS = 250;
const ROW_LIST_SELECTOR = "[data-timeline-row-list]";

function getTopLevelRows(scrollElement: HTMLElement): ArrayLike<HTMLElement> {
  const list = scrollElement.querySelector(ROW_LIST_SELECTOR);
  return list === null ? [] : getDirectTimelineRows(list);
}

function getMaxScrollOffset(element: HTMLElement): number {
  return Math.max(0, element.scrollHeight - element.clientHeight);
}

function scrollToBottom(
  element: HTMLElement,
  top: number,
  smooth: boolean,
): void {
  if (smooth) {
    element.scrollTo({ top, behavior: "smooth" });
  } else {
    element.scrollTop = top;
  }
}

export function useStickyBottomScroll<TElement extends HTMLElement>({
  contentKey,
  streaming,
}: UseStickyBottomScrollArgs): StickyBottomScrollBinding<TElement> {
  const scrollRef = useRef<TElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const shouldStickToBottomRef = useRef(true);
  const pointerScrollIntentRef = useRef(false);
  const userScrollIntentUntilRef = useRef(0);
  const lastScrollAtRef = useRef(0);
  const isFirstScrollRef = useRef(true);
  const wasStreamingRef = useRef(streaming);
  const maxScrollOffsetRef = useRef(0);
  const [positionKeeper] = useState(
    () =>
      new ScrollPositionKeeper({
        getScrollElement: () => scrollRef.current,
        getTopLevelRows,
        isActive: () => !shouldStickToBottomRef.current,
      }),
  );

  const refreshMaxScrollOffset = useCallback((element: TElement): number => {
    const nextOffset = getMaxScrollOffset(element);
    maxScrollOffsetRef.current = nextOffset;
    return nextOffset;
  }, []);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    refreshMaxScrollOffset(element);
    if (typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(() => {
      positionKeeper.reconcile();
      refreshMaxScrollOffset(element);
      positionKeeper.capture();
    });
    observer.observe(element);
    const content = contentRef.current;
    if (content) {
      observer.observe(content);
    }
    return () => observer.disconnect();
  }, [positionKeeper, refreshMaxScrollOffset]);

  useEffect(() => {
    const wasStreaming = wasStreamingRef.current;
    wasStreamingRef.current = streaming;
    if (!streaming && !wasStreaming) {
      return;
    }
    const element = scrollRef.current;
    if (!element || !shouldStickToBottomRef.current) {
      return;
    }
    const now = window.performance.now();
    const smooth =
      !isFirstScrollRef.current &&
      now - lastScrollAtRef.current >= SMOOTH_SCROLL_MIN_GAP_MS;
    scrollToBottom(element, refreshMaxScrollOffset(element), smooth);
    lastScrollAtRef.current = now;
    isFirstScrollRef.current = false;
  }, [contentKey, refreshMaxScrollOffset, streaming]);

  const markUserScrollIntent = useCallback(() => {
    userScrollIntentUntilRef.current =
      window.performance.now() + USER_SCROLL_INTENT_MS;
  }, []);

  const onPointerDown = useCallback<PointerEventHandler<TElement>>(() => {
    pointerScrollIntentRef.current = true;
  }, []);

  const onPointerEnd = useCallback(() => {
    pointerScrollIntentRef.current = false;
  }, []);

  const syncStickToBottom = useCallback((scrollTop: number) => {
    if (maxScrollOffsetRef.current - scrollTop <= STICKY_BOTTOM_THRESHOLD_PX) {
      shouldStickToBottomRef.current = true;
      return;
    }

    const hasUserScrollIntent =
      pointerScrollIntentRef.current ||
      window.performance.now() <= userScrollIntentUntilRef.current;
    if (hasUserScrollIntent) {
      shouldStickToBottomRef.current = false;
    }
  }, []);

  const onScroll = useCallback<UIEventHandler<TElement>>(
    (event) => {
      positionKeeper.reconcile();
      syncStickToBottom(event.currentTarget.scrollTop);
      positionKeeper.capture();
    },
    [positionKeeper, syncStickToBottom],
  );

  useEffect(() => {
    if (!streaming) {
      return;
    }
    window.addEventListener("pointerup", onPointerEnd);
    window.addEventListener("pointercancel", onPointerEnd);
    return () => {
      window.removeEventListener("pointerup", onPointerEnd);
      window.removeEventListener("pointercancel", onPointerEnd);
    };
  }, [onPointerEnd, streaming]);

  return {
    contentRef,
    onPointerDown,
    onScroll,
    onTouchMove: markUserScrollIntent,
    onTouchStart: markUserScrollIntent,
    onWheel: markUserScrollIntent,
    positionKeeper,
    ref: scrollRef,
  };
}
