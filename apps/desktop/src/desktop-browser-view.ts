import { Menu, WebContentsView, session, type Session } from "electron";
import {
  BB_DESKTOP_BROWSER_MAX_TITLE_LENGTH,
  BB_DESKTOP_BROWSER_MAX_URL_LENGTH,
  clampBbDesktopBrowserViewBounds,
  type BbDesktopBrowserAttachRequest,
  type BbDesktopBrowserFindInPageRequest,
  type BbDesktopBrowserFindResult,
  type BbDesktopBrowserNavigateRequest,
  type BbDesktopBrowserOpenTabRequest,
  type BbDesktopBrowserScopedOpenTabRequest,
  type BbDesktopBrowserSetBoundsRequest,
  type BbDesktopBrowserSetVisibleRequest,
  type BbDesktopBrowserSnapshot,
  type BbDesktopBrowserState,
  type BbDesktopBrowserTabRef,
  type BbDesktopBrowserStopFindInPageRequest,
  type BbDesktopBrowserViewportBounds,
  type BbDesktopBrowserViewBounds,
} from "@bb/desktop-contract";
import type { AppCommandId, AppShortcutInput } from "@bb/domain";
import {
  BB_DESKTOP_BROWSER_FIND_RESULT_CHANNEL,
  BB_DESKTOP_BROWSER_OPEN_TAB_CHANNEL,
  BB_DESKTOP_BROWSER_FOCUSED_CHANNEL,
  BB_DESKTOP_BROWSER_SCOPED_OPEN_TAB_CHANNEL,
  BB_DESKTOP_BROWSER_SNAPSHOT_CHANNEL,
  BB_DESKTOP_BROWSER_STATE_CHANNEL,
} from "./desktop-browser-ipc.js";
import {
  evaluatePopupRate,
  isAllowedBrowserUrl,
  resolveWindowOpenAction,
} from "./desktop-browser-policy.js";
import {
  DesktopBrowserAutomationDriver,
  type BrowserAutomationCommand,
  type BrowserAutomationCommandResult,
  type BrowserAutomationPageState,
} from "./desktop-browser-automation.js";

const POPUP_RATE_WINDOW_MS = 10_000;
const POPUP_RATE_MAX_IN_WINDOW = 3;

const RESIZE_SNAPSHOT_HIDE_CAP_MS = 80;
const RESIZE_SNAPSHOT_JPEG_QUALITY = 70;
const RENDERER_RECOVERY_DELAY_MS = 250;
const RENDERER_RECOVERY_MAX_ATTEMPTS = 2;
const AUTOMATION_RESERVATION_TTL_MS = 30_000;
const MAX_AUTOMATION_RESERVATIONS_PER_WINDOW = 4;

function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

const BB_BROWSER_PARTITION = "persist:bb-browser";

const ERR_ABORTED = -3;

interface BrowserViewEntry {
  automationReservationTargetId: string | null;
  view: WebContentsView;
  lastErrorText: string | null;
  desiredBounds: BbDesktopBrowserViewBounds;
  popupTimestamps: number[];
  rendererRecoveryAttempts: number;
  rendererRecoveryState: "healthy" | "pending" | "blocked";
  rendererRecoveryTimer: ReturnType<typeof setTimeout> | null;
  suppressNextFocusNotification: boolean;
  visible: boolean;
  activeFindRequestId: number | null;
}

export type DesktopBrowserHostWebContentsPayload =
  | BbDesktopBrowserState
  | BbDesktopBrowserOpenTabRequest
  | BbDesktopBrowserScopedOpenTabRequest
  | BbDesktopBrowserSnapshot
  | BbDesktopBrowserTabRef
  | BbDesktopBrowserFindResult;

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

interface DispatchDesktopBrowserAppCommandArgs {
  command: AppCommandId;
  hostWebContentsId: number;
}

export interface CreateDesktopBrowserViewManagerArgs {
  activateHostWindow: (hostWebContentsId: number) => void;
  dispatchAppCommand: (args: DispatchDesktopBrowserAppCommandArgs) => void;
  focusHostWebContents: (hostWebContentsId: number) => void;
  partition?: string;
  resolveAppCommand: (input: AppShortcutInput) => AppCommandId | null;
}

interface HostScopedRequestArgs<TRequest> {
  hostWindow: DesktopBrowserHostWindow;
  request: TRequest;
}

interface HostScopedTabArgs {
  hostWindow: DesktopBrowserHostWindow;
  tabId: string;
}

interface RegisterAutomationTargetArgs extends HostScopedTabArgs {
  targetId: string;
}

interface AutomationTargetArgs {
  hostWindow: DesktopBrowserHostWindow;
  targetId: string;
}

interface RunAutomationCommandArgs extends AutomationTargetArgs {
  command: BrowserAutomationCommand;
  navigationEpoch: number;
  timeoutMs: number;
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
  cancelAutomationCommand(args: AutomationTargetArgs): void;
  detach(args: HostScopedTabArgs): void;
  focus(args: HostScopedTabArgs): void;
  getAutomationPageState(args: AutomationTargetArgs): BrowserAutomationPageState | null;
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
  setVisibleWithoutFocus(
    args: HostScopedRequestArgs<BbDesktopBrowserSetVisibleRequest>,
  ): void;
  findInPage(
    args: HostScopedRequestArgs<BbDesktopBrowserFindInPageRequest>,
  ): void;
  stopFindInPage(
    args: HostScopedRequestArgs<BbDesktopBrowserStopFindInPageRequest>,
  ): void;
  beginWindowResize(hostWindow: DesktopBrowserHostWindow): void;
  endWindowResize(hostWindow: DesktopBrowserHostWindow): void;
  prepareWindowReload(hostWindow: DesktopBrowserHostWindow): void;
  reserveAutomationTarget(args: RegisterAutomationTargetArgs): boolean;
  registerAutomationTarget(args: RegisterAutomationTargetArgs): void;
  releaseWindow(hostWebContentsId: number): void;
  runAutomationCommand(
    args: RunAutomationCommandArgs,
  ): Promise<BrowserAutomationCommandResult>;
  unregisterAutomationTarget(args: AutomationTargetArgs): void;
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

function buildBrowserState(
  tabId: string,
  entry: BrowserViewEntry,
): BbDesktopBrowserState {
  const webContents = entry.view.webContents;
  const url = webContents.getURL();
  const rawTitle = webContents.getTitle();
  const title = rawTitle.length > 0 && rawTitle !== url ? rawTitle : null;
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

export function isAllowedBrowserPermission(permission: string): boolean {
  return permission === "clipboard-sanitized-write";
}

export function createDesktopBrowserViewManager(
  args: CreateDesktopBrowserViewManagerArgs,
): DesktopBrowserViewManager {
  const partition = args.partition ?? BB_BROWSER_PARTITION;
  const entries = new Map<string, BrowserViewEntry>();
  const entriesByWebContentsId = new Map<number, BrowserViewEntry>();
  const automation = new DesktopBrowserAutomationDriver();
  const automationReservations = new Map<string, { createdAt: number; targetId: string }>();
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
    entry.view.setVisible(
      entry.visible &&
        entry.rendererRecoveryState === "healthy" &&
        !isHostResizing(hostWindow),
    );
  }

  function clearEntryRendererRecoveryTimer(entry: BrowserViewEntry): void {
    if (entry.rendererRecoveryTimer !== null) {
      clearTimeout(entry.rendererRecoveryTimer);
      entry.rendererRecoveryTimer = null;
    }
  }

  function resetEntryRendererRecovery(entry: BrowserViewEntry): void {
    clearEntryRendererRecoveryTimer(entry);
    entry.rendererRecoveryAttempts = 0;
    entry.rendererRecoveryState = "healthy";
  }

  function scheduleEntryRendererRecovery(
    entry: BrowserViewEntry,
    hostWindow: DesktopBrowserHostWindow,
    tabId: string,
  ): void {
    if (
      entry.rendererRecoveryState !== "pending" ||
      !entry.visible ||
      entry.rendererRecoveryTimer !== null
    ) {
      return;
    }
    if (entry.rendererRecoveryAttempts >= RENDERER_RECOVERY_MAX_ATTEMPTS) {
      entry.rendererRecoveryState = "blocked";
      entry.lastErrorText = "The page renderer stopped repeatedly";
      pushState(hostWindow, tabId);
      return;
    }
    entry.rendererRecoveryTimer = setTimeout(() => {
      entry.rendererRecoveryTimer = null;
      const webContents = entry.view.webContents;
      if (
        webContents.isDestroyed() ||
        entry.rendererRecoveryState !== "pending" ||
        !entry.visible
      ) {
        return;
      }
      entry.rendererRecoveryAttempts += 1;
      entry.rendererRecoveryState = "healthy";
      entry.lastErrorText = null;
      webContents.reload();
      applyEntryVisibility(entry, hostWindow);
    }, RENDERER_RECOVERY_DELAY_MS);
  }

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
      .catch(() => {})
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
    browserSession.setPermissionRequestHandler((_wc, permission, callback) => {
      callback(isAllowedBrowserPermission(permission));
    });
    browserSession.setPermissionCheckHandler((_wc, permission) =>
      isAllowedBrowserPermission(permission),
    );
    browserSession.on("will-download", (event) => {
      event.preventDefault();
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

    webContents.on("focus", () => {
      if (entry.suppressNextFocusNotification) {
        entry.suppressNextFocusNotification = false;
        return;
      }
      send(hostWindow, BB_DESKTOP_BROWSER_FOCUSED_CHANNEL, { tabId });
    });

    webContents.on("before-input-event", (event, input) => {
      if (input.type !== "keyDown" || input.isAutoRepeat || input.isComposing) {
        return;
      }
      const command = args.resolveAppCommand({
        altKey: input.alt,
        code: input.code,
        ctrlKey: input.control,
        key: input.key,
        metaKey: input.meta,
        shiftKey: input.shift,
      });
      if (command === null) return;
      event.preventDefault();
      if (command === "browser.focusLocation" || command === "browser.find") {
        args.focusHostWebContents(hostWindow.webContents.id);
      }
      args.dispatchAppCommand({
        command,
        hostWebContentsId: hostWindow.webContents.id,
      });
    });

    webContents.on("will-frame-navigate", (event) => {
      if (!event.isMainFrame) {
        return;
      }
      if (!isAllowedBrowserUrl(event.url)) {
        event.preventDefault();
      }
    });
    webContents.on("will-navigate", (event, url) => {
      if (!isAllowedBrowserUrl(url)) {
        event.preventDefault();
      }
    });
    webContents.on("will-redirect", (event, url, _isInPlace, isMainFrame) => {
      if (!isMainFrame) {
        return;
      }
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
          send(hostWindow, BB_DESKTOP_BROWSER_SCOPED_OPEN_TAB_CHANNEL, {
            tabId,
            url: openTabUrl,
          });
        }
      }
      return { action: "deny" };
    });

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

    webContents.on("found-in-page", (_event, result) => {
      if (result.requestId !== entry.activeFindRequestId) {
        return;
      }
      send(hostWindow, BB_DESKTOP_BROWSER_FIND_RESULT_CHANNEL, {
        tabId,
        requestId: result.requestId,
        activeMatchOrdinal: result.activeMatchOrdinal,
        matches: result.matches,
        finalUpdate: result.finalUpdate,
      });
    });

    webContents.on("render-process-gone", (_event, details) => {
      if (webContents.isDestroyed() || webContents.getURL().length === 0) {
        return;
      }
      clearEntryRendererRecoveryTimer(entry);
      entry.rendererRecoveryState = "blocked";
      if (
        details.reason === "launch-failed" ||
        details.reason === "integrity-failure"
      ) {
        entry.lastErrorText = "The page renderer could not start";
        applyEntryVisibility(entry, hostWindow);
        pushState(hostWindow, tabId);
        return;
      }
      entry.rendererRecoveryState = "pending";
      entry.lastErrorText = null;
      applyEntryVisibility(entry, hostWindow);
      scheduleEntryRendererRecovery(entry, hostWindow, tabId);
    });

    const refresh = () => pushState(hostWindow, tabId);
    webContents.on("did-finish-load", () => {
      resetEntryRendererRecovery(entry);
      applyEntryVisibility(entry, hostWindow);
      refresh();
    });
    webContents.on("did-start-loading", refresh);
    webContents.on("did-stop-loading", refresh);
    webContents.on("did-navigate", () => {
      entry.lastErrorText = null;
      automation.didNavigate(webContents);
      refresh();
    });
    webContents.on("did-navigate-in-page", (_event, _url, isMainFrame) => {
      if (!isMainFrame) return;
      automation.didNavigate(webContents);
      refresh();
    });
    webContents.on("did-start-navigation", (_event, _url, _isInPlace, isMainFrame) => {
      if (!isMainFrame) return;
      entry.lastErrorText = null;
      automation.didStartNavigation(webContents);
      refresh();
    });
    webContents.on("page-title-updated", refresh);
    webContents.on(
      "did-fail-load",
      (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
        if (!isMainFrame || errorCode === ERR_ABORTED) {
          return;
        }
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
      },
    });
    const reservationKey = browserViewKey(args.hostWindow, args.tabId);
    const reservation = automationReservations.get(reservationKey);
    const validReservation = reservation !== undefined && Date.now() - reservation.createdAt <= AUTOMATION_RESERVATION_TTL_MS
      ? reservation
      : null;
    if (reservation !== undefined && validReservation === null) automationReservations.delete(reservationKey);
    const entry: BrowserViewEntry = {
      automationReservationTargetId: validReservation?.targetId ?? null,
      view,
      lastErrorText: null,
      desiredBounds: args.desiredBounds,
      popupTimestamps: [],
      rendererRecoveryAttempts: 0,
      rendererRecoveryState: "healthy",
      rendererRecoveryTimer: null,
      suppressNextFocusNotification: false,
      visible: false,
      activeFindRequestId: null,
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
    if (!isAllowedBrowserUrl(url)) {
      return;
    }
    entry.lastErrorText = null;
    entry.view.webContents.loadURL(url).catch(() => {});
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
    automationReservations.delete(key);
    entriesByWebContentsId.delete(entry.view.webContents.id);
    automation.unregisterWebContents(entry.view.webContents);
    clearEntryRendererRecoveryTimer(entry);
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

  function hasOtherVisibleEntry(
    hostWindow: DesktopBrowserHostWindow,
    tabId: string,
  ): boolean {
    const hostPrefix = `${hostWindow.webContents.id}:`;
    const currentKey = browserViewKey(hostWindow, tabId);
    for (const [key, entry] of entries) {
      if (key !== currentKey && key.startsWith(hostPrefix) && entry.visible) {
        return true;
      }
    }
    return false;
  }

  function focusEntryWithoutNotifying(entry: BrowserViewEntry): void {
    entry.suppressNextFocusNotification = true;
    entry.view.webContents.focus();
    setTimeout(() => {
      entry.suppressNextFocusNotification = false;
    }, 0);
  }

  function setEntryVisibility(
    {
      hostWindow,
      request,
    }: HostScopedRequestArgs<BbDesktopBrowserSetVisibleRequest>,
    focusOnShow: boolean,
  ): void {
    withEntry({ hostWindow, tabId: request.tabId }, (entry) => {
      const wasVisible = entry.visible;
      entry.visible = request.visible;
      applyEntryVisibility(entry, hostWindow);
      scheduleEntryRendererRecovery(entry, hostWindow, request.tabId);
      if (
        focusOnShow &&
        request.visible &&
        !wasVisible &&
        !hasOtherVisibleEntry(hostWindow, request.tabId) &&
        !entry.view.webContents.isDestroyed()
      ) {
        focusEntryWithoutNotifying(entry);
      }
    });
  }

  return {
    attach({ hostWindow, request }) {
      const key = browserViewKey(hostWindow, request.tabId);
      const existing = entries.get(key) ?? null;
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
      if (
        request.visible &&
        !wasVisible &&
        !hasOtherVisibleEntry(hostWindow, request.tabId) &&
        !entry.view.webContents.isDestroyed()
      ) {
        focusEntryWithoutNotifying(entry);
      }
      loadIfNeeded(entry, request.url);
      pushState(hostWindow, request.tabId);
    },
    cancelAutomationCommand({ hostWindow, targetId }) {
      automation.cancel(targetId, hostWindow.webContents.id);
    },
    detach({ hostWindow, tabId }) {
      destroyEntry(hostWindow, browserViewKey(hostWindow, tabId));
    },
    focus({ hostWindow, tabId }) {
      withEntry({ hostWindow, tabId }, focusEntryWithoutNotifying);
    },
    getAutomationPageState({ hostWindow, targetId }) {
      return automation.getPageState(targetId, hostWindow.webContents.id);
    },
    navigate({ hostWindow, request }) {
      withEntry({ hostWindow, tabId: request.tabId }, (entry) => {
        resetEntryRendererRecovery(entry);
        applyEntryVisibility(entry, hostWindow);
        loadIfNeeded(entry, request.url);
      });
    },
    goBack({ hostWindow, tabId }) {
      withEntry({ hostWindow, tabId }, (entry) => {
        if (entry.view.webContents.navigationHistory.canGoBack()) {
          resetEntryRendererRecovery(entry);
          applyEntryVisibility(entry, hostWindow);
          entry.view.webContents.navigationHistory.goBack();
        }
      });
    },
    goForward({ hostWindow, tabId }) {
      withEntry({ hostWindow, tabId }, (entry) => {
        if (entry.view.webContents.navigationHistory.canGoForward()) {
          resetEntryRendererRecovery(entry);
          applyEntryVisibility(entry, hostWindow);
          entry.view.webContents.navigationHistory.goForward();
        }
      });
    },
    reload({ hostWindow, tabId }) {
      withEntry({ hostWindow, tabId }, (entry) => {
        resetEntryRendererRecovery(entry);
        entry.view.webContents.reload();
        applyEntryVisibility(entry, hostWindow);
      });
    },
    stop({ hostWindow, tabId }) {
      withEntry({ hostWindow, tabId }, (entry) => {
        entry.view.webContents.stop();
      });
    },
    setBounds({ hostWindow, request }) {
      withEntry({ hostWindow, tabId: request.tabId }, (entry) => {
        setEntryDesiredBounds({ bounds: request.bounds, entry, hostWindow });
      });
    },
    findInPage({ hostWindow, request }) {
      withEntry({ hostWindow, tabId: request.tabId }, (entry) => {
        entry.activeFindRequestId = entry.view.webContents.findInPage(
          request.text,
          {
            forward: request.forward,
            findNext: request.newSession,
          },
        );
      });
    },
    stopFindInPage({ hostWindow, request }) {
      withEntry({ hostWindow, tabId: request.tabId }, (entry) => {
        entry.activeFindRequestId = null;
        entry.view.webContents.stopFindInPage(request.action);
      });
    },
    setVisible({ hostWindow, request }) {
      setEntryVisibility({ hostWindow, request }, true);
    },
    setVisibleWithoutFocus({ hostWindow, request }) {
      setEntryVisibility({ hostWindow, request }, false);
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
    prepareWindowReload(hostWindow) {
      resizingHostIds.delete(hostWindow.webContents.id);
      const prefix = `${hostWindow.webContents.id}:`;
      for (const [key, entry] of entries.entries()) {
        if (!key.startsWith(prefix) || entry.view.webContents.isDestroyed()) {
          continue;
        }
        entry.visible = false;
        applyEntryVisibility(entry, hostWindow);
      }
    },
    reserveAutomationTarget({ hostWindow, tabId, targetId }) {
      const key = browserViewKey(hostWindow, tabId);
      if (entries.has(key) || automationReservations.has(key)) return false;
      const prefix = `${hostWindow.webContents.id}:`;
      let reservations = 0;
      for (const [reservationKey, reservation] of [...automationReservations]) {
        if (Date.now() - reservation.createdAt > AUTOMATION_RESERVATION_TTL_MS) {
          automationReservations.delete(reservationKey);
        } else if (reservationKey.startsWith(prefix)) {
          reservations += 1;
        }
      }
      if (reservations >= MAX_AUTOMATION_RESERVATIONS_PER_WINDOW) return false;
      automationReservations.set(key, { createdAt: Date.now(), targetId });
      return true;
    },
    registerAutomationTarget({ hostWindow, tabId, targetId }) {
      const key = browserViewKey(hostWindow, tabId);
      const entry = entries.get(key);
      if (
        entry === undefined ||
        entry.view.webContents.isDestroyed() ||
        entry.automationReservationTargetId !== targetId
      ) {
        throw new Error("Browser automation tab is unavailable");
      }
      entry.automationReservationTargetId = null;
      automationReservations.delete(key);
      automation.register({
        activate: () => {
          args.activateHostWindow(hostWindow.webContents.id);
          focusEntryWithoutNotifying(entry);
        },
        hostWebContentsId: hostWindow.webContents.id,
        tabId,
        targetId,
        webContents: entry.view.webContents,
      });
    },
    releaseWindow(hostWebContentsId) {
      resizingHostIds.delete(hostWebContentsId);
      const prefix = `${hostWebContentsId}:`;
      for (const key of [...automationReservations.keys()]) {
        if (key.startsWith(prefix)) automationReservations.delete(key);
      }
      for (const [key, entry] of [...entries.entries()]) {
        if (!key.startsWith(prefix)) {
          continue;
        }
        entries.delete(key);
        entriesByWebContentsId.delete(entry.view.webContents.id);
        automation.unregisterWebContents(entry.view.webContents);
        clearEntryRendererRecoveryTimer(entry);
        if (!entry.view.webContents.isDestroyed()) {
          entry.view.webContents.close();
        }
      }
    },
    runAutomationCommand({
      hostWindow,
      targetId,
      command,
      navigationEpoch,
      timeoutMs,
    }) {
      return automation.run(
        targetId,
        command,
        hostWindow.webContents.id,
        navigationEpoch,
        timeoutMs,
      );
    },
    unregisterAutomationTarget({ hostWindow, targetId }) {
      automation.unregister(targetId, hostWindow.webContents.id);
    },
    destroyAll() {
      resizingHostIds.clear();
      automationReservations.clear();
      automation.destroy();
      for (const [key, entry] of [...entries.entries()]) {
        entries.delete(key);
        entriesByWebContentsId.delete(entry.view.webContents.id);
        clearEntryRendererRecoveryTimer(entry);
        if (!entry.view.webContents.isDestroyed()) {
          entry.view.webContents.close();
        }
      }
    },
  };
}
