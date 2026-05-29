import type { BbDesktopBrowserApi } from "@bb/server-contract";

/**
 * Owns the "only one browser view is visible at a time" invariant for a panel's
 * browser-tab deck. A native `WebContentsView` is an OS-level overlay that
 * `display:none` cannot hide, so when the active tab changes the previously
 * shown view MUST be hidden before the next one is shown — otherwise two views
 * briefly overlap.
 *
 * Each `BrowserTabContent` only declares intent (`show`/`hide` itself); the
 * coordinator — owned by the deck — decides ordering. Because `show` always
 * hides the currently-visible tab first, the hide-before-show guarantee holds
 * regardless of the order in which the children's effects run (e.g. switching to
 * an earlier tab in the list still hides the later one first).
 */
export interface BrowserViewVisibilityCoordinator {
  /**
   * Make `tabId` the single visible view: hide whichever other tab is currently
   * visible, then sync bounds and show this one (bounds before show so it never
   * appears at stale/zero bounds).
   */
  show(tabId: string, syncBounds: () => void): void;
  /** Hide `tabId`'s view (no-op overlay-wise if it was already hidden). */
  hide(tabId: string): void;
  /**
   * Forget `tabId` without touching its view — used when the tab unmounts and
   * its view is about to be destroyed, so a later `show` does not try to hide a
   * gone view.
   */
  release(tabId: string): void;
}

export function createBrowserViewVisibilityCoordinator(
  desktopBrowser: BbDesktopBrowserApi,
): BrowserViewVisibilityCoordinator {
  // The browser tab whose native view is currently shown, or null when none is.
  let visibleTabId: string | null = null;
  return {
    show(tabId, syncBounds) {
      if (visibleTabId !== null && visibleTabId !== tabId) {
        desktopBrowser.setVisible({ tabId: visibleTabId, visible: false });
      }
      visibleTabId = tabId;
      syncBounds();
      desktopBrowser.setVisible({ tabId, visible: true });
    },
    hide(tabId) {
      if (visibleTabId === tabId) {
        visibleTabId = null;
      }
      desktopBrowser.setVisible({ tabId, visible: false });
    },
    release(tabId) {
      if (visibleTabId === tabId) {
        visibleTabId = null;
      }
    },
  };
}
