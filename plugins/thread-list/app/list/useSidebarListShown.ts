import { useLayoutEffect, useState } from "react";
import { observeSharedResize } from "@/lib/shared-resize-observer";
import { useSidebarContentElementRef } from "../ui/sidebar.js";

export function useSidebarListShown(): boolean {
  const scrollElementRef = useSidebarContentElementRef();
  const canObserve = typeof ResizeObserver !== "undefined";
  const [shown, setShown] = useState<boolean | null>(null);
  useLayoutEffect(() => {
    if (!canObserve) return;
    const element = scrollElementRef?.current ?? null;
    if (element === null) {
      const fallback = setTimeout(() => setShown((current) => current ?? true));
      return () => clearTimeout(fallback);
    }
    const readShown = () => element.clientHeight > 0;
    setShown(readShown());
    return observeSharedResize(element, { read: readShown, write: setShown });
  }, [canObserve, scrollElementRef]);
  return canObserve ? shown === true : true;
}
