import { useEffect } from "react";
import { atom, useAtomValue, useSetAtom } from "jotai";

/**
 * Count of open modals that should dim the in-app browser. The native browser
 * `WebContentsView` is an OS-level overlay that a DOM modal backdrop cannot
 * dim, so while one of these modals is open the browser view is hidden (and the
 * DOM new-tab screen shown in its place) so the backdrop covers the whole
 * panel. A count — not a boolean — keeps overlapping/nested modals correct.
 */
const browserDimmingModalCountAtom = atom(0);

/**
 * Register a modal as browser-dimming while `active`: increments the shared
 * count on open and decrements on close/unmount.
 */
export function useBrowserDimmingModal(active: boolean): void {
  const setCount = useSetAtom(browserDimmingModalCountAtom);
  useEffect(() => {
    if (!active) {
      return;
    }
    setCount((count) => count + 1);
    return () => setCount((count) => count - 1);
  }, [active, setCount]);
}

/** Whether any browser-dimming modal is currently open. */
export function useIsBrowserDimmingModalOpen(): boolean {
  return useAtomValue(browserDimmingModalCountAtom) > 0;
}
