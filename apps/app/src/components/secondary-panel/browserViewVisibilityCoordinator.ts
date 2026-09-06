import type { BbDesktopBrowserApi } from "@bb/desktop-contract";
import {
  activateDesktopBrowserViewAperture,
  deactivateDesktopBrowserViewAperture,
} from "@/lib/desktop-browser-view-aperture";

export interface BrowserViewVisibilityCoordinator {
  show(
    tabId: string,
    syncBounds: () => void,
    options?: { focus?: boolean },
  ): void;
  cover(tabId: string): void;
  hide(tabId: string): void;
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

interface PendingNativeHide {
  firstFrame: number | null;
  secondFrame: number | null;
  tabId: string;
  timeout: number;
}

const HIDDEN_BROWSER_VIEW_BOUNDS = { height: 0, width: 0, x: 0, y: 0 };

export function createBrowserViewVisibilityCoordinator(
  desktopBrowser: BbDesktopBrowserApi,
): BrowserViewVisibilityCoordinator {
  let visibleTabId: string | null = null;
  let pendingHide: PendingNativeHide | null = null;
  const cancelPendingHide = () => {
    if (pendingHide === null) return;
    if (
      pendingHide.firstFrame !== null &&
      typeof cancelAnimationFrame === "function"
    ) {
      cancelAnimationFrame(pendingHide.firstFrame);
    }
    if (
      pendingHide.secondFrame !== null &&
      typeof cancelAnimationFrame === "function"
    ) {
      cancelAnimationFrame(pendingHide.secondFrame);
    }
    window.clearTimeout(pendingHide.timeout);
    pendingHide = null;
  };
  const flushPendingHide = () => {
    if (pendingHide === null) return;
    const tabId = pendingHide.tabId;
    cancelPendingHide();
    desktopBrowser.setBounds({
      bounds: HIDDEN_BROWSER_VIEW_BOUNDS,
      tabId,
    });
    desktopBrowser.setVisible({ tabId, visible: false });
  };
  const scheduleHideAfterPaint = (tabId: string) => {
    cancelPendingHide();
    const finish = () => {
      if (pendingHide?.tabId !== tabId) return;
      flushPendingHide();
    };
    const timeout = window.setTimeout(finish, 100);
    pendingHide = {
      firstFrame: null,
      secondFrame: null,
      tabId,
      timeout,
    };
    if (typeof requestAnimationFrame === "function") {
      pendingHide.firstFrame = requestAnimationFrame(() => {
        if (pendingHide?.tabId !== tabId) return;
        pendingHide.secondFrame = requestAnimationFrame(finish);
      });
    }
  };
  return {
    show(tabId, syncBounds, options) {
      if (pendingHide?.tabId === tabId) {
        cancelPendingHide();
      } else {
        flushPendingHide();
      }
      if (visibleTabId !== null && visibleTabId !== tabId) {
        deactivateDesktopBrowserViewAperture(visibleTabId);
        desktopBrowser.setVisible({ tabId: visibleTabId, visible: false });
      }
      visibleTabId = tabId;
      activateDesktopBrowserViewAperture(tabId);
      syncBounds();
      const request = { tabId, visible: true };
      if (options?.focus === false) {
        desktopBrowser.setVisibleWithoutFocus(request);
      } else {
        desktopBrowser.setVisible(request);
      }
    },
    cover(tabId) {
      if (visibleTabId === tabId) visibleTabId = null;
      deactivateDesktopBrowserViewAperture(tabId);
      scheduleHideAfterPaint(tabId);
    },
    hide(tabId) {
      if (pendingHide?.tabId === tabId) cancelPendingHide();
      if (visibleTabId === tabId) visibleTabId = null;
      deactivateDesktopBrowserViewAperture(tabId);
      desktopBrowser.setBounds({
        bounds: HIDDEN_BROWSER_VIEW_BOUNDS,
        tabId,
      });
      desktopBrowser.setVisible({ tabId, visible: false });
    },
    release(tabId) {
      if (pendingHide?.tabId === tabId) flushPendingHide();
      if (visibleTabId === tabId) visibleTabId = null;
      deactivateDesktopBrowserViewAperture(tabId);
    },
  };
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
  desktopBrowser.setVisible({ tabId, visible: false });
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
}
