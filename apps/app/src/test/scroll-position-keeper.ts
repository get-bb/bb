import { ScrollPositionKeeper } from "@/components/ui/scroll-position-keeper";

export function createInertScrollPositionKeeper(): ScrollPositionKeeper {
  return new ScrollPositionKeeper({
    getScrollElement: () => null,
    getTopLevelRows: () => [],
    isActive: () => false,
  });
}
