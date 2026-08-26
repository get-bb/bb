import { useEffect } from "react";
import { atom, useAtomValue, useSetAtom } from "jotai";

/**
 * Count of open DOM overlays that must cover the in-app browser. The native
 * browser `WebContentsView` is an OS-level overlay that always paints above the
 * renderer, so dialogs, popovers, and tooltips cannot cover it with z-index.
 * While one of these overlays is open the browser view is hidden. A count —
 * not a boolean — keeps overlapping/nested overlays correct.
 */
const browserDimmingModalCountAtom = atom(0);

/**
 * Register any renderer overlay that needs to cover the native browser view.
 */
export function useBrowserDimmingOverlay(active: boolean): void {
  const setCount = useSetAtom(browserDimmingModalCountAtom);
  useEffect(() => {
    if (!active) {
      return;
    }
    setCount((count) => count + 1);
    return () => setCount((count) => count - 1);
  }, [active, setCount]);
}

/** Shared-ui dialogs retain their existing semantic entry point. */
export function useBrowserDimmingModal(active: boolean): void {
  useBrowserDimmingOverlay(active);
}

/** Whether any browser-dimming overlay is currently open. */
export function useIsBrowserDimmingModalOpen(): boolean {
  return useAtomValue(browserDimmingModalCountAtom) > 0;
}
