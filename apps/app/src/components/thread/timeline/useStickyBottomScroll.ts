import {
  useCallback,
  useEffect,
  useRef,
  type PointerEventHandler,
  type RefObject,
  type TouchEventHandler,
  type UIEventHandler,
  type WheelEventHandler,
} from "react";

interface StickyBottomScrollBinding<TElement extends HTMLElement> {
  /**
   * Attach to an element that wraps the scrolled content. The scroll port's
   * box is fixed, so content-only height changes (an image load, a
   * disclosure toggle) never fire its ResizeObserver; observing the wrapper
   * keeps the cached maximum offset fresh for those changes too.
   */
  contentRef: RefObject<HTMLDivElement | null>;
  onPointerDown: PointerEventHandler<TElement>;
  onScroll: UIEventHandler<TElement>;
  onTouchMove: TouchEventHandler<TElement>;
  onTouchStart: TouchEventHandler<TElement>;
  onWheel: WheelEventHandler<TElement>;
  ref: RefObject<TElement | null>;
}

interface UseStickyBottomScrollArgs {
  contentKey: string;
  // When false, the hook is dormant: the scroll-to-bottom effect doesn't fire
  // on contentKey changes and the window pointer-tracking listeners aren't
  // attached. Refs and the on-element handlers (onScroll, onWheel, etc.) are
  // still wired so user-intent state stays accurate across streaming toggles.
  streaming: boolean;
}

const STICKY_BOTTOM_THRESHOLD_PX = 4;
const USER_SCROLL_INTENT_MS = 350;
// Updates that arrive within this window of the previous scroll snap to the
// bottom instantly. Animating each one would start a fresh smooth scroll from a
// stale position before the prior one settled, producing a trailing lag. Slow
// streams (one event per second-ish) clear the gate and animate naturally.
const SMOOTH_SCROLL_MIN_GAP_MS = 250;

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
      refreshMaxScrollOffset(element);
    });
    observer.observe(element);
    // The port only resizes with the viewport; the content wrapper resizes
    // when the content itself grows or shrinks. Both feed the same cache.
    const content = contentRef.current;
    if (content) {
      observer.observe(content);
    }
    return () => observer.disconnect();
  }, [refreshMaxScrollOffset]);

  useEffect(() => {
    const wasStreaming = wasStreamingRef.current;
    wasStreamingRef.current = streaming;
    // Streaming has been off for at least one render — fully dormant. Bail
    // before touching scrollTop so user scroll position is preserved.
    if (!streaming && !wasStreaming) {
      return;
    }
    // Streaming is still on, OR it just flipped off. The flip case is the
    // "final flush": content typically grows in the same render that flips
    // streaming false (the last output chunk arrives with status=completed).
    // We still want one last scroll-to-bottom so the user lands on the very
    // bottom of the now-static content rather than just below the previous
    // tick's bottom.
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

  const onScroll = useCallback<UIEventHandler<TElement>>((event) => {
    // `scrollHeight` and `clientHeight` force layout in WebKit. Cache their
    // difference on content and box-size changes, then read only scrollTop in
    // this high-frequency handler.
    if (
      maxScrollOffsetRef.current - event.currentTarget.scrollTop <=
      STICKY_BOTTOM_THRESHOLD_PX
    ) {
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
    ref: scrollRef,
  };
}
