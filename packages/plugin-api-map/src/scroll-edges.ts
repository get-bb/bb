import { useCallback, useEffect, useState, type RefObject } from "react";

/**
 * The one treatment for every horizontal scroller in the Guide: the native
 * scrollbar is hidden and each overflowing edge fades, so cut content reads
 * as "more this way" instead of rendering damage. The chip-bar convention
 * (YouTube's chip row, the App Store's category rows): fade only the edges
 * that actually have overflow behind them.
 */
export const SCROLLBAR_HIDDEN_CLASS =
  "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden";

const FADE = "28px";

export function scrollEdgeFadeStyle(
  canScrollLeft: boolean,
  canScrollRight: boolean,
): { maskImage: string } | undefined {
  if (!canScrollLeft && !canScrollRight) return undefined;
  const from = canScrollLeft ? `transparent, black ${FADE}` : "black";
  const to = canScrollRight
    ? `black calc(100% - ${FADE}), transparent`
    : "black";
  return { maskImage: `linear-gradient(to right, ${from}, ${to})` };
}

export interface ScrollEdgeState {
  canScrollLeft: boolean;
  canScrollRight: boolean;
}

export function scrollEdgeState(element: {
  scrollLeft: number;
  scrollWidth: number;
  clientWidth: number;
}): ScrollEdgeState {
  return {
    canScrollLeft: element.scrollLeft > 1,
    canScrollRight:
      element.scrollLeft + element.clientWidth < element.scrollWidth - 1,
  };
}

/** Tracks a horizontal scroller's overflow edges through scroll and resize. */
export function useScrollEdges(
  ref: RefObject<HTMLElement | null>,
): ScrollEdgeState {
  const [state, setState] = useState<ScrollEdgeState>({
    canScrollLeft: false,
    canScrollRight: false,
  });
  const sync = useCallback(() => {
    const element = ref.current;
    if (element) setState(scrollEdgeState(element));
  }, [ref]);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(element);
    if (element.firstElementChild) observer.observe(element.firstElementChild);
    element.addEventListener("scroll", sync, { passive: true });
    return () => {
      observer.disconnect();
      element.removeEventListener("scroll", sync);
    };
  }, [ref, sync]);
  return state;
}
