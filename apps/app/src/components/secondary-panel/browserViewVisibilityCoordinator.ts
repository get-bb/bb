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

interface BrowserViewRecord {
  environmentId: string | null;
  tabId: string;
  threadId: string;
}

interface RegisterBrowserViewArgs {
  environmentId: string | null;
  tabId: string;
  threadId: string;
}

interface DestroyPersistedBrowserViewArgs {
  desktopBrowser: BbDesktopBrowserApi;
  tabId: string;
}

interface DestroyPersistedBrowserViewsForThreadArgs {
  desktopBrowser: BbDesktopBrowserApi | null;
  threadId: string;
}

interface DestroyPersistedBrowserViewsForEnvironmentArgs {
  desktopBrowser: BbDesktopBrowserApi | null;
  environmentId: string;
}

const browserViewRecords = new Map<string, BrowserViewRecord>();
let sharedDesktopBrowser: BbDesktopBrowserApi | null = null;
let sharedCoordinator: BrowserViewVisibilityCoordinator | null = null;

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

export function getBrowserViewVisibilityCoordinator(
  desktopBrowser: BbDesktopBrowserApi,
): BrowserViewVisibilityCoordinator {
  if (sharedDesktopBrowser !== desktopBrowser || sharedCoordinator === null) {
    sharedDesktopBrowser = desktopBrowser;
    sharedCoordinator = createBrowserViewVisibilityCoordinator(desktopBrowser);
  }
  return sharedCoordinator;
}

export function registerBrowserView({
  environmentId,
  tabId,
  threadId,
}: RegisterBrowserViewArgs): void {
  browserViewRecords.set(tabId, { environmentId, tabId, threadId });
}

export function destroyPersistedBrowserView({
  desktopBrowser,
  tabId,
}: DestroyPersistedBrowserViewArgs): void {
  const coordinator = getBrowserViewVisibilityCoordinator(desktopBrowser);
  coordinator.hide(tabId);
  coordinator.release(tabId);
  desktopBrowser.detach(tabId);
  browserViewRecords.delete(tabId);
}

export function destroyPersistedBrowserViewsForThread({
  desktopBrowser,
  threadId,
}: DestroyPersistedBrowserViewsForThreadArgs): void {
  if (desktopBrowser === null) {
    return;
  }
  const records = [...browserViewRecords.values()];
  for (const record of records) {
    if (record.threadId === threadId) {
      destroyPersistedBrowserView({ desktopBrowser, tabId: record.tabId });
    }
  }
}

export function destroyPersistedBrowserViewsForEnvironment({
  desktopBrowser,
  environmentId,
}: DestroyPersistedBrowserViewsForEnvironmentArgs): void {
  if (desktopBrowser === null) {
    return;
  }
  const records = [...browserViewRecords.values()];
  for (const record of records) {
    if (record.environmentId === environmentId) {
      destroyPersistedBrowserView({ desktopBrowser, tabId: record.tabId });
    }
  }
}

export function resetBrowserViewPersistence(): void {
  browserViewRecords.clear();
  sharedDesktopBrowser = null;
  sharedCoordinator = null;
}
