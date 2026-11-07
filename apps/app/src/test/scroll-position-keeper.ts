import { ScrollPositionKeeper } from "@/components/ui/scroll-position-keeper";

export function createInertScrollPositionKeeper(): ScrollPositionKeeper {
  return new ScrollPositionKeeper({
    bottomThresholdPx: 4,
    deferWritesWhileScrolling: false,
    getContentElement: () => null,
    getFloorElement: () => null,
    getFooterElement: () => null,
    getScrollElement: () => null,
    getTopLevelRows: () => [],
    initiallyAttached: true,
  });
}
