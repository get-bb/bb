import { useCallback, useEffect, useState, type RefObject } from "react";
import { observeSharedResize } from "@/lib/shared-resize-observer";

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
    const phases = {
      read: () => scrollEdgeState(element),
      write: (next: ScrollEdgeState) =>
        setState((current) =>
          current.canScrollLeft === next.canScrollLeft &&
          current.canScrollRight === next.canScrollRight
            ? current
            : next,
        ),
    };
    const unobserve = observeSharedResize(
      [element, element.firstElementChild].filter(
        (target): target is Element => target !== null,
      ),
      phases,
    );
    element.addEventListener("scroll", sync, { passive: true });
    return () => {
      unobserve();
      element.removeEventListener("scroll", sync);
    };
  }, [ref, sync]);
  return state;
}
