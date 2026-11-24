import { useLayoutEffect, useState } from "react";
import { observeSharedResize } from "@/lib/shared-resize-observer";
import { useSidebarScrollArea } from "../ui/sidebar.js";

export function useSidebarListShown(): boolean {
  const scrollArea = useSidebarScrollArea();
  const element = scrollArea.kind === "sidebar" ? scrollArea.element : null;
  const canObserve = typeof ResizeObserver !== "undefined";
  const [shown, setShown] = useState<boolean | null>(null);
  useLayoutEffect(() => {
    if (!canObserve) return;
    if (element === null) {
      const fallback = setTimeout(() => setShown((current) => current ?? true));
      return () => clearTimeout(fallback);
    }
    const readShown = () => element.clientHeight > 0;
    setShown(readShown());
    return observeSharedResize(element, { read: readShown, write: setShown });
  }, [canObserve, element]);
  return canObserve ? shown === true : true;
}
