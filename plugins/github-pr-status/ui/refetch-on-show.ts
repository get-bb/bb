import { useEffect, useRef } from "react";

const shownCounts = new Map<string, number>();

export function useRefetchOnShowAndFocus(
  shown: string | null,
  loaded: boolean,
  refetch: () => Promise<void>,
): void {
  const latest = useRef({ loaded, refetch });
  useEffect(() => {
    latest.current = { loaded, refetch };
  });
  useEffect(() => {
    if (shown === null) return;
    const shownBefore = shownCounts.get(shown) ?? 0;
    shownCounts.set(shown, shownBefore + 1);
    if (shownBefore === 0 && latest.current.loaded)
      void latest.current.refetch();
    const refetchIfVisible = () => {
      if (document.visibilityState === "hidden") return;
      void latest.current.refetch();
    };
    document.addEventListener("visibilitychange", refetchIfVisible);
    window.addEventListener("pageshow", refetchIfVisible);
    return () => {
      document.removeEventListener("visibilitychange", refetchIfVisible);
      window.removeEventListener("pageshow", refetchIfVisible);
      queueMicrotask(() => {
        const count = (shownCounts.get(shown) ?? 1) - 1;
        if (count > 0) shownCounts.set(shown, count);
        else shownCounts.delete(shown);
      });
    };
  }, [shown]);
}
