import {
  WebContentsView,
  session,
  type BrowserWindow,
  type Session,
} from "electron";
import {
  BB_DESKTOP_BROWSER_MAX_TITLE_LENGTH,
  BB_DESKTOP_BROWSER_MAX_URL_LENGTH,
  type BbDesktopBrowserAttachRequest,
  type BbDesktopBrowserNavigateRequest,
  type BbDesktopBrowserSetBoundsRequest,
  type BbDesktopBrowserSetVisibleRequest,
  type BbDesktopBrowserState,
} from "@bb/server-contract";
import {
  BB_DESKTOP_BROWSER_OPEN_TAB_CHANNEL,
  BB_DESKTOP_BROWSER_STATE_CHANNEL,
} from "./desktop-browser-ipc.js";
import {
  evaluatePopupRate,
  isAllowedBrowserUrl,
  isBlockedBrowserRequestUrl,
  resolveWindowOpenAction,
} from "./desktop-browser-policy.js";

// At most this many popup → in-panel tabs may be spawned per view in a sliding
// window, so a hostile page cannot flood the panel with tabs.
const POPUP_RATE_WINDOW_MS = 10_000;
const POPUP_RATE_MAX_IN_WINDOW = 3;

function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

/**
 * Isolated, persistent partition for the in-app browser. Cookies/storage never
 * touch the bb app session (`defaultSession`) or the user's real browser.
 */
export const BB_BROWSER_PARTITION = "persist:bb-browser";

/**
 * `did-fail-load` reports aborted main-frame loads (a user navigating away, a
 * redirect) with this code; it is not a real error and must not surface one.
 */
const ERR_ABORTED = -3;

interface BrowserViewEntry {
  view: WebContentsView;
  lastErrorText: string | null;
  popupTimestamps: number[];
}

interface CreateDesktopBrowserViewManagerArgs {
  partition?: string;
}

interface HostScopedRequestArgs<TRequest> {
  hostWindow: BrowserWindow;
  request: TRequest;
}

interface HostScopedTabArgs {
  hostWindow: BrowserWindow;
  tabId: string;
}

export interface DesktopBrowserViewManager {
  attach(args: HostScopedRequestArgs<BbDesktopBrowserAttachRequest>): void;
  detach(args: HostScopedTabArgs): void;
  navigate(args: HostScopedRequestArgs<BbDesktopBrowserNavigateRequest>): void;
  goBack(args: HostScopedTabArgs): void;
  goForward(args: HostScopedTabArgs): void;
  reload(args: HostScopedTabArgs): void;
  stop(args: HostScopedTabArgs): void;
  setBounds(
    args: HostScopedRequestArgs<BbDesktopBrowserSetBoundsRequest>,
  ): void;
  setVisible(
    args: HostScopedRequestArgs<BbDesktopBrowserSetVisibleRequest>,
  ): void;
  /**
   * Drop every view owned by a closed host window. Keyed by the host
   * `webContents.id` because the host `BrowserWindow` (and its child views) are
   * already torn down by the time `closed` fires.
   */
  releaseWindow(hostWebContentsId: number): void;
  destroyAll(): void;
}

function browserViewKey(hostWindow: BrowserWindow, tabId: string): string {
  return `${hostWindow.webContents.id}:${tabId}`;
}

function send(hostWindow: BrowserWindow, channel: string, payload: unknown): void {
  if (hostWindow.isDestroyed() || hostWindow.webContents.isDestroyed()) {
    return;
  }
  hostWindow.webContents.send(channel, payload);
}

function buildBrowserState(
  tabId: string,
  entry: BrowserViewEntry,
): BbDesktopBrowserState {
  const webContents = entry.view.webContents;
  const url = webContents.getURL();
  const rawTitle = webContents.getTitle();
  const title = rawTitle.length > 0 && rawTitle !== url ? rawTitle : null;
  // Truncate attacker-influenced strings to the contract caps so the push
  // always validates and oversized values never reach the renderer/localStorage.
  return {
    tabId,
    url: truncate(url, BB_DESKTOP_BROWSER_MAX_URL_LENGTH),
    title: title === null ? null : truncate(title, BB_DESKTOP_BROWSER_MAX_TITLE_LENGTH),
    isLoading: webContents.isLoadingMainFrame(),
    canGoBack: webContents.navigationHistory.canGoBack(),
    canGoForward: webContents.navigationHistory.canGoForward(),
    errorText:
      entry.lastErrorText === null
        ? null
        : truncate(entry.lastErrorText, BB_DESKTOP_BROWSER_MAX_TITLE_LENGTH),
  };
}

export function createDesktopBrowserViewManager(
  args: CreateDesktopBrowserViewManagerArgs = {},
): DesktopBrowserViewManager {
  const partition = args.partition ?? BB_BROWSER_PARTITION;
  const entries = new Map<string, BrowserViewEntry>();
  let hardenedSession: Session | null = null;

  function ensureHardenedSession(): Session {
    if (hardenedSession !== null) {
      return hardenedSession;
    }
    const browserSession = session.fromPartition(partition);
    // Deny every device/capability permission by default in v1 (camera, mic,
    // geolocation, notifications, MIDI, …). A prompt UI is a later phase.
    browserSession.setPermissionRequestHandler((_wc, _permission, callback) => {
      callback(false);
    });
    browserSession.setPermissionCheckHandler(() => false);
    // Downloads are denied in v1 (lowest file-surface risk).
    browserSession.on("will-download", (event) => {
      event.preventDefault();
    });
    // Network firewall: untrusted pages must not be able to reach bb's loopback
    // services or the user's LAN. This fires for ALL resource types — top-level
    // navigation, subresources, fetch/XHR, and WebSockets — so CORS-bypassing
    // requests to 127.0.0.1 / private ranges are cancelled before they are sent.
    browserSession.webRequest.onBeforeRequest((details, callback) => {
      callback({ cancel: isBlockedBrowserRequestUrl(details.url) });
    });
    hardenedSession = browserSession;
    return browserSession;
  }

  function pushState(hostWindow: BrowserWindow, tabId: string): void {
    const entry = entries.get(browserViewKey(hostWindow, tabId));
    if (!entry || entry.view.webContents.isDestroyed()) {
      return;
    }
    send(
      hostWindow,
      BB_DESKTOP_BROWSER_STATE_CHANNEL,
      buildBrowserState(tabId, entry),
    );
  }

  function wireWebContents(
    hostWindow: BrowserWindow,
    tabId: string,
    entry: BrowserViewEntry,
  ): void {
    const webContents = entry.view.webContents;

    webContents.on("will-navigate", (event, url) => {
      if (!isAllowedBrowserUrl(url)) {
        event.preventDefault();
      }
    });
    webContents.on("will-redirect", (event, url) => {
      if (!isAllowedBrowserUrl(url)) {
        event.preventDefault();
      }
    });

    webContents.setWindowOpenHandler((details) => {
      const { openTabUrl } = resolveWindowOpenAction(details.url);
      if (openTabUrl !== null) {
        const decision = evaluatePopupRate({
          timestamps: entry.popupTimestamps,
          now: Date.now(),
          windowMs: POPUP_RATE_WINDOW_MS,
          maxInWindow: POPUP_RATE_MAX_IN_WINDOW,
        });
        entry.popupTimestamps = decision.timestamps;
        if (decision.allowed) {
          send(hostWindow, BB_DESKTOP_BROWSER_OPEN_TAB_CHANNEL, {
            url: openTabUrl,
          });
        }
      }
      return { action: "deny" };
    });

    const refresh = () => pushState(hostWindow, tabId);
    webContents.on("did-start-loading", refresh);
    webContents.on("did-stop-loading", refresh);
    webContents.on("did-navigate", () => {
      entry.lastErrorText = null;
      refresh();
    });
    webContents.on("did-navigate-in-page", refresh);
    webContents.on("did-start-navigation", () => {
      entry.lastErrorText = null;
      refresh();
    });
    webContents.on("page-title-updated", refresh);
    // Favicons are intentionally NOT forwarded: a remote, attacker-controlled
    // favicon URL must never be rendered (or fetched) by the trusted bb app
    // surface. The renderer shows a generic globe icon instead.
    webContents.on(
      "did-fail-load",
      (_event, errorCode, errorDescription, _validatedURL, isMainFrame) => {
        if (!isMainFrame || errorCode === ERR_ABORTED) {
          return;
        }
        entry.lastErrorText =
          errorDescription.length > 0 ? errorDescription : "Failed to load page";
        refresh();
      },
    );
  }

  function createEntry(
    hostWindow: BrowserWindow,
    tabId: string,
  ): BrowserViewEntry {
    ensureHardenedSession();
    const view = new WebContentsView({
      webPreferences: {
        partition,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        allowRunningInsecureContent: false,
        // Intentionally NO preload: browsed pages are untrusted and must never
        // receive a bb bridge.
      },
    });
    const entry: BrowserViewEntry = {
      view,
      lastErrorText: null,
      popupTimestamps: [],
    };
    wireWebContents(hostWindow, tabId, entry);
    hostWindow.contentView.addChildView(view);
    entries.set(browserViewKey(hostWindow, tabId), entry);
    return entry;
  }

  function loadIfNeeded(entry: BrowserViewEntry, url: string): void {
    if (url.length === 0 || !isAllowedBrowserUrl(url)) {
      return;
    }
    if (entry.view.webContents.getURL() === url) {
      return;
    }
    entry.lastErrorText = null;
    entry.view.webContents.loadURL(url).catch(() => {
      // Surfaced through `did-fail-load`; swallow the rejection.
    });
  }

  function destroyEntry(hostWindow: BrowserWindow, key: string): void {
    const entry = entries.get(key);
    if (!entry) {
      return;
    }
    entries.delete(key);
    if (!hostWindow.isDestroyed()) {
      hostWindow.contentView.removeChildView(entry.view);
    }
    if (!entry.view.webContents.isDestroyed()) {
      entry.view.webContents.close();
    }
  }

  function withEntry(
    args: HostScopedTabArgs,
    fn: (entry: BrowserViewEntry) => void,
  ): void {
    const entry = entries.get(browserViewKey(args.hostWindow, args.tabId));
    if (!entry || entry.view.webContents.isDestroyed()) {
      return;
    }
    fn(entry);
  }

  return {
    attach({ hostWindow, request }) {
      const key = browserViewKey(hostWindow, request.tabId);
      const entry = entries.get(key) ?? createEntry(hostWindow, request.tabId);
      entry.view.setBounds(request.bounds);
      entry.view.setVisible(request.visible);
      loadIfNeeded(entry, request.url);
      pushState(hostWindow, request.tabId);
    },
    detach({ hostWindow, tabId }) {
      destroyEntry(hostWindow, browserViewKey(hostWindow, tabId));
    },
    navigate({ hostWindow, request }) {
      withEntry({ hostWindow, tabId: request.tabId }, (entry) => {
        loadIfNeeded(entry, request.url);
      });
    },
    goBack({ hostWindow, tabId }) {
      withEntry({ hostWindow, tabId }, (entry) => {
        if (entry.view.webContents.navigationHistory.canGoBack()) {
          entry.view.webContents.navigationHistory.goBack();
        }
      });
    },
    goForward({ hostWindow, tabId }) {
      withEntry({ hostWindow, tabId }, (entry) => {
        if (entry.view.webContents.navigationHistory.canGoForward()) {
          entry.view.webContents.navigationHistory.goForward();
        }
      });
    },
    reload({ hostWindow, tabId }) {
      withEntry({ hostWindow, tabId }, (entry) => {
        entry.view.webContents.reload();
      });
    },
    stop({ hostWindow, tabId }) {
      withEntry({ hostWindow, tabId }, (entry) => {
        entry.view.webContents.stop();
      });
    },
    setBounds({ hostWindow, request }) {
      withEntry({ hostWindow, tabId: request.tabId }, (entry) => {
        entry.view.setBounds(request.bounds);
      });
    },
    setVisible({ hostWindow, request }) {
      withEntry({ hostWindow, tabId: request.tabId }, (entry) => {
        entry.view.setVisible(request.visible);
      });
    },
    releaseWindow(hostWebContentsId) {
      const prefix = `${hostWebContentsId}:`;
      for (const [key, entry] of [...entries.entries()]) {
        if (!key.startsWith(prefix)) {
          continue;
        }
        entries.delete(key);
        if (!entry.view.webContents.isDestroyed()) {
          entry.view.webContents.close();
        }
      }
    },
    destroyAll() {
      for (const [key, entry] of [...entries.entries()]) {
        entries.delete(key);
        if (!entry.view.webContents.isDestroyed()) {
          entry.view.webContents.close();
        }
      }
    },
  };
}
