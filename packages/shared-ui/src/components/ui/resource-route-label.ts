import { useEffect } from "react";

export const RESOURCE_ROUTE_LABEL_EVENT = "bb:resource-route-label";

export function useResourceRouteLabel(label: string | null | undefined) {
  useEffect(() => {
    if (!label || typeof window === "undefined") return;

    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      window.dispatchEvent(
        new CustomEvent(RESOURCE_ROUTE_LABEL_EVENT, { detail: { label } }),
      );
    });

    return () => {
      active = false;
      window.dispatchEvent(
        new CustomEvent(RESOURCE_ROUTE_LABEL_EVENT, {
          detail: { label: null },
        }),
      );
    };
  }, [label]);
}
