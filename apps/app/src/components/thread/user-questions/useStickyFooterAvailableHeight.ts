import { useEffect, useState, type RefObject } from "react";
import { useBottomAnchoredScroll } from "@/components/ui/bottom-anchored-scroll-body";

/** Marks the sticky footer wrapper of a bottom-anchored scroll body. */
export const SCROLL_FOOTER_ATTRIBUTE = "data-scroll-footer";

/**
 * Measures how tall `ref` may grow while the sticky footer that contains it
 * still fits inside the scroll port. A viewport-based `calc()` cannot know how
 * much space the header, safe-area insets, and sibling footer content (goal
 * card, child banners) take, so a fixed reservation either wastes space or
 * pushes the footer taller than the scroll port. A too-tall sticky footer
 * clips its top edge and hides its controls on mobile.
 *
 * Returns `null` outside a bottom-anchored scroll body (stories, tests) so the
 * caller can fall back to a viewport bound.
 */
export function useStickyFooterAvailableHeight(
  ref: RefObject<HTMLElement | null>,
): number | null {
  const bottomAnchor = useBottomAnchoredScroll();
  const getScrollElement = bottomAnchor?.getScrollElement ?? null;
  const [availableHeight, setAvailableHeight] = useState<number | null>(null);

  // A passive effect, not a layout effect: the scroll element belongs to an
  // ancestor, and ancestor refs attach after descendant layout effects run.
  useEffect(() => {
    const element = ref.current;
    const scrollElement = getScrollElement?.() ?? null;
    const footer = element?.closest<HTMLElement>(`[${SCROLL_FOOTER_ATTRIBUTE}]`);
    if (!element || !scrollElement || !footer) {
      setAvailableHeight(null);
      return;
    }
    const measure = () => {
      // Everything in the footer other than this element keeps its height
      // when this element shrinks, so the subtraction is stable across
      // observer callbacks and the measurement converges in one pass.
      const siblingsHeight = footer.offsetHeight - element.offsetHeight;
      const next = Math.max(0, scrollElement.clientHeight - siblingsHeight);
      setAvailableHeight((current) => (current === next ? current : next));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(scrollElement);
    observer.observe(footer);
    return () => observer.disconnect();
  }, [getScrollElement, ref]);

  return availableHeight;
}
