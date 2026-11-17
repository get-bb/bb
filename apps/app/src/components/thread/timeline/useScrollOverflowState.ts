import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { observeSharedResize } from "@bb/shared-ui/lib/shared-resize-observer";

interface ScrollOverflowSentinelRefs<TElement extends HTMLElement> {
  scrollRef: RefObject<TElement | null>;
  topSentinelRef: RefObject<HTMLDivElement | null>;
  bottomSentinelRef: RefObject<HTMLDivElement | null>;
}

interface ScrollOverflowStateBinding<
  TElement extends HTMLElement,
> extends ScrollOverflowSentinelRefs<TElement> {
  aboveOverflow: boolean;
  belowOverflow: boolean;
}

interface UseScrollOverflowStateOptions {
  enabled?: boolean;
  measureOverflow?: boolean;
}

interface OverflowFlags {
  above: boolean;
  below: boolean;
}

export function useScrollOverflowState<TElement extends HTMLElement>(
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

  if (options.enabled === false && (flags.above || flags.below)) {
    setFlags({ above: false, below: false });
  }

  useEffect(() => {
    if (options.enabled === false) {
      return;
    }
    if (!options.measureOverflow || typeof window === "undefined") {
      return;
    }

    const scroll = scrollRef.current;
    if (!scroll) {
      return;
    }

    const pending: { frame: number | null } = { frame: null };
    const readFlags = (): OverflowFlags => ({
      above: scroll.scrollTop > 1,
      below: scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight > 1,
    });
    const measure = () => {
      pending.frame = null;
      applyFlags(readFlags());
    };
    const scheduleMeasure = () => {
      if (pending.frame !== null) return;
      pending.frame =
        typeof window.requestAnimationFrame === "function"
          ? window.requestAnimationFrame(measure)
          : window.setTimeout(measure, 0);
    };

    scheduleMeasure();
    scroll.addEventListener("scroll", scheduleMeasure, { passive: true });

    const unobserveResize =
      typeof ResizeObserver === "undefined"
        ? null
        : observeSharedResize(scroll, { read: readFlags, write: applyFlags });

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
      if (pending.frame !== null) {
        if (typeof window.cancelAnimationFrame === "function") {
          window.cancelAnimationFrame(pending.frame);
        } else {
          window.clearTimeout(pending.frame);
        }
      }
      scroll.removeEventListener("scroll", scheduleMeasure);
      unobserveResize?.();
      mutationObserver?.disconnect();
    };
  }, [applyFlags, options.enabled, options.measureOverflow]);

  useEffect(() => {
    if (options.enabled === false) return;
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

    const visible = { above: true, below: true };

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.target === topSentinel) {
            visible.above = entry.isIntersecting;
          } else if (entry.target === bottomSentinel) {
            visible.below = entry.isIntersecting;
          }
        }
        const hasOverflow = scroll.scrollHeight - scroll.clientHeight > 1;
        applyFlags({
          above: hasOverflow && !visible.above,
          below: hasOverflow && !visible.below,
        });
      },
      { root: scroll, threshold: 0 },
    );

    observer.observe(topSentinel);
    observer.observe(bottomSentinel);
    return () => {
      observer.disconnect();
    };
  }, [applyFlags, options.enabled]);

  return {
    scrollRef,
    topSentinelRef,
    bottomSentinelRef,
    aboveOverflow: flags.above,
    belowOverflow: flags.below,
  };
}
