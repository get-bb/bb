import { useEffect, useState, type RefObject } from "react";
import { observeSharedResize } from "@bb/shared-ui/lib/shared-resize-observer";
import { useBottomAnchoredScroll } from "@/components/ui/bottom-anchored-scroll-body";

export const SCROLL_FOOTER_ATTRIBUTE = "data-scroll-footer";
const STICKY_FOOTER_FLEX_ATTRIBUTE = "data-sticky-footer-flex";

export function useStickyFooterAvailableHeight(
  ref: RefObject<HTMLElement | null>,
  enabled = true,
): number | null {
  const bottomAnchor = useBottomAnchoredScroll();
  const getScrollElement = bottomAnchor?.getScrollElement ?? null;
  const [availableHeight, setAvailableHeight] = useState<number | null>(null);

  useEffect(() => {
    const element = ref.current;
    const scrollElement = getScrollElement?.() ?? null;
    const footer = element?.closest<HTMLElement>(
      `[${SCROLL_FOOTER_ATTRIBUTE}]`,
    );
    if (!enabled || !element || !scrollElement || !footer) {
      setAvailableHeight(null);
      return;
    }
    element.setAttribute(STICKY_FOOTER_FLEX_ATTRIBUTE, "");
    const read = () => {
      const flexElements = footer.querySelectorAll<HTMLElement>(
        `[${STICKY_FOOTER_FLEX_ATTRIBUTE}]`,
      );
      let flexHeight = 0;
      for (const flexElement of flexElements) {
        flexHeight += flexElement.offsetHeight;
      }
      const fixedHeight = footer.offsetHeight - flexHeight;
      const shared = Math.max(0, scrollElement.clientHeight - fixedHeight);
      return Math.floor(shared / Math.max(1, flexElements.length));
    };
    const write = (next: number) =>
      setAvailableHeight((current) => (current === next ? current : next));
    write(read());
    const unobserve = observeSharedResize([scrollElement, footer], {
      read,
      write,
    });
    return () => {
      unobserve();
      element.removeAttribute(STICKY_FOOTER_FLEX_ATTRIBUTE);
    };
  }, [enabled, getScrollElement, ref]);

  return availableHeight;
}
