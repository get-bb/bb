import { useLayoutEffect, useState } from "react";
import { useSidebarContentElementRef } from "../ui/sidebar.js";

export function useSidebarListShown(): boolean {
  const scrollElementRef = useSidebarContentElementRef();
  const canObserve = typeof ResizeObserver !== "undefined";
  const [shown, setShown] = useState<boolean | null>(null);
  useLayoutEffect(() => {
    if (!canObserve) return;
    const element = scrollElementRef?.current ?? null;
    if (element === null) {
      const fallback = setTimeout(() =>
        setShown((current) => current ?? true),
      );
      return () => clearTimeout(fallback);
    }
    const update = () => setShown(element.clientHeight > 0);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [canObserve, scrollElementRef]);
  return canObserve ? shown === true : true;
}
