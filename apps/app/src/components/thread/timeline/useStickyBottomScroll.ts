import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import {
  ScrollPositionKeeper,
  getDirectTimelineRows,
} from "@/components/ui/scroll-position-keeper";
import { isIOSWebKit } from "@/lib/ios-webkit";

interface StickyBottomScrollBinding<TElement extends HTMLElement> {
  contentRef: RefObject<HTMLDivElement | null>;
  positionKeeper: ScrollPositionKeeper;
  ref: RefObject<TElement | null>;
}

interface UseStickyBottomScrollArgs {
  streaming: boolean;
}

const STICKY_BOTTOM_THRESHOLD_PX = 4;
const ROW_LIST_SELECTOR = "[data-timeline-row-list]";

function getTopLevelRows(scrollElement: HTMLElement): ArrayLike<HTMLElement> {
  const list = scrollElement.querySelector(ROW_LIST_SELECTOR);
  return list === null ? [] : getDirectTimelineRows(list);
}

export function useStickyBottomScroll<TElement extends HTMLElement>({
  streaming,
}: UseStickyBottomScrollArgs): StickyBottomScrollBinding<TElement> {
  const scrollRef = useRef<TElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [positionKeeper] = useState(
    () =>
      new ScrollPositionKeeper({
        bottomThresholdPx: STICKY_BOTTOM_THRESHOLD_PX,
        deferWritesWhileScrolling: isIOSWebKit(navigator),
        getContentElement: () => contentRef.current,
        getFloorElement: () => null,
        getFooterElement: () => null,
        getScrollElement: () => scrollRef.current,
        getTopLevelRows,
        initiallyAttached: streaming,
      }),
  );

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    return positionKeeper.connect(element);
  }, [positionKeeper]);

  useLayoutEffect(() => {
    if (
      streaming &&
      positionKeeper.getPosition().kind === "free" &&
      !positionKeeper.hasUserScrolled()
    ) {
      positionKeeper.scrollToBottom();
    }
  }, [positionKeeper, streaming]);

  return { contentRef, positionKeeper, ref: scrollRef };
}
