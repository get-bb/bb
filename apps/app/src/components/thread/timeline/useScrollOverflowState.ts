import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";

/**
 * Tracks whether a scroll element has hidden content above and/or below the
 * visible area so callers can render edge-fade affordances only when the
 * fades actually communicate something.
 *
 * Implemented with two zero-height sentinel elements at the top and bottom
 * of the scrolling content and an `IntersectionObserver` rooted on the
 * scroll element. This is intentional: the alternative (`ResizeObserver` +
 * reading `scrollTop`/`scrollHeight`) forces synchronous layout per fire,
 * and ResizeObserver fires every animation frame while a parent expand
 * transition is interpolating the container's height — which made the
 * timeline expand/collapse animation visibly choppy. IntersectionObserver
 * is async and only delivers callbacks when a sentinel actually crosses
 * the visible boundary, so it doesn't pile up work during animations.
 */
export interface ScrollOverflowSentinelRefs<TElement extends HTMLElement> {
  scrollRef: RefObject<TElement | null>;
  topSentinelRef: RefObject<HTMLDivElement | null>;
  bottomSentinelRef: RefObject<HTMLDivElement | null>;
}

export interface ScrollOverflowStateBinding<TElement extends HTMLElement>
  extends ScrollOverflowSentinelRefs<TElement> {
  aboveOverflow: boolean;
  belowOverflow: boolean;
}

export interface UseScrollOverflowStateOptions {
  /**
   * Adds a measurement fallback for compact scroll regions whose overflow
   * affordance must appear immediately on mount. IntersectionObserver remains
   * the primary path; this fallback covers environments where sentinel
   * intersections are unavailable or stale until the user scrolls.
   */
  measureOverflow?: boolean;
}

interface OverflowFlags {
  above: boolean;
  below: boolean;
}

export function useScrollOverflowState<
  TElement extends HTMLElement,
>(
  options: UseScrollOverflowStateOptions = {},
): ScrollOverflowStateBinding<TElement> {
  const scrollRef = useRef<TElement>(null);
  const topSentinelRef = useRef<HTMLDivElement>(null);
  const bottomSentinelRef = useRef<HTMLDivElement>(null);
  const [flags, setFlags] = useState<OverflowFlags>({
    above: false,
    below: false,
  });

  const applyFlags = useCallback((next: OverflowFlags) => {
    setFlags((previous) =>
      previous.above === next.above && previous.below === next.below
        ? previous
        : next,
    );
  }, []);

  useEffect(() => {
    if (!options.measureOverflow || typeof window === "undefined") {
      return;
    }

    const scroll = scrollRef.current;
    if (!scroll) {
      return;
    }

    let frame: number | null = null;
    const measure = () => {
      frame = null;
      applyFlags({
        above: scroll.scrollTop > 1,
        below: scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight > 1,
      });
    };
    const scheduleMeasure = () => {
      if (frame !== null) return;
      frame =
        typeof window.requestAnimationFrame === "function"
          ? window.requestAnimationFrame(measure)
          : window.setTimeout(measure, 0);
    };

    scheduleMeasure();
    scroll.addEventListener("scroll", scheduleMeasure, { passive: true });

    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(scheduleMeasure);
    resizeObserver?.observe(scroll);

    const mutationObserver =
      typeof MutationObserver === "undefined"
        ? null
        : new MutationObserver(scheduleMeasure);
    mutationObserver?.observe(scroll, {
      childList: true,
      characterData: true,
      subtree: true,
    });

    return () => {
      if (frame !== null) {
        if (typeof window.cancelAnimationFrame === "function") {
          window.cancelAnimationFrame(frame);
        } else {
          window.clearTimeout(frame);
        }
      }
      scroll.removeEventListener("scroll", scheduleMeasure);
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
    };
  }, [applyFlags, options.measureOverflow]);

  useEffect(() => {
    const scroll = scrollRef.current;
    const topSentinel = topSentinelRef.current;
    const bottomSentinel = bottomSentinelRef.current;
    if (
      !scroll ||
      !topSentinel ||
      !bottomSentinel ||
      typeof IntersectionObserver === "undefined"
    ) {
      return;
    }

    let aboveVisible = true;
    let belowVisible = true;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.target === topSentinel) {
            aboveVisible = entry.isIntersecting;
          } else if (entry.target === bottomSentinel) {
            belowVisible = entry.isIntersecting;
          }
        }
        applyFlags({
          above: !aboveVisible,
          below: !belowVisible,
        });
      },
      { root: scroll, threshold: 0 },
    );

    observer.observe(topSentinel);
    observer.observe(bottomSentinel);
    return () => {
      observer.disconnect();
    };
  }, [applyFlags]);

  return {
    scrollRef,
    topSentinelRef,
    bottomSentinelRef,
    aboveOverflow: flags.above,
    belowOverflow: flags.below,
  };
}
