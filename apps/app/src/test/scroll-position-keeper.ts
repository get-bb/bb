import { ScrollPositionKeeper } from "@/components/ui/scroll-position-keeper";

export function createInertScrollPositionKeeper(): ScrollPositionKeeper {
  return new ScrollPositionKeeper({
    deferWritesWhileScrolling: false,
    getDeferredOffsetElement: () => null,
    getScrollElement: () => null,
    getTopLevelRows: () => [],
    isActive: () => false,
  });
}
