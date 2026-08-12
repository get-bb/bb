import { useCallback, useEffect, useState } from "react";

// Two frames let the light drawer shell paint and hand its transform animation
// to the compositor before the panel mounts. The timeout covers environments
// where requestAnimationFrame does not run, such as a hidden document.
const DRAWER_PANEL_REALIZE_FALLBACK_MS = 120;

/**
 * Defers the mount of a bottom drawer's heavy panel until the light shell has
 * painted. On an iPhone the secondary panel's mount plus its style resolution
 * can cost hundreds of milliseconds. Starting the mount two frames later lets
 * the compositor continue the sheet animation while the main thread builds
 * the panel. Once realized, the persistent shell retains the panel so later
 * opens keep its state and do not pay the mount cost again.
 *
 * The caller invokes `realizePanel` from its drawer settle callback and
 * swaps `isPanelRealized ? panel : skeleton` in the drawer body.
 */
export function useDrawerPanelRealization({
  isDrawerOpen,
  rendersAsDrawer,
}: {
  isDrawerOpen: boolean;
  rendersAsDrawer: boolean;
}): { isPanelRealized: boolean; realizePanel: () => void } {
  const [isPanelRealized, setIsPanelRealized] = useState(false);
  const realizePanel = useCallback(() => setIsPanelRealized(true), []);

  useEffect(() => {
    if (!rendersAsDrawer) {
      return;
    }
    if (isDrawerOpen && !isPanelRealized) {
      let firstFrame: number | null = null;
      let secondFrame: number | null = null;
      const realize = () => setIsPanelRealized(true);
      firstFrame = window.requestAnimationFrame(() => {
        firstFrame = null;
        secondFrame = window.requestAnimationFrame(() => {
          secondFrame = null;
          realize();
        });
      });
      const timeout = window.setTimeout(
        realize,
        DRAWER_PANEL_REALIZE_FALLBACK_MS,
      );
      return () => {
        if (firstFrame !== null) {
          window.cancelAnimationFrame(firstFrame);
        }
        if (secondFrame !== null) {
          window.cancelAnimationFrame(secondFrame);
        }
        window.clearTimeout(timeout);
      };
    }
  }, [isDrawerOpen, isPanelRealized, rendersAsDrawer]);

  // A wide viewport renders the panel inline; the drawer flag only has
  // meaning while the drawer branch renders.
  return { isPanelRealized: rendersAsDrawer && isPanelRealized, realizePanel };
}
