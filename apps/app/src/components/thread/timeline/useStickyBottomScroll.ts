import { createRef, useLayoutEffect, useState, type RefObject } from "react";
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

function createStickyBottomScrollBinding<TElement extends HTMLElement>(
  initiallyAttached: boolean,
): {
  scrollRef: RefObject<TElement | null>;
  contentRef: RefObject<HTMLDivElement | null>;
  positionKeeper: ScrollPositionKeeper;
} {
  const scrollRef = createRef<TElement>();
  const contentRef = createRef<HTMLDivElement>();
  const positionKeeper = new ScrollPositionKeeper({
    bottomThresholdPx: STICKY_BOTTOM_THRESHOLD_PX,
    deferWritesWhileScrolling: isIOSWebKit(navigator),
    getContentElement: () => contentRef.current,
    getFloorElement: () => null,
    getFooterElement: () => null,
    getScrollElement: () => scrollRef.current,
    getTopLevelRows,
    initiallyAttached,
  });
  return { scrollRef, contentRef, positionKeeper };
}

export function useStickyBottomScroll<TElement extends HTMLElement>({
  streaming,
}: UseStickyBottomScrollArgs): StickyBottomScrollBinding<TElement> {
  const [{ scrollRef, contentRef, positionKeeper }] = useState(() =>
    createStickyBottomScrollBinding<TElement>(streaming),
  );

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    return positionKeeper.connect(element);
  }, [positionKeeper, scrollRef]);

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
