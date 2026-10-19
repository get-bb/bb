import { useEffect, useState } from "react";
import { useIsRouteNavigationPending } from "./app-route-anchor";

export const ROUTE_NAVIGATION_INDICATOR_REVEAL_DELAY_MS = 120;
export const ROUTE_NAVIGATION_INDICATOR_MIN_VISIBLE_MS = 320;

export function createDelayedBusyIndicator(
  setVisible: (visible: boolean) => void,
): { update: (busy: boolean) => (() => void) | undefined } {
  let shownAt: number | null = null;
  return {
    update: (busy) => {
      if (busy) {
        if (shownAt !== null) return;
        const revealTimeout = setTimeout(() => {
          shownAt = Date.now();
          setVisible(true);
        }, ROUTE_NAVIGATION_INDICATOR_REVEAL_DELAY_MS);
        return () => clearTimeout(revealTimeout);
      }

      if (shownAt === null) {
        setVisible(false);
        return;
      }

      const remainingMs =
        ROUTE_NAVIGATION_INDICATOR_MIN_VISIBLE_MS - (Date.now() - shownAt);
      if (remainingMs <= 0) {
        shownAt = null;
        setVisible(false);
        return;
      }

      const hideTimeout = setTimeout(() => {
        shownAt = null;
        setVisible(false);
      }, remainingMs);
      return () => clearTimeout(hideTimeout);
    },
  };
}

function useDelayedBusyIndicator(busy: boolean): boolean {
  const [visible, setVisible] = useState(false);
  const [indicator] = useState(() => createDelayedBusyIndicator(setVisible));

  useEffect(() => indicator.update(busy), [busy, indicator]);

  return visible;
}

export function RouteNavigationIndicator() {
  const isPending = useIsRouteNavigationPending();
  const visible = useDelayedBusyIndicator(isPending);

  if (!visible) return null;

  return (
    <div
      data-testid="route-navigation-indicator"
      role="progressbar"
      aria-label="Loading page"
      className="pointer-events-none fixed inset-x-0 top-[env(safe-area-inset-top)] z-100 h-0.5 overflow-hidden bg-transparent"
    >
      <div className="h-full w-1/3 animate-indeterminate-progress rounded-full bg-muted-foreground" />
    </div>
  );
}
