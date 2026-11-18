import { useCallback, useState } from "react";
import { observeSharedResize } from "@bb/shared-ui/lib/shared-resize-observer";

export function useElementWidth() {
  const [width, setWidth] = useState(0);
  const ref = useCallback((element: HTMLDivElement | null) => {
    if (element === null) return;
    const measure = () => element.getBoundingClientRect().width;
    setWidth(measure());
    if (typeof ResizeObserver === "undefined") return;
    return observeSharedResize(element, { read: measure, write: setWidth });
  }, []);
  return { ref, width };
}
