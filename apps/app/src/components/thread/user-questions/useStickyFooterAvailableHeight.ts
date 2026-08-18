import { useEffect, useState, type RefObject } from "react";
import { useBottomAnchoredScroll } from "@/components/ui/bottom-anchored-scroll-body";

/** Marks the sticky footer wrapper of a bottom-anchored scroll body. */
export const SCROLL_FOOTER_ATTRIBUTE = "data-scroll-footer";
/** Marks each footer element whose height follows this hook. */
export const STICKY_FOOTER_FLEX_ATTRIBUTE = "data-sticky-footer-flex";

/**
 * Measures how tall `ref` may grow while the sticky footer that contains it
 * still fits inside the scroll port. A viewport-based `calc()` cannot know how
 * much space the header, safe-area insets, and sibling footer content (goal
 * card, child banners) take, so a fixed reservation either wastes space or
 * pushes the footer taller than the scroll port. A too-tall sticky footer
 * clips its top edge and hides its controls on mobile.
 *
 * Several forms can share one footer (child-thread questions plus the current
 * one). Each form subtracts only the fixed content and splits the remainder
 * evenly with the other flex elements. The fixed content does not depend on
 * any form height, so the values settle in one pass instead of two forms each
 * treating the other as fixed and chasing each other.
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
    element.setAttribute(STICKY_FOOTER_FLEX_ATTRIBUTE, "");
    const measure = () => {
      const flexElements = footer.querySelectorAll<HTMLElement>(
        `[${STICKY_FOOTER_FLEX_ATTRIBUTE}]`,
      );
      let flexHeight = 0;
      for (const flexElement of flexElements) {
        flexHeight += flexElement.offsetHeight;
      }
      const fixedHeight = footer.offsetHeight - flexHeight;
      const shared = Math.max(0, scrollElement.clientHeight - fixedHeight);
      const next = Math.floor(shared / Math.max(1, flexElements.length));
      setAvailableHeight((current) => (current === next ? current : next));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(scrollElement);
    observer.observe(footer);
    return () => {
      observer.disconnect();
      element.removeAttribute(STICKY_FOOTER_FLEX_ATTRIBUTE);
    };
  }, [getScrollElement, ref]);

  return availableHeight;
}
