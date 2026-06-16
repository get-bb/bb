import { Menu, WebContentsView, session, type Session } from "electron";
import {
  BB_DESKTOP_BROWSER_MAX_TITLE_LENGTH,
  BB_DESKTOP_BROWSER_MAX_URL_LENGTH,
  clampBbDesktopBrowserViewBounds,
  type BbDesktopBrowserAttachRequest,
  type BbDesktopBrowserNavigateRequest,
  type BbDesktopBrowserOpenTabRequest,
  type BbDesktopBrowserScopedOpenTabRequest,
  type BbDesktopBrowserSetBoundsRequest,
  type BbDesktopBrowserSetVisibleRequest,
  type BbDesktopBrowserSnapshot,
  type BbDesktopBrowserState,
  type BbDesktopBrowserViewportBounds,
  type BbDesktopBrowserViewBounds,
} from "@bb/desktop-contract";
import {
  BB_DESKTOP_BROWSER_OPEN_TAB_CHANNEL,
  BB_DESKTOP_BROWSER_SCOPED_OPEN_TAB_CHANNEL,
  BB_DESKTOP_BROWSER_SNAPSHOT_CHANNEL,
  BB_DESKTOP_BROWSER_STATE_CHANNEL,
} from "./desktop-browser-ipc.js";
import {
  evaluatePopupRate,
  isAllowedBrowserUrl,
  isAllowedTrustedLocalTopLevelUrl,
  localRequestOriginKey,
  resolveWindowOpenAction,
  shouldBlockBrowserRequest,
} from "./desktop-browser-policy.js";

// At most this many popup → in-panel tabs may be spawned per view in a sliding
// window, so a hostile page cannot flood the panel with tabs.
const POPUP_RATE_WINDOW_MS = 10_000;
const POPUP_RATE_MAX_IN_WINDOW = 3;

/**
 * At the start of a resize burst the view stays visible until its snapshot
 * capture resolves (capturing a hidden view is unreliable). This cap bounds
 * how long a stalled capture may leave the stale view on screen.
 */
const RESIZE_SNAPSHOT_HIDE_CAP_MS = 80;
/** Placeholder quality: transient, stretched during the drag — favor size. */
const RESIZE_SNAPSHOT_JPEG_QUALITY = 70;

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
  pendingTrustedLocalTopLevelOriginKey: string | null;
  currentMainFrameLocalOriginKey: string | null;
  pendingMainFrameNavigationOriginKey: string | null;
  pendingMainFrameNavigationInitiatorOriginKey: string | null;
  /**
   * The last renderer-measured panel rect. The renderer is the placement
   * authority — it re-measures and pushes whenever its layout actually moves
   * the panel. This cache exists only so native window resizes can re-clamp
   * the view to the live window (see
   * {@link DesktopBrowserViewManager.clampVisibleBoundsForWindow}) without
   * losing the renderer's intent.
   */
  desiredBounds: BbDesktopBrowserViewBounds;
  popupTimestamps: number[];
  visible: boolean;
}

export type DesktopBrowserHostWebContentsPayload =
  | BbDesktopBrowserState
  | BbDesktopBrowserOpenTabRequest
  | BbDesktopBrowserScopedOpenTabRequest
  | BbDesktopBrowserSnapshot;

export interface DesktopBrowserHostContentBounds {
  height: number;
  width: number;
}

export interface DesktopBrowserHostContentView {
  addChildView(view: WebContentsView): void;
  removeChildView(view: WebContentsView): void;
}

export interface DesktopBrowserHostWebContents {
  id: number;
  isDestroyed(): boolean;
  send(channel: string, payload: DesktopBrowserHostWebContentsPayload): void;
}

export interface DesktopBrowserHostWindow {
  contentView: DesktopBrowserHostContentView;
  getContentBounds(): DesktopBrowserHostContentBounds;
  isDestroyed(): boolean;
  webContents: DesktopBrowserHostWebContents;
}

interface CreateDesktopBrowserViewManagerArgs {
  partition?: string;
}

interface HostScopedRequestArgs<TRequest> {
  hostWindow: DesktopBrowserHostWindow;
  request: TRequest;
}

interface HostScopedTabArgs {
  hostWindow: DesktopBrowserHostWindow;
  tabId: string;
}

interface CreateEntryArgs {
  desiredBounds: BbDesktopBrowserViewBounds;
  hostWindow: DesktopBrowserHostWindow;
  tabId: string;
}

interface HostWindowViewportBoundsArgs {
  hostWindow: DesktopBrowserHostWindow;
}

interface SetEntryDesiredBoundsArgs {
  bounds: BbDesktopBrowserViewBounds;
  entry: BrowserViewEntry;
  hostWindow: DesktopBrowserHostWindow;
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
   * Hide every visible view owned by the window for the duration of a native
   * resize burst. During an interactive window resize the host chrome
   * repaints at its own (much slower) cadence while the native views
   * composite independently — no bounds protocol keeps the two visually
   * glued, so a tracked view bleeds over neighboring UI in one direction or
   * the other. Each visible view is first captured and the bitmap pushed to
   * the renderer, which paints it inside the panel as a stand-in that scales
   * with the chrome; the view hides once its capture resolves (or after
   * {@link RESIZE_SNAPSHOT_HIDE_CAP_MS}, whichever is first). Idempotent per
   * window; renderer visibility changes made while hidden are recorded and
   * take effect on {@link endWindowResize}.
   */
  beginWindowResize(hostWindow: DesktopBrowserHostWindow): void;
  /**
   * End a resize burst: re-apply each view's renderer-desired bounds clamped
   * to the live content bounds (bounds land before the view is shown),
   * restore renderer-declared visibility, then push a null snapshot so the
   * renderer drops its placeholder (after the reveal, so the swap never
   * flashes an empty panel). The renderer's own post-resize re-measure
   * typically lands within the caller's settle delay; if it arrives later the
   * view nudges once, which is the acceptable residue.
   */
  endWindowResize(hostWindow: DesktopBrowserHostWindow): void;
  /**
   * Drop every view owned by a closed host window. Keyed by the host
   * `webContents.id` because the host `BrowserWindow` (and its child views) are
   * already torn down by the time `closed` fires.
   */
  releaseWindow(hostWebContentsId: number): void;
  destroyAll(): void;
}

function browserViewKey(
  hostWindow: DesktopBrowserHostWindow,
  tabId: string,
): string {
  return `${hostWindow.webContents.id}:${tabId}`;
}

function send(
  hostWindow: DesktopBrowserHostWindow,
  channel: string,
  payload: DesktopBrowserHostWebContentsPayload,
): void {
  if (hostWindow.isDestroyed() || hostWindow.webContents.isDestroyed()) {
    return;
  }
  hostWindow.webContents.send(channel, payload);
}

function hostWindowViewportBounds(
  args: HostWindowViewportBoundsArgs,
): BbDesktopBrowserViewportBounds {
  const contentBounds = args.hostWindow.getContentBounds();
  return {
    width: contentBounds.width,
    height: contentBounds.height,
  };
}

/**
 * Apply the entry's renderer-desired rect, intersected with the live window
 * content bounds. The clamp happens HERE, against the same
 * `getContentBounds()` space native resize events re-clamp in — the renderer
 * already clamped the rect to its own layout viewport, which diverges from
 * the window content area when DevTools is docked.
 */
function applyEntryDesiredBounds(
  entry: BrowserViewEntry,
  hostWindow: DesktopBrowserHostWindow,
): void {
  entry.view.setBounds(
    clampBbDesktopBrowserViewBounds({
      bounds: entry.desiredBounds,
      viewport: hostWindowViewportBounds({ hostWindow }),
    }),
  );
}

function setEntryDesiredBounds(args: SetEntryDesiredBoundsArgs): void {
  args.entry.desiredBounds = args.bounds;
  applyEntryDesiredBounds(args.entry, args.hostWindow);
}

function clearEntryLocalOriginState(entry: BrowserViewEntry): void {
  entry.pendingTrustedLocalTopLevelOriginKey = null;
  entry.currentMainFrameLocalOriginKey = null;
  entry.pendingMainFrameNavigationOriginKey = null;
  entry.pendingMainFrameNavigationInitiatorOriginKey = null;
}

function clearEntryPendingMainFrameNavigation(entry: BrowserViewEntry): void {
  entry.pendingMainFrameNavigationOriginKey = null;
  entry.pendingMainFrameNavigationInitiatorOriginKey = null;
}

function clearEntryPendingLocalNavigationState(entry: BrowserViewEntry): void {
  entry.pendingTrustedLocalTopLevelOriginKey = null;
  clearEntryPendingMainFrameNavigation(entry);
}

function prepareEntryForTrustedTopLevelLoad(
  entry: BrowserViewEntry,
  url: string,
): boolean {
  if (!isAllowedBrowserUrl(url)) {
    return false;
  }
  if (isAllowedTrustedLocalTopLevelUrl(url)) {
    clearEntryPendingMainFrameNavigation(entry);
    entry.pendingTrustedLocalTopLevelOriginKey = localRequestOriginKey(url);
    return true;
  }
  clearEntryPendingLocalNavigationState(entry);
  return true;
}

function commitEntryMainFrameUrl(entry: BrowserViewEntry, url: string): void {
  const committedOriginKey = localRequestOriginKey(url);
  clearEntryPendingMainFrameNavigation(entry);
  if (
    committedOriginKey !== null &&
    (committedOriginKey === entry.pendingTrustedLocalTopLevelOriginKey ||
      committedOriginKey === entry.currentMainFrameLocalOriginKey)
  ) {
    entry.pendingTrustedLocalTopLevelOriginKey = null;
    entry.currentMainFrameLocalOriginKey = committedOriginKey;
    return;
  }
  clearEntryLocalOriginState(entry);
}

function clearBlockedLocalTopLevelLoad(
  entry: BrowserViewEntry,
  url: string,
): void {
  if (localRequestOriginKey(url) !== null) {
    clearEntryPendingLocalNavigationState(entry);
  }
}

function historyNavigationTargetUrl(
  entry: BrowserViewEntry,
  offset: number,
): string | null {
  const history = entry.view.webContents.navigationHistory;
  const targetEntry = history.getEntryAtIndex(
    history.getActiveIndex() + offset,
  );
  return typeof targetEntry?.url === "string" ? targetEntry.url : null;
}

function prepareEntryForHistoryNavigation(
  entry: BrowserViewEntry,
  offset: number,
): void {
  const targetUrl = historyNavigationTargetUrl(entry, offset);
  const targetOriginKey =
    targetUrl === null ? null : localRequestOriginKey(targetUrl);
  if (
    targetOriginKey !== null &&
    targetOriginKey === entry.currentMainFrameLocalOriginKey
  ) {
    clearEntryPendingMainFrameNavigation(entry);
    entry.pendingTrustedLocalTopLevelOriginKey = targetOriginKey;
    return;
  }
  clearEntryPendingLocalNavigationState(entry);
}

function shouldBlockEntryTopLevelRequest(
  entry: BrowserViewEntry,
  url: string,
  mainFrameInitiatorOriginKey: string | null,
): boolean {
  if (!isAllowedBrowserUrl(url)) {
    return true;
  }
  const webContentsId = entry.view.webContents.id;
  return shouldBlockBrowserRequest({
    url,
    resourceType: "mainFrame",
    isMainFrame: true,
    targetWebContentsId: webContentsId,
    entryWebContentsId: webContentsId,
    pendingTrustedLocalTopLevelOriginKey:
      entry.pendingTrustedLocalTopLevelOriginKey,
    currentMainFrameLocalOriginKey: entry.currentMainFrameLocalOriginKey,
    requestingFrameOriginKey: null,
    mainFrameInitiatorOriginKey,
  });
}

function requestingFrameOriginKey(origin: string | undefined): string | null {
  return origin === undefined ? null : localRequestOriginKey(origin);
}

function rememberAllowedTopLevelNavigation(
  entry: BrowserViewEntry,
  url: string,
  mainFrameInitiatorOriginKey: string | null,
): void {
  const targetOriginKey = localRequestOriginKey(url);
  if (
    targetOriginKey !== null &&
    targetOriginKey !== entry.pendingTrustedLocalTopLevelOriginKey
  ) {
    entry.pendingMainFrameNavigationOriginKey = targetOriginKey;
    entry.pendingMainFrameNavigationInitiatorOriginKey =
      mainFrameInitiatorOriginKey;
    return;
  }
  clearEntryPendingMainFrameNavigation(entry);
}

function pendingMainFrameInitiatorOriginKey(
  entry: BrowserViewEntry,
  url: string,
): string | null {
  const targetOriginKey = localRequestOriginKey(url);
  if (
    targetOriginKey === null ||
    targetOriginKey !== entry.pendingMainFrameNavigationOriginKey
  ) {
    return null;
  }
  return entry.pendingMainFrameNavigationInitiatorOriginKey;
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
    title:
      title === null
        ? null
        : truncate(title, BB_DESKTOP_BROWSER_MAX_TITLE_LENGTH),
    isLoading: webContents.isLoadingMainFrame(),
    canGoBack: webContents.navigationHistory.canGoBack(),
    canGoForward: webContents.navigationHistory.canGoForward(),
    errorText:
      entry.lastErrorText === null
        ? null
        : truncate(entry.lastErrorText, BB_DESKTOP_BROWSER_MAX_TITLE_LENGTH),
  };
}

/**
 * The single browser-session permission we allow. `clipboard-sanitized-write`
 * is write-only: an in-page copy button calling `navigator.clipboard.writeText()`
 * can put sanitized text on the system clipboard, but the page can NOT read the
 * clipboard (`clipboard-read` stays denied). Every other device/capability
 * permission (camera, mic, geolocation, notifications, MIDI, …) stays denied.
 */
export function isAllowedBrowserPermission(permission: string): boolean {
  return permission === "clipboard-sanitized-write";
}

export function createDesktopBrowserViewManager(
  args: CreateDesktopBrowserViewManagerArgs = {},
): DesktopBrowserViewManager {
  const partition = args.partition ?? BB_BROWSER_PARTITION;
  const entries = new Map<string, BrowserViewEntry>();
  const entriesByWebContentsId = new Map<number, BrowserViewEntry>();
  // Host webContents ids with a native resize burst in flight: views of these
  // windows stay hidden regardless of renderer-declared visibility.
  const resizingHostIds = new Set<number>();
  let hardenedSession: Session | null = null;

  function isHostResizing(hostWindow: DesktopBrowserHostWindow): boolean {
    return resizingHostIds.has(hostWindow.webContents.id);
  }

  function applyEntryVisibility(
    entry: BrowserViewEntry,
    hostWindow: DesktopBrowserHostWindow,
  ): void {
    if (entry.view.webContents.isDestroyed()) {
      return;
    }
    entry.view.setVisible(entry.visible && !isHostResizing(hostWindow));
  }

  /**
   * Capture the (still visible) view, push the bitmap to the renderer as its
   * resize placeholder, and only then hide the view. The capture result is
   * dropped if the burst already ended — the live view is back by then and a
   * late placeholder would linger under it into the next burst.
   */
  function startResizeSnapshot(
    hostWindow: DesktopBrowserHostWindow,
    tabId: string,
    entry: BrowserViewEntry,
  ): void {
    const hideCap = setTimeout(() => {
      applyEntryVisibility(entry, hostWindow);
    }, RESIZE_SNAPSHOT_HIDE_CAP_MS);
    entry.view.webContents
      .capturePage()
      .then((image) => {
        if (!isHostResizing(hostWindow) || image.isEmpty()) {
          return;
        }
        const dataUrl = `data:image/jpeg;base64,${image
          .toJPEG(RESIZE_SNAPSHOT_JPEG_QUALITY)
          .toString("base64")}`;
        send(hostWindow, BB_DESKTOP_BROWSER_SNAPSHOT_CHANNEL, {
          tabId,
          dataUrl,
        });
      })
      .catch(() => {
        // No placeholder; the renderer's bare panel background shows instead.
      })
      .finally(() => {
        clearTimeout(hideCap);
        applyEntryVisibility(entry, hostWindow);
      });
  }

  function ensureHardenedSession(): Session {
    if (hardenedSession !== null) {
      return hardenedSession;
    }
    const browserSession = session.fromPartition(partition);
    // Deny every device/capability permission by default in v1 (camera, mic,
    // geolocation, notifications, MIDI, …). The single exception is
    // `clipboard-sanitized-write`, allowed so in-page copy buttons (e.g.
    // GitHub) that call `navigator.clipboard.writeText()` work; this is
    // write-only, so `clipboard-read` stays denied. A prompt UI is a later
    // phase.
    browserSession.setPermissionRequestHandler((_wc, permission, callback) => {
      callback(isAllowedBrowserPermission(permission));
    });
    browserSession.setPermissionCheckHandler((_wc, permission) =>
      isAllowedBrowserPermission(permission),
    );
    // Downloads are denied in v1 (lowest file-surface risk).
    browserSession.on("will-download", (event) => {
      event.preventDefault();
    });
    // Network firewall: untrusted pages must not be able to reach bb's loopback
    // services or the user's LAN. This fires for ALL resource types — top-level
    // navigation, subresources, fetch/XHR, and WebSockets — so CORS-bypassing
    // requests to 127.0.0.1 / private ranges are cancelled before they are sent.
    browserSession.webRequest.onBeforeRequest((details, callback) => {
      const targetWebContentsId = details.webContentsId ?? null;
      const entry =
        targetWebContentsId === null
          ? null
          : (entriesByWebContentsId.get(targetWebContentsId) ?? null);
      const liveEntry =
        entry === null || entry.view.webContents.isDestroyed() ? null : entry;
      const isMainFrameRequest = details.resourceType === "mainFrame";
      callback({
        cancel: shouldBlockBrowserRequest({
          url: details.url,
          resourceType: details.resourceType,
          isMainFrame: isMainFrameRequest,
          targetWebContentsId,
          entryWebContentsId: liveEntry?.view.webContents.id ?? null,
          pendingTrustedLocalTopLevelOriginKey:
            liveEntry?.pendingTrustedLocalTopLevelOriginKey ?? null,
          currentMainFrameLocalOriginKey:
            liveEntry?.currentMainFrameLocalOriginKey ?? null,
          requestingFrameOriginKey: requestingFrameOriginKey(
            details.frame?.origin,
          ),
          mainFrameInitiatorOriginKey:
            liveEntry === null || !isMainFrameRequest
              ? null
              : pendingMainFrameInitiatorOriginKey(liveEntry, details.url),
        }),
      });
    });
    hardenedSession = browserSession;
    return browserSession;
  }

  function pushState(
    hostWindow: DesktopBrowserHostWindow,
    tabId: string,
  ): void {
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
    hostWindow: DesktopBrowserHostWindow,
    tabId: string,
    entry: BrowserViewEntry,
  ): void {
    const webContents = entry.view.webContents;

    webContents.on("will-frame-navigate", (event) => {
      if (!event.isMainFrame) {
        return;
      }
      const mainFrameInitiatorOriginKey = requestingFrameOriginKey(
        event.initiator?.origin,
      );
      if (
        shouldBlockEntryTopLevelRequest(
          entry,
          event.url,
          mainFrameInitiatorOriginKey,
        )
      ) {
        event.preventDefault();
        clearBlockedLocalTopLevelLoad(entry, event.url);
        return;
      }
      rememberAllowedTopLevelNavigation(
        entry,
        event.url,
        mainFrameInitiatorOriginKey,
      );
    });
    webContents.on("will-navigate", (event, url) => {
      const mainFrameInitiatorOriginKey = requestingFrameOriginKey(
        event.initiator?.origin,
      );
      if (
        shouldBlockEntryTopLevelRequest(entry, url, mainFrameInitiatorOriginKey)
      ) {
        event.preventDefault();
        clearBlockedLocalTopLevelLoad(entry, url);
        return;
      }
      rememberAllowedTopLevelNavigation(
        entry,
        url,
        mainFrameInitiatorOriginKey,
      );
    });
    webContents.on("will-redirect", (event, url, _isInPlace, isMainFrame) => {
      if (!isMainFrame) {
        return;
      }
      const mainFrameInitiatorOriginKey = requestingFrameOriginKey(
        event.initiator?.origin,
      );
      if (
        shouldBlockEntryTopLevelRequest(entry, url, mainFrameInitiatorOriginKey)
      ) {
        event.preventDefault();
        clearBlockedLocalTopLevelLoad(entry, url);
        return;
      }
      rememberAllowedTopLevelNavigation(
        entry,
        url,
        mainFrameInitiatorOriginKey,
      );
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
          send(hostWindow, BB_DESKTOP_BROWSER_SCOPED_OPEN_TAB_CHANNEL, {
            tabId,
            url: openTabUrl,
          });
        }
      }
      return { action: "deny" };
    });

    // Right-click menu for the untrusted browser view. Built from this view's
    // own webContents so the standard editing roles act on it (not the host
    // React surface), giving Copy parity even when focus is elsewhere. Only
    // plain editing roles are exposed — no dev tools, reload, or bb-bridge
    // surface — keeping the untrusted-content posture.
    webContents.on("context-menu", (_event, params) => {
      if (webContents.isDestroyed()) {
        return;
      }
      const { editFlags } = params;
      const menu = Menu.buildFromTemplate([
        {
          role: "cut",
          enabled: editFlags.canCut,
        },
        {
          role: "copy",
          enabled: editFlags.canCopy && params.selectionText.length > 0,
        },
        {
          role: "paste",
          enabled: editFlags.canPaste,
        },
        { type: "separator" },
        {
          role: "selectAll",
          enabled: editFlags.canSelectAll,
        },
      ]);
      menu.popup();
    });

    const refresh = () => pushState(hostWindow, tabId);
    webContents.on("did-start-loading", refresh);
    webContents.on("did-stop-loading", refresh);
    webContents.on("did-navigate", (_event, url) => {
      commitEntryMainFrameUrl(entry, url);
      entry.lastErrorText = null;
      refresh();
    });
    webContents.on("did-navigate-in-page", (_event, url, isMainFrame) => {
      if (isMainFrame) {
        commitEntryMainFrameUrl(entry, url);
      }
      refresh();
    });
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
      (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
        if (!isMainFrame || errorCode === ERR_ABORTED) {
          if (isMainFrame && errorCode === ERR_ABORTED) {
            clearEntryPendingLocalNavigationState(entry);
          }
          return;
        }
        clearBlockedLocalTopLevelLoad(entry, validatedURL);
        entry.lastErrorText =
          errorDescription.length > 0
            ? errorDescription
            : "Failed to load page";
        refresh();
      },
    );
  }

  function createEntry(args: CreateEntryArgs): BrowserViewEntry {
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
      pendingTrustedLocalTopLevelOriginKey: null,
      currentMainFrameLocalOriginKey: null,
      pendingMainFrameNavigationOriginKey: null,
      pendingMainFrameNavigationInitiatorOriginKey: null,
      desiredBounds: args.desiredBounds,
      popupTimestamps: [],
      visible: false,
    };
    wireWebContents(args.hostWindow, args.tabId, entry);
    args.hostWindow.contentView.addChildView(view);
    entries.set(browserViewKey(args.hostWindow, args.tabId), entry);
    entriesByWebContentsId.set(view.webContents.id, entry);
    return entry;
  }

  function loadIfNeeded(entry: BrowserViewEntry, url: string): void {
    if (url.length === 0) {
      return;
    }
    if (entry.view.webContents.getURL() === url) {
      return;
    }
    if (!prepareEntryForTrustedTopLevelLoad(entry, url)) {
      return;
    }
    entry.lastErrorText = null;
    entry.view.webContents.loadURL(url).catch(() => {
      clearEntryPendingLocalNavigationState(entry);
      // Usually surfaced through `did-fail-load`; swallow the rejection.
    });
  }

  function destroyEntry(
    hostWindow: DesktopBrowserHostWindow,
    key: string,
  ): void {
    const entry = entries.get(key);
    if (!entry) {
      return;
    }
    entries.delete(key);
    entriesByWebContentsId.delete(entry.view.webContents.id);
    clearEntryLocalOriginState(entry);
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
      const existing = entries.get(key) ?? null;
      // A freshly-created entry starts hidden, so its prior visibility is false.
      const wasVisible = existing?.visible ?? false;
      const entry =
        existing ??
        createEntry({
          desiredBounds: request.bounds,
          hostWindow,
          tabId: request.tabId,
        });
      setEntryDesiredBounds({ bounds: request.bounds, entry, hostWindow });
      entry.visible = request.visible;
      applyEntryVisibility(entry, hostWindow);
      // Focus on a real not-visible → visible transition so a freshly-mounted
      // active tab (shown via attach, not setVisible) wires the Edit-menu
      // copy/cut/paste roles and Cmd+C to this view's webContents.
      if (
        request.visible &&
        !wasVisible &&
        !entry.view.webContents.isDestroyed()
      ) {
        entry.view.webContents.focus();
      }
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
          prepareEntryForHistoryNavigation(entry, -1);
          entry.view.webContents.navigationHistory.goBack();
        }
      });
    },
    goForward({ hostWindow, tabId }) {
      withEntry({ hostWindow, tabId }, (entry) => {
        if (entry.view.webContents.navigationHistory.canGoForward()) {
          prepareEntryForHistoryNavigation(entry, 1);
          entry.view.webContents.navigationHistory.goForward();
        }
      });
    },
    reload({ hostWindow, tabId }) {
      withEntry({ hostWindow, tabId }, (entry) => {
        const currentOriginKey = localRequestOriginKey(
          entry.view.webContents.getURL(),
        );
        if (
          currentOriginKey !== null &&
          currentOriginKey === entry.currentMainFrameLocalOriginKey
        ) {
          clearEntryPendingMainFrameNavigation(entry);
          entry.pendingTrustedLocalTopLevelOriginKey = currentOriginKey;
        }
        entry.view.webContents.reload();
      });
    },
    stop({ hostWindow, tabId }) {
      withEntry({ hostWindow, tabId }, (entry) => {
        clearEntryPendingLocalNavigationState(entry);
        entry.view.webContents.stop();
      });
    },
    setBounds({ hostWindow, request }) {
      withEntry({ hostWindow, tabId: request.tabId }, (entry) => {
        setEntryDesiredBounds({ bounds: request.bounds, entry, hostWindow });
      });
    },
    setVisible({ hostWindow, request }) {
      withEntry({ hostWindow, tabId: request.tabId }, (entry) => {
        const wasVisible = entry.visible;
        entry.visible = request.visible;
        applyEntryVisibility(entry, hostWindow);
        // Focus the view only on a real not-visible → visible transition so the
        // Edit-menu copy/cut/paste roles and Cmd+C target this view's
        // webContents (the focused one). Skip redundant re-syncs so we never
        // yank focus away from the React address bar mid-interaction.
        if (
          request.visible &&
          !wasVisible &&
          !entry.view.webContents.isDestroyed()
        ) {
          entry.view.webContents.focus();
        }
      });
    },
    beginWindowResize(hostWindow) {
      if (isHostResizing(hostWindow)) {
        return;
      }
      resizingHostIds.add(hostWindow.webContents.id);
      const prefix = `${hostWindow.webContents.id}:`;
      for (const [key, entry] of entries.entries()) {
        if (!key.startsWith(prefix) || entry.view.webContents.isDestroyed()) {
          continue;
        }
        if (entry.visible) {
          startResizeSnapshot(hostWindow, key.slice(prefix.length), entry);
        }
      }
    },
    endWindowResize(hostWindow) {
      if (!isHostResizing(hostWindow)) {
        return;
      }
      resizingHostIds.delete(hostWindow.webContents.id);
      const prefix = `${hostWindow.webContents.id}:`;
      for (const [key, entry] of entries.entries()) {
        if (!key.startsWith(prefix) || entry.view.webContents.isDestroyed()) {
          continue;
        }
        if (entry.visible) {
          applyEntryDesiredBounds(entry, hostWindow);
        }
        applyEntryVisibility(entry, hostWindow);
        send(hostWindow, BB_DESKTOP_BROWSER_SNAPSHOT_CHANNEL, {
          tabId: key.slice(prefix.length),
          dataUrl: null,
        });
      }
    },
    releaseWindow(hostWebContentsId) {
      resizingHostIds.delete(hostWebContentsId);
      const prefix = `${hostWebContentsId}:`;
      for (const [key, entry] of [...entries.entries()]) {
        if (!key.startsWith(prefix)) {
          continue;
        }
        entries.delete(key);
        entriesByWebContentsId.delete(entry.view.webContents.id);
        clearEntryLocalOriginState(entry);
        if (!entry.view.webContents.isDestroyed()) {
          entry.view.webContents.close();
        }
      }
    },
    destroyAll() {
      resizingHostIds.clear();
      for (const [key, entry] of [...entries.entries()]) {
        entries.delete(key);
        entriesByWebContentsId.delete(entry.view.webContents.id);
        clearEntryLocalOriginState(entry);
        if (!entry.view.webContents.isDestroyed()) {
          entry.view.webContents.close();
        }
      }
    },
  };
}
