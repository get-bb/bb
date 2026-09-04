import { randomUUID } from "node:crypto";
import {
  app,
  BrowserWindow,
  Menu,
  WebContentsView,
  session,
  type BrowserWindowConstructorOptions,
  type Cookie,
  type Session,
  type WebContents,
  type WebPreferences,
} from "electron";
import {
  BB_DESKTOP_BROWSER_MAX_TITLE_LENGTH,
  BB_DESKTOP_BROWSER_MAX_URL_LENGTH,
  clampBbDesktopBrowserViewBounds,
  type BbDesktopBrowserAutomationRequest,
  type BbDesktopBrowserAutomationResult,
  type BbDesktopBrowserAttachRequest,
  type BbDesktopBrowserCloseRequest,
  type BbDesktopBrowserCloseResult,
  type BbDesktopBrowserFindInPageRequest,
  type BbDesktopBrowserFindResult,
  type BbDesktopBrowserImportCookiesFromBrowserRequest,
  type BbDesktopBrowserImportCookiesRequest,
  type BbDesktopBrowserImportCookiesResult,
  type BbDesktopBrowserListCookieImportSourcesRequest,
  type BbDesktopBrowserListCookieImportSourcesResult,
  type BbDesktopBrowserNavigateRequest,
  type BbDesktopBrowserOpenTabRequest,
  type BbDesktopBrowserPageCaptureRequest,
  type BbDesktopBrowserPageCaptureResult,
  type BbDesktopBrowserPageScriptRequest,
  type BbDesktopBrowserPageScriptResult,
  type BbDesktopBrowserListFramesRequest,
  type BbDesktopBrowserListFramesResult,
  type BbDesktopBrowserTrustedInputRequest,
  type BbDesktopBrowserTrustedInputResult,
  type BbDesktopBrowserWaitRequest,
  type BbDesktopBrowserWaitResult,
  type BbDesktopBrowserJsonValue,
  type BbDesktopBrowserPointerInputRequest,
  type BbDesktopBrowserPointerInputResult,
  type BbDesktopBrowserSetViewportProfileRequest,
  type BbDesktopBrowserClearViewportProfileRequest,
  type BbDesktopBrowserViewportProfile,
  type BbDesktopBrowserViewportProfileResult,
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
  startDesktopBrowserPageScript,
  type DesktopBrowserPageScriptSession,
} from "./desktop-browser-page-runtime.js";
import {
  evaluatePopupRate,
  isAllowedBrowserUrl,
} from "./desktop-browser-policy.js";
import {
  importCookiesFromBrowserSource,
  listBrowserCookieImportSources,
} from "./desktop-browser-cookie-import.js";

const POPUP_RATE_WINDOW_MS = 10_000;
const POPUP_RATE_MAX_IN_WINDOW = 3;
const POPUP_MAX_OPEN_PER_TAB = 3;
const POPUP_MAX_OPEN_GLOBAL = 8;
const POPUP_DEFAULT_WIDTH = 520;
const POPUP_DEFAULT_HEIGHT = 700;
const POPUP_MIN_WIDTH = 320;
const POPUP_MIN_HEIGHT = 240;
const POPUP_MAX_WIDTH = 960;
const POPUP_MAX_HEIGHT = 900;

const RESIZE_SNAPSHOT_HIDE_CAP_MS = 80;
const RESIZE_SNAPSHOT_JPEG_QUALITY = 70;
const RENDERER_RECOVERY_DELAY_MS = 250;
const RENDERER_RECOVERY_MAX_ATTEMPTS = 2;

function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const COOKIE_IMPORT_BATCH_SIZE = 250;

type BrowserCookieSetDetails = Parameters<Session["cookies"]["set"]>[0];

function importedCookieToSessionDetails(
  cookie: BbDesktopBrowserImportCookiesRequest["cookies"][number],
): BrowserCookieSetDetails | null {
  const isHostPrefixed = cookie.name.startsWith("__Host-");
  const isSecurePrefixed = cookie.name.startsWith("__Secure-");
  const isHttpPrefixed =
    cookie.name.startsWith("__Http-") || cookie.name.startsWith("__Host-Http-");
  if (
    (isHostPrefixed &&
      (!cookie.secure ||
        cookie.path !== "/" ||
        cookie.domain.startsWith("."))) ||
    (isSecurePrefixed && !cookie.secure) ||
    (isHttpPrefixed && (!cookie.secure || !cookie.httpOnly))
  ) {
    return null;
  }
  const host = cookie.domain.startsWith(".")
    ? cookie.domain.slice(1)
    : cookie.domain;
  return {
    ...(cookie.domain.startsWith(".") ? { domain: host } : {}),
    ...(cookie.expirationDate === null
      ? {}
      : { expirationDate: cookie.expirationDate }),
    httpOnly: cookie.httpOnly,
    name: cookie.name,
    path: cookie.path,
    sameSite: cookie.sameSite,
    secure: cookie.secure,
    url: `https://${host}${cookie.path}`,
    value: cookie.value,
  };
}

function cookieRemovalUrl(cookie: Cookie): string | null {
  const domain = cookie.domain?.replace(/^\./, "");
  if (domain === undefined || domain.length === 0) return null;
  try {
    return new URL(
      `${cookie.secure === true ? "https" : "http"}://${domain}${cookie.path ?? "/"}`,
    ).toString();
  } catch {
    return null;
  }
}

async function clearSessionCookies(browserSession: Session): Promise<void> {
  const cookies = await browserSession.cookies.get({});
  await Promise.all(
    cookies.flatMap((cookie) => {
      const url = cookieRemovalUrl(cookie);
      return url === null ? [] : [browserSession.cookies.remove(url, cookie.name)];
    }),
  );
  await browserSession.clearStorageData({ storages: ["cookies"] });
}

async function importCookiesIntoSession(
  browserSession: Session,
  cookies: readonly BbDesktopBrowserImportCookiesRequest["cookies"][number][],
): Promise<number> {
  const cookieDetailsByKey = new Map<string, BrowserCookieSetDetails>();
  for (const cookie of cookies) {
    const details = importedCookieToSessionDetails(cookie);
    if (details === null) continue;
    const key = `${details.domain ?? "\0"}\0${details.name ?? ""}\0${details.path ?? "/"}`;
    if (!cookieDetailsByKey.has(key)) {
      cookieDetailsByKey.set(key, details);
    }
  }
  const cookieDetails = [...cookieDetailsByKey.values()];
  await clearSessionCookies(browserSession);
  for (
    let offset = 0;
    offset < cookieDetails.length;
    offset += COOKIE_IMPORT_BATCH_SIZE
  ) {
    await Promise.all(
      cookieDetails
        .slice(offset, offset + COOKIE_IMPORT_BATCH_SIZE)
        .map((cookie) => browserSession.cookies.set(cookie)),
    );
  }
  return cookieDetails.length;
}


function viewportParameters(profile: BbDesktopBrowserViewportProfile) {
  switch (profile) {
    case "phone-390x844":
      return {
        screenPosition: "mobile" as const,
        screenSize: { width: 390, height: 844 },
        viewPosition: { x: 0, y: 0 },
        deviceScaleFactor: 3,
        viewSize: { width: 390, height: 844 },
        scale: 1,
      };
    case "tablet-768x1024":
      return {
        screenPosition: "mobile" as const,
        screenSize: { width: 768, height: 1024 },
        viewPosition: { x: 0, y: 0 },
        deviceScaleFactor: 2,
        viewSize: { width: 768, height: 1024 },
        scale: 1,
      };
    case "desktop-1280x720":
      return {
        screenPosition: "desktop" as const,
        screenSize: { width: 1280, height: 720 },
        viewPosition: { x: 0, y: 0 },
        deviceScaleFactor: 1,
        viewSize: { width: 1280, height: 720 },
        scale: 1,
      };
  }
}

function clampPopupDimension(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.round(value)));
}

function isLoopbackHostname(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "[::1]" ||
    /^127(?:\.\d{1,3}){3}$/.test(hostname)
  );
}

function isAllowedPopupNavigationUrl(url: string): boolean {
  if (url === "about:blank") {
    return true;
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return (
    parsed.protocol === "https:" ||
    (parsed.protocol === "http:" && isLoopbackHostname(parsed.hostname))
  );
}

function popupWindowTitle(url: string | null): string {
  if (url === null || url === "about:blank" || url.length === 0) {
    return "bb browser popup";
  }
  try {
    return `bb browser — ${new URL(url).origin}`;
  } catch {
    return "bb browser popup";
  }
}

type PopupCreateWindowOptions = BrowserWindowConstructorOptions & {
  webContents?: WebContents;
};

function guardMainFrameNavigation(
  webContents: WebContents,
  isAllowedUrl: (url: string) => boolean,
): void {
  webContents.on("will-frame-navigate", (event) => {
    if (event.isMainFrame && !isAllowedUrl(event.url)) {
      event.preventDefault();
    }
  });
  webContents.on("will-redirect", (event, url, _isInPlace, isMainFrame) => {
    if (isMainFrame && !isAllowedUrl(url)) {
      event.preventDefault();
    }
  });
}

const BB_BROWSER_PARTITION = "persist:bb-browser";

const ERR_ABORTED = -3;
const BROWSER_DIAGNOSTIC_LIMIT = 100;
const BROWSER_CAPTURE_MAX_DIMENSION = 32_768;
const BROWSER_CAPTURE_MAX_PIXELS = 50_000_000;

interface BrowserDialogHandler {
  behavior: "accept" | "dismiss";
  promptText?: string;
}

interface BrowserDiagnostics {
  console: BbDesktopBrowserJsonValue[];
  dialogs: BbDesktopBrowserJsonValue[];
  downloads: BbDesktopBrowserJsonValue[];
  network: BbDesktopBrowserJsonValue[];
  pageErrors: BbDesktopBrowserJsonValue[];
  permissions: BbDesktopBrowserJsonValue[];
}

interface BrowserFrameRecord {
  publicFrameId: string;
  debuggerFrameId: string;
  loaderId: string | null;
  parentDebuggerFrameId: string | null;
  documentEpoch: number;
  url: string;
  name: string | null;
  depth: number;
  active: boolean;
  executionContextId: number | null;
}

interface BrowserEventWaiter {
  hostWindow: DesktopBrowserHostWindow;
  request: BbDesktopBrowserWaitRequest;
  resolve: (value: BbDesktopBrowserWaitResult) => void;
  reject: (error: Error) => void;
}

interface BrowserViewEntry {
  view: WebContentsView;
  lastErrorText: string | null;
  allowedPermissions: Set<string>;
  deniedPermissions: Set<string>;
  diagnostics: BrowserDiagnostics;
  desiredBounds: BbDesktopBrowserViewBounds;
  popupTimestamps: number[];
  popupWindows: Set<BrowserWindow>;
  rendererRecoveryAttempts: number;
  rendererRecoveryState: "healthy" | "pending" | "blocked";
  rendererRecoveryTimer: ReturnType<typeof setTimeout> | null;
  suppressNextFocusNotification: boolean;
  attached: boolean;
  visible: boolean;
  frameRegistry: Map<string, BrowserFrameRecord>;
  frameRecordsByDebuggerId: Map<string, BrowserFrameRecord>;
  eventWaiters: Map<string, BrowserEventWaiter>;
  pendingExecutionContextIdsByFrameId: Map<string, number>;
  nextFrameDocumentEpoch: number;
  activeFindRequestId: number | null;
  navigationEpoch: number;
  loadState: "none" | "domcontentloaded" | "load";
  inFlightRequests: number;
  networkIdleSince: number | null;
  networkIdleTimer: ReturnType<typeof setTimeout> | null;
  pageScriptSessions: Map<string, DesktopBrowserPageScriptSession>;
  nextDialogHandler: BrowserDialogHandler | null;
  viewportProfile: {
    generation: number;
    profile: BbDesktopBrowserViewportProfile;
  } | null;
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
  addChildView(view: WebContentsView, index?: number): void;
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
  close(
    args: HostScopedRequestArgs<BbDesktopBrowserCloseRequest>,
  ): BbDesktopBrowserCloseResult;
  focus(args: HostScopedTabArgs): void;
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
  trustLocalhostCertificate(args: HostScopedTabArgs): void;
  findInPage(
    args: HostScopedRequestArgs<BbDesktopBrowserFindInPageRequest>,
  ): void;
  stopFindInPage(
    args: HostScopedRequestArgs<BbDesktopBrowserStopFindInPageRequest>,
  ): void;
  runPageScript(
    args: HostScopedRequestArgs<BbDesktopBrowserPageScriptRequest>,
  ): Promise<BbDesktopBrowserPageScriptResult>;
  listFrames(
    args: HostScopedRequestArgs<BbDesktopBrowserListFramesRequest>,
  ): Promise<BbDesktopBrowserListFramesResult>;
  sendTrustedInput(
    args: HostScopedRequestArgs<BbDesktopBrowserTrustedInputRequest>,
  ): Promise<BbDesktopBrowserTrustedInputResult>;
  waitForBrowserEvent(
    args: HostScopedRequestArgs<BbDesktopBrowserWaitRequest>,
  ): Promise<BbDesktopBrowserWaitResult>;
  cancelBrowserEvent(
    args: HostScopedRequestArgs<{
      tabId: string;
      requestId: string;
    }>,
  ): void;
  cancelPageScript(args: HostScopedTabArgs & { requestId: string }): void;
  sendPointerInput(
    args: HostScopedRequestArgs<BbDesktopBrowserPointerInputRequest>,
  ): Promise<BbDesktopBrowserPointerInputResult>;
  setViewportProfile(
    args: HostScopedRequestArgs<BbDesktopBrowserSetViewportProfileRequest>,
  ): BbDesktopBrowserViewportProfileResult;
  clearViewportProfile(
    args: HostScopedRequestArgs<BbDesktopBrowserClearViewportProfileRequest>,
  ): void;
  capturePage(
    args: HostScopedRequestArgs<BbDesktopBrowserPageCaptureRequest>,
  ): Promise<BbDesktopBrowserPageCaptureResult>;
  runAutomation(
    args: HostScopedRequestArgs<BbDesktopBrowserAutomationRequest>,
  ): Promise<BbDesktopBrowserAutomationResult>;
  importCookies(
    args: HostScopedRequestArgs<BbDesktopBrowserImportCookiesRequest>,
  ): Promise<BbDesktopBrowserImportCookiesResult>;
  listCookieImportSources(
    args: HostScopedRequestArgs<BbDesktopBrowserListCookieImportSourcesRequest>,
  ): BbDesktopBrowserListCookieImportSourcesResult;
  importCookiesFromBrowser(
    args: HostScopedRequestArgs<BbDesktopBrowserImportCookiesFromBrowserRequest>,
  ): Promise<BbDesktopBrowserImportCookiesResult>;
  clearImportedCookies(args: HostScopedTabArgs): Promise<void>;
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
  endWindowResize(hostWindow: DesktopBrowserHostWindow): void;
  prepareWindowReload(hostWindow: DesktopBrowserHostWindow): void;
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
    navigationEpoch: entry.navigationEpoch,
  };
}

export function isAllowedBrowserPermission(permission: string): boolean {
  return permission === "clipboard-sanitized-write";
}

function getLoopbackCertificateHost(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") return null;
  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/gu, "");
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "::1"
  ) {
    return parsed.hostname;
  }
  const octets = hostname.split(".");
  if (
    octets.length !== 4 ||
    octets[0] !== "127" ||
    !octets.every((octet) => {
      if (!/^\d+$/u.test(octet)) return false;
      const value = Number(octet);
      return value >= 0 && value <= 255 && String(value) === octet;
    })
  ) {
    return null;
  }
  return parsed.hostname;
}

export function createDesktopBrowserViewManager(
  args: CreateDesktopBrowserViewManagerArgs,
): DesktopBrowserViewManager {
  const partition = args.partition ?? BB_BROWSER_PARTITION;
  const entries = new Map<string, BrowserViewEntry>();
  const entriesByWebContentsId = new Map<number, BrowserViewEntry>();
  const popupWindows = new Set<BrowserWindow>();
  const resizingHostIds = new Set<number>();
  let hardenedSession: Session | null = null;
  let viewportProfileGeneration = 0;
  let nextBrowserSessionMutation: Promise<void> = Promise.resolve();
  const trustedCertificateHosts = new Set<string>();
  function mutateBrowserSession<T>(operation: () => Promise<T>): Promise<T> {
    const result = nextBrowserSessionMutation.then(operation, operation);
    nextBrowserSessionMutation = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
  const appendDiagnostic = (
    bucket: BbDesktopBrowserJsonValue[],
    value: BbDesktopBrowserJsonValue,
  ): void => {
    bucket.push(value);
    if (bucket.length > BROWSER_DIAGNOSTIC_LIMIT) bucket.shift();
  };

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
    const shouldBeVisible =
      entry.visible &&
      entry.rendererRecoveryState === "healthy" &&
      !isHostResizing(hostWindow);
    if (!shouldBeVisible) {
      entry.view.setVisible(false);
      if (entry.attached && !hostWindow.isDestroyed()) {
        hostWindow.contentView.removeChildView(entry.view);
        entry.attached = false;
      }
      return;
    }
    if (!entry.attached) {
      hostWindow.contentView.addChildView(entry.view, 0);
      entry.attached = true;
    }
    entry.view.setVisible(true);
  }

  function clearEntryRendererRecoveryTimer(entry: BrowserViewEntry): void {
    if (entry.rendererRecoveryTimer !== null) {
      clearTimeout(entry.rendererRecoveryTimer);
      entry.rendererRecoveryTimer = null;
    }
  }

  function cancelEntryPageScripts(
    entry: BrowserViewEntry,
    reason = "cancelled",
  ): void {
    for (const session of entry.pageScriptSessions.values()) {
      session.cancel(reason);
    }
    entry.pageScriptSessions.clear();
  }

  function clearEntryViewportProfile(
    entry: BrowserViewEntry,
    generation?: number,
  ): void {
    if (
      entry.viewportProfile === null ||
      (generation !== undefined &&
        entry.viewportProfile.generation !== generation)
    ) {
      return;
    }
    entry.viewportProfile = null;
    if (!entry.view.webContents.isDestroyed()) {
      entry.view.webContents.disableDeviceEmulation();
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

  function updateNetworkIdle(entry: BrowserViewEntry): void {
    if (entry.inFlightRequests > 0) {
      entry.networkIdleSince = null;
      if (entry.networkIdleTimer !== null) {
        clearTimeout(entry.networkIdleTimer);
        entry.networkIdleTimer = null;
      }
      return;
    }
    if (entry.networkIdleSince === null) entry.networkIdleSince = Date.now();
    if (entry.networkIdleTimer !== null) return;
    entry.networkIdleTimer = setTimeout(() => {
      entry.networkIdleTimer = null;
      if (entry.inFlightRequests !== 0 || entry.networkIdleSince === null) {
        return;
      }
      settleMatchingBrowserEvents(entry, {
        kind: "load-state",
        state: "networkidle",
      });
    }, 500);
  }

  function ensureHardenedSession(): Session {
    if (hardenedSession !== null) {
      return hardenedSession;
    }
    const browserSession = session.fromPartition(partition);
    browserSession.setPermissionRequestHandler(
      (webContents, permission, callback) => {
        const entry =
          webContents === null
            ? undefined
            : entriesByWebContentsId.get(webContents.id);
        const allowed =
          entry?.deniedPermissions.has(permission) === true
            ? false
            : isAllowedBrowserPermission(permission) ||
              entry?.allowedPermissions.has(permission) === true;
        if (entry !== undefined) {
          appendDiagnostic(entry.diagnostics.permissions, {
            permission,
            decision: allowed ? "allow" : "deny",
            at: Date.now(),
          });
        }
        callback(allowed);
      },
    );
    app.on(
      "certificate-error",
      (event, webContents, url, _error, _certificate, callback) => {
        if (!entriesByWebContentsId.has(webContents.id)) {
          return;
        }
        const host = getLoopbackCertificateHost(url);
        if (host === null || !trustedCertificateHosts.has(host)) {
          return;
        }
        event.preventDefault();
        callback(true);
      },
    );
    browserSession.setPermissionCheckHandler((webContents, permission) => {
      const entry =
        webContents === null
          ? undefined
          : entriesByWebContentsId.get(webContents.id);
      return entry?.deniedPermissions.has(permission) === true
        ? false
        : isAllowedBrowserPermission(permission) ||
            entry?.allowedPermissions.has(permission) === true;
    });
    browserSession.setCertificateVerifyProc((request, callback) => {
      callback(trustedCertificateHosts.has(request.hostname) ? 0 : -3);
    });
    browserSession.on("will-download", (event, item, webContents) => {
      event.preventDefault();
      const entry = entriesByWebContentsId.get(webContents.id);
      if (entry === undefined) return;
      const url = truncate(item.getURL(), BB_DESKTOP_BROWSER_MAX_URL_LENGTH);
      appendDiagnostic(entry.diagnostics.downloads, {
        at: Date.now(),
        filename: truncate(item.getFilename(), 1_024),
        mimeType: truncate(item.getMimeType(), 256),
        url,
        blocked: true,
      });
      settleMatchingBrowserEvents(entry, {
        kind: "download-blocked",
        url,
        blocked: true,
      });
    });
    browserSession.webRequest.onBeforeRequest((details, callback) => {
      const entry =
        details.webContentsId === undefined
          ? undefined
          : entriesByWebContentsId.get(details.webContentsId);
      if (entry !== undefined) {
        entry.inFlightRequests += 1;
        updateNetworkIdle(entry);
        settleMatchingBrowserEvents(entry, {
          kind: "request",
          url: truncate(details.url, BB_DESKTOP_BROWSER_MAX_URL_LENGTH),
          method: details.method,
          phase: "start",
        });
      }
      callback({});
    });
    browserSession.webRequest.onCompleted((details) => {
      if (details.webContentsId === undefined) return;
      const entry = entriesByWebContentsId.get(details.webContentsId);
      if (entry === undefined) return;
      const url = truncate(details.url, BB_DESKTOP_BROWSER_MAX_URL_LENGTH);
      appendDiagnostic(entry.diagnostics.network, {
        at: Date.now(),
        method: details.method,
        statusCode: details.statusCode,
        url,
      });
      entry.inFlightRequests = Math.max(0, entry.inFlightRequests - 1);
      updateNetworkIdle(entry);
      settleMatchingBrowserEvents(entry, {
        kind: "response",
        url,
        method: details.method,
        status: details.statusCode,
        phase: "complete",
      });
    });
    browserSession.webRequest.onErrorOccurred((details) => {
      if (details.webContentsId === undefined) return;
      const entry = entriesByWebContentsId.get(details.webContentsId);
      if (entry === undefined) return;
      appendDiagnostic(entry.diagnostics.network, {
        at: Date.now(),
        error: truncate(details.error, 1_024),
        method: details.method,
        url: truncate(details.url, BB_DESKTOP_BROWSER_MAX_URL_LENGTH),
      });
      entry.inFlightRequests = Math.max(0, entry.inFlightRequests - 1);
      updateNetworkIdle(entry);
    });
    hardenedSession = browserSession;
    return browserSession;
  }

  async function clearBrowserSessionStorage(): Promise<void> {
    const browserSession = ensureHardenedSession();
    await browserSession.clearStorageData();
    await browserSession.clearCache();
  }

  function reloadEntriesAfterCookieChange(): void {
    for (const entry of entries.values()) {
      if (
        entry.view.webContents.isDestroyed() ||
        entry.view.webContents.getURL().length === 0
      ) {
        continue;
      }
      cancelEntryPageScripts(entry, "navigation");
      clearEntryViewportProfile(entry);
      resetEntryRendererRecovery(entry);
      entry.view.webContents.reload();
    }
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

  function invalidateFrameRecord(
    entry: BrowserViewEntry,
    debuggerFrameId: string,
  ): void {
    const record = entry.frameRecordsByDebuggerId.get(debuggerFrameId);
    if (record === undefined) return;
    for (const child of entry.frameRecordsByDebuggerId.values()) {
      if (child.parentDebuggerFrameId === debuggerFrameId) {
        invalidateFrameRecord(entry, child.debuggerFrameId);
      }
    }
    record.active = false;
    entry.frameRegistry.delete(record.publicFrameId);
    entry.frameRecordsByDebuggerId.delete(debuggerFrameId);
  }

  function invalidateAllFrames(entry: BrowserViewEntry): void {
    for (const record of entry.frameRecordsByDebuggerId.values()) {
      record.active = false;
    }
    entry.frameRegistry.clear();
    entry.frameRecordsByDebuggerId.clear();
  }

  function frameRecordFor(
    entry: BrowserViewEntry,
    frame: { frameId: string; documentEpoch: number },
  ): BrowserFrameRecord {
    const record = entry.frameRegistry.get(frame.frameId);
    if (
      record === undefined ||
      !record.active ||
      record.documentEpoch !== frame.documentEpoch ||
      entry.frameRecordsByDebuggerId.get(record.debuggerFrameId) !== record
    ) {
      throw new Error("The Browser frame target changed");
    }
    return record;
  }
  async function frameViewportOffset(
    entry: BrowserViewEntry,
    frame: { frameId: string; documentEpoch: number },
  ): Promise<{ x: number; y: number }> {
    let record = frameRecordFor(entry, frame);
    let x = 0;
    let y = 0;
    const browserDebugger = entry.view.webContents.debugger;
    if (!browserDebugger.isAttached()) browserDebugger.attach("1.3");
    await browserDebugger.sendCommand("DOM.enable");
    while (record.parentDebuggerFrameId !== null) {
      const owner = await browserDebugger.sendCommand("DOM.getFrameOwner", {
        frameId: record.debuggerFrameId,
      });
      const backendNodeId = isObject(owner)
        ? Object.getOwnPropertyDescriptor(owner, "backendNodeId")?.value
        : undefined;
      if (
        typeof backendNodeId !== "number" ||
        !Number.isFinite(backendNodeId)
      ) {
        throw new Error("The Browser frame owner is unavailable");
      }
      const box = await browserDebugger.sendCommand("DOM.getBoxModel", {
        backendNodeId,
      });
      const model = isObject(box)
        ? Object.getOwnPropertyDescriptor(box, "model")?.value
        : undefined;
      const content = isObject(model)
        ? Object.getOwnPropertyDescriptor(model, "content")?.value
        : undefined;
      if (
        !Array.isArray(content) ||
        content.length < 2 ||
        typeof content[0] !== "number" ||
        typeof content[1] !== "number" ||
        !Number.isFinite(content[0]) ||
        !Number.isFinite(content[1])
      ) {
        throw new Error("The Browser frame owner geometry is unavailable");
      }
      x += content[0];
      y += content[1];
      const parent = entry.frameRecordsByDebuggerId.get(
        record.parentDebuggerFrameId,
      );
      if (parent === undefined) {
        throw new Error("The Browser frame target changed");
      }
      record = parent;
    }
    frameRecordFor(entry, frame);
    return { x, y };
  }

  async function listFramesForEntry(
    entry: BrowserViewEntry,
    request: BbDesktopBrowserListFramesRequest,
  ): Promise<BbDesktopBrowserListFramesResult> {
    if (entry.navigationEpoch !== request.expectedNavigationEpoch) {
      throw new Error("The Browser page changed before frame discovery");
    }
    const browserDebugger = entry.view.webContents.debugger;
    if (!browserDebugger.isAttached()) browserDebugger.attach("1.3");
    const raw = await browserDebugger.sendCommand("Page.getFrameTree");
    if (
      typeof raw !== "object" ||
      raw === null ||
      Array.isArray(raw) ||
      typeof Object.getOwnPropertyDescriptor(raw, "frameTree")?.value !==
        "object"
    ) {
      throw new Error("Browser frame discovery returned an invalid tree");
    }
    const frames: BbDesktopBrowserListFramesResult["frames"] = [];
    const visit = (
      node: unknown,
      parentDebuggerFrameId: string | null,
      depth: number,
    ): void => {
      if (frames.length >= request.maxFrames || depth > 8) return;
      if (typeof node !== "object" || node === null || Array.isArray(node)) {
        return;
      }
      const frameValue = Object.getOwnPropertyDescriptor(node, "frame")?.value;
      if (
        typeof frameValue !== "object" ||
        frameValue === null ||
        Array.isArray(frameValue)
      ) {
        return;
      }
      const debuggerFrameId = Object.getOwnPropertyDescriptor(
        frameValue,
        "id",
      )?.value;
      if (
        typeof debuggerFrameId !== "string" ||
        debuggerFrameId.length === 0
      ) {
        return;
      }
      const loaderIdValue = Object.getOwnPropertyDescriptor(
        frameValue,
        "loaderId",
      )?.value;
      const loaderId =
        typeof loaderIdValue === "string" ? loaderIdValue : null;
      const urlValue = Object.getOwnPropertyDescriptor(frameValue, "url")?.value;
      const nameValue = Object.getOwnPropertyDescriptor(
        frameValue,
        "name",
      )?.value;
      let record = entry.frameRecordsByDebuggerId.get(debuggerFrameId);
      if (record !== undefined && record.loaderId !== loaderId) {
        invalidateFrameRecord(entry, debuggerFrameId);
        record = undefined;
      }
      if (record === undefined) {
        record = {
          publicFrameId: randomUUID(),
          debuggerFrameId,
          loaderId,
          parentDebuggerFrameId,
          documentEpoch: entry.nextFrameDocumentEpoch++,
          url: typeof urlValue === "string" ? truncate(urlValue, 4_096) : "",
          name: typeof nameValue === "string" ? truncate(nameValue, 256) : null,
          depth,
          active: true,
          executionContextId:
            entry.pendingExecutionContextIdsByFrameId.get(debuggerFrameId) ??
            null,
        };
        if (depth > 0) entry.frameRegistry.set(record.publicFrameId, record);
        entry.frameRecordsByDebuggerId.set(debuggerFrameId, record);
      } else {
        record.url =
          typeof urlValue === "string" ? truncate(urlValue, 4_096) : "";
        record.name =
          typeof nameValue === "string" ? truncate(nameValue, 256) : null;
        record.parentDebuggerFrameId = parentDebuggerFrameId;
        record.depth = depth;
      }
      if (depth > 0) {
        const parent =
          parentDebuggerFrameId === null
            ? null
            : entry.frameRecordsByDebuggerId.get(parentDebuggerFrameId);
        frames.push({
          frameId: record.publicFrameId,
          documentEpoch: record.documentEpoch,
          parentFrameId: depth === 1 ? null : parent?.publicFrameId ?? null,
          url: record.url,
          name: record.name,
          depth: record.depth,
        });
      }
      const children = Object.getOwnPropertyDescriptor(
        node,
        "childFrames",
      )?.value;
      if (!Array.isArray(children)) return;
      for (const child of children) {
        visit(child, debuggerFrameId, depth + 1);
        if (frames.length >= request.maxFrames) return;
      }
    };
    const frameTree = Object.getOwnPropertyDescriptor(raw, "frameTree")?.value;
    visit(frameTree, null, 0);
    if (entry.navigationEpoch !== request.expectedNavigationEpoch) {
      throw new Error("The Browser page changed during frame discovery");
    }
    return { navigationEpoch: entry.navigationEpoch, frames };
  }

type BrowserWaitObservation = {
  kind:
    | "url"
    | "navigation"
    | "load-state"
    | "popup"
    | "request"
    | "response"
    | "download-blocked";
  url?: string;
  method?: string;
  status?: number;
  phase?: "start" | "commit" | "complete";
  sameDocument?: boolean;
  state?: "domcontentloaded" | "load" | "networkidle";
  blocked?: boolean;
};

function browserUrlMatches(
  url: string,
  expected: string,
  match: "exact" | "glob",
): boolean {
  if (match === "exact") return url === expected;
  const parts = expected.split("*");
  if (parts.length === 1) return url === expected;
  let offset = 0;
  for (const [index, part] of parts.entries()) {
    const found = url.indexOf(part, offset);
    if (found < offset || (index === 0 && found !== 0)) return false;
    offset = found + part.length;
  }
  return parts.at(-1) === "" || offset === url.length;
}

function browserWaitIsTransition(
  criteria: BbDesktopBrowserWaitRequest["criteria"],
): boolean {
  return (
    criteria.kind === "url" ||
    criteria.kind === "navigation" ||
    (criteria.kind === "load-state" && criteria.document === "next")
  );
}
function browserWaitMatches(
  criteria: BbDesktopBrowserWaitRequest["criteria"],
  observation: BrowserWaitObservation,
): boolean {
  if (criteria.kind === "url") {
    return (
      observation.url !== undefined &&
      browserUrlMatches(observation.url, criteria.url, criteria.match)
    );
  }
  if (criteria.kind === "navigation") {
    return (
      observation.kind === "navigation" &&
      observation.phase === criteria.phase &&
      observation.sameDocument === criteria.sameDocument
    );
  }
  if (criteria.kind === "load-state") {
    return (
      observation.kind === "load-state" &&
      observation.state === criteria.state
    );
  }
  if (criteria.kind === "popup") return observation.kind === "popup";
  if (criteria.kind === "request" || criteria.kind === "response") {
    return (
      observation.kind === criteria.kind &&
      observation.url !== undefined &&
      browserUrlMatches(observation.url, criteria.url, criteria.match) &&
      (criteria.method === undefined || observation.method === criteria.method) &&
      (criteria.kind === "request" ||
        criteria.status === undefined ||
        observation.status === criteria.status)
    );
  }
  if (criteria.kind === "download-blocked") {
    return observation.kind === "download-blocked" && observation.blocked === true;
  }
  return false;
}

function settleMatchingBrowserEvents(
  entry: BrowserViewEntry,
  observation: BrowserWaitObservation,
): void {
  for (const [requestId, waiter] of entry.eventWaiters) {
    if (!browserWaitMatches(waiter.request.criteria, observation)) continue;
    entry.eventWaiters.delete(requestId);
    waiter.resolve({
      requestId,
      navigationEpoch: entry.navigationEpoch,
      value: observation,
    });
  }
}

function rejectBrowserEventWaiters(
  entry: BrowserViewEntry,
  predicate: (waiter: BrowserEventWaiter) => boolean,
  error: Error,
): void {
  for (const [requestId, waiter] of entry.eventWaiters) {
    if (!predicate(waiter)) continue;
    entry.eventWaiters.delete(requestId);
    waiter.reject(error);
  }
}


  const hardenedWebPreferences: WebPreferences = {
    partition,
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
    webSecurity: true,
    allowRunningInsecureContent: false,
  };

  function createPopupWindow(
    options: PopupCreateWindowOptions,
    url: string,
    entry: BrowserViewEntry,
  ): WebContents {
    const popupOptions: PopupCreateWindowOptions = {
      center: true,
      frame: true,
      height: clampPopupDimension(
        options.height,
        POPUP_DEFAULT_HEIGHT,
        POPUP_MIN_HEIGHT,
        POPUP_MAX_HEIGHT,
      ),
      show: true,
      transparent: false,
      webContents: options.webContents,
      webPreferences: hardenedWebPreferences,
      width: clampPopupDimension(
        options.width,
        POPUP_DEFAULT_WIDTH,
        POPUP_MIN_WIDTH,
        POPUP_MAX_WIDTH,
      ),
    };
    const popupWindow = new BrowserWindow(popupOptions);
    popupWindows.add(popupWindow);
    entry.popupWindows.add(popupWindow);
    popupWindow.once("closed", () => {
      popupWindows.delete(popupWindow);
      entry.popupWindows.delete(popupWindow);
    });
    const popupContents = popupWindow.webContents;
    const updatePopupTitle = (currentUrl: string | null): void => {
      if (!popupWindow.isDestroyed()) {
        popupWindow.setTitle(popupWindowTitle(currentUrl));
      }
    };
    updatePopupTitle(popupContents.getURL());
    guardMainFrameNavigation(popupContents, isAllowedPopupNavigationUrl);
    popupContents.on("did-navigate", (_event, currentUrl) => {
      updatePopupTitle(currentUrl);
    });
    popupContents.on("page-title-updated", (event) => {
      event.preventDefault();
      updatePopupTitle(popupContents.getURL());
    });
    popupContents.setWindowOpenHandler(() => ({ action: "deny" }));
    if (options.webContents === undefined) {
      void popupWindow.loadURL(url);
    }
    return popupContents;
  }
  function wireWebContents(
    hostWindow: DesktopBrowserHostWindow,
    tabId: string,
    entry: BrowserViewEntry,
  ): void {
    const webContents = entry.view.webContents;
    webContents.on(
      "console-message",
      (_event, level, message, line, sourceId) => {
        appendDiagnostic(entry.diagnostics.console, {
          at: Date.now(),
          level,
          line,
          message: truncate(message, 2_048),
          sourceId: truncate(sourceId, BB_DESKTOP_BROWSER_MAX_URL_LENGTH),
        });
      },
    );
    try {
      if (!webContents.debugger.isAttached()) {
        webContents.debugger.attach("1.3");
      }
      void webContents.debugger.sendCommand("Page.enable");
      void webContents.debugger.sendCommand("Runtime.enable");
      webContents.debugger.on("message", (_event, method, params) => {
        if (!isObject(params)) return;
        if (method === "Runtime.executionContextCreated") {
          const context = params.context;
          if (!isObject(context)) return;
          const contextId = context.id;
          const auxData = context.auxData;
          if (
            typeof contextId !== "number" ||
            !isObject(auxData) ||
            typeof auxData.frameId !== "string"
          ) {
            return;
          }
          const record = entry.frameRecordsByDebuggerId.get(auxData.frameId);
          if (record !== undefined) record.executionContextId = contextId;
          return;
        }
        if (method === "Page.frameDetached") {
          const frameId = params.frameId;
          if (typeof frameId === "string") {
            invalidateFrameRecord(entry, frameId);
          }
          return;
        }
        if (method === "Page.frameNavigated") {
          const frame = params.frame;
          if (!isObject(frame) || typeof frame.id !== "string") return;
          const record = entry.frameRecordsByDebuggerId.get(frame.id);
          if (record === undefined) return;
          const loaderIdValue = Object.getOwnPropertyDescriptor(
            frame,
            "loaderId",
          )?.value;
          const loaderId =
            typeof loaderIdValue === "string" ? loaderIdValue : null;
          if (record.loaderId === null || record.loaderId !== loaderId) {
            invalidateFrameRecord(entry, frame.id);
          }
          return;
        }
        if (method !== "Page.javascriptDialogOpening") return;
        const handler = entry.nextDialogHandler ?? { behavior: "dismiss" };
        entry.nextDialogHandler = null;
        appendDiagnostic(entry.diagnostics.dialogs, {
          at: Date.now(),
          message:
            typeof params.message === "string"
              ? truncate(params.message, 2_048)
              : "",
          type: typeof params.type === "string" ? params.type : "unknown",
          behavior: handler.behavior,
        });
        void webContents.debugger.sendCommand("Page.handleJavaScriptDialog", {
          accept: handler.behavior === "accept",
          ...(handler.promptText === undefined
            ? {}
            : { promptText: handler.promptText }),
        });
      });
    } catch (error) {
      appendDiagnostic(entry.diagnostics.pageErrors, {
        at: Date.now(),
        error: error instanceof Error ? error.message : String(error),
      });
    }

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

    guardMainFrameNavigation(webContents, isAllowedBrowserUrl);

    webContents.setWindowOpenHandler((details) => {
      const opensPopup = details.disposition === "new-window";
      const allowedUrl = opensPopup
        ? isAllowedPopupNavigationUrl(details.url)
        : isAllowedBrowserUrl(details.url);
      const popupCapReached =
        opensPopup &&
        (entry.popupWindows.size >= POPUP_MAX_OPEN_PER_TAB ||
          popupWindows.size >= POPUP_MAX_OPEN_GLOBAL);
      if (!allowedUrl || popupCapReached) {
        return { action: "deny" };
      }
      const decision = evaluatePopupRate({
        timestamps: entry.popupTimestamps,
        now: Date.now(),
        windowMs: POPUP_RATE_WINDOW_MS,
        maxInWindow: POPUP_RATE_MAX_IN_WINDOW,
      });
      entry.popupTimestamps = decision.timestamps;
      if (!decision.allowed) {
        return { action: "deny" };
      }
      settleMatchingBrowserEvents(entry, {
        kind: "popup",
        url: truncate(details.url, BB_DESKTOP_BROWSER_MAX_URL_LENGTH),
      });
      if (opensPopup) {
        return {
          action: "allow",
          createWindow: (options) =>
            createPopupWindow(options, details.url, entry),
        };
      }
      send(hostWindow, BB_DESKTOP_BROWSER_OPEN_TAB_CHANNEL, {
        url: details.url,
      });
      send(hostWindow, BB_DESKTOP_BROWSER_SCOPED_OPEN_TAB_CHANNEL, {
        tabId,
        url: details.url,
      });
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
      appendDiagnostic(entry.diagnostics.pageErrors, {
        at: Date.now(),
        error: `Renderer ${details.reason}`,
      });
      cancelEntryPageScripts(entry, "renderer-gone");
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
    webContents.on("dom-ready", () => {
      entry.loadState = "domcontentloaded";
      settleMatchingBrowserEvents(entry, {
        kind: "load-state",
        state: "domcontentloaded",
      });
      refresh();
    });
    webContents.on("did-finish-load", () => {
      resetEntryRendererRecovery(entry);
      entry.loadState = "load";
      updateNetworkIdle(entry);
      settleMatchingBrowserEvents(entry, {
        kind: "load-state",
        state: "load",
      });
      applyEntryVisibility(entry, hostWindow);
      refresh();
    });
    webContents.on("did-start-loading", () => {
      entry.loadState = "none";
      entry.networkIdleSince = null;
      refresh();
    });
    webContents.on("did-stop-loading", () => {
      updateNetworkIdle(entry);
      refresh();
    });
    webContents.on("did-navigate", (_event, url) => {
      entry.lastErrorText = null;
      settleMatchingBrowserEvents(entry, {
        kind: "navigation",
        url: truncate(url, BB_DESKTOP_BROWSER_MAX_URL_LENGTH),
        phase: "commit",
        sameDocument: false,
      });
      settleMatchingBrowserEvents(entry, {
        kind: "url",
        url: truncate(url, BB_DESKTOP_BROWSER_MAX_URL_LENGTH),
      });
      refresh();
    });
    webContents.on("did-navigate-in-page", (_event, url) => {
      settleMatchingBrowserEvents(entry, {
        kind: "navigation",
        url: truncate(url, BB_DESKTOP_BROWSER_MAX_URL_LENGTH),
        phase: "commit",
        sameDocument: true,
      });
      settleMatchingBrowserEvents(entry, {
        kind: "url",
        url: truncate(url, BB_DESKTOP_BROWSER_MAX_URL_LENGTH),
      });
      refresh();
    });
    webContents.on(
      "did-start-navigation",
      (_event, url, isInPlace, isMainFrame) => {
        if (isMainFrame) {
          if (!isInPlace) {
            clearEntryViewportProfile(entry);
            entry.navigationEpoch += 1;
            invalidateAllFrames(entry);
            cancelEntryPageScripts(entry, "navigation");
            rejectBrowserEventWaiters(
              entry,
              (waiter) => !browserWaitIsTransition(waiter.request.criteria),
              new Error("The Browser page changed during an event wait"),
            );
            entry.loadState = "none";
            entry.networkIdleSince = null;
          }
          settleMatchingBrowserEvents(entry, {
            kind: "navigation",
            url: truncate(url, BB_DESKTOP_BROWSER_MAX_URL_LENGTH),
            phase: "start",
            sameDocument: isInPlace,
          });
          settleMatchingBrowserEvents(entry, {
            kind: "url",
            url: truncate(url, BB_DESKTOP_BROWSER_MAX_URL_LENGTH),
          });
        }
        entry.lastErrorText = null;
        refresh();
      },
    );
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
        appendDiagnostic(entry.diagnostics.pageErrors, {
          at: Date.now(),
          errorCode,
          error: truncate(entry.lastErrorText, 2_048),
          url: truncate(validatedURL, BB_DESKTOP_BROWSER_MAX_URL_LENGTH),
        });
        refresh();
      },
    );
  }

  function createEntry(args: CreateEntryArgs): BrowserViewEntry {
    ensureHardenedSession();
    const view = new WebContentsView({
      webPreferences: hardenedWebPreferences,
    });
    const entry: BrowserViewEntry = {
      view,
      lastErrorText: null,
      allowedPermissions: new Set(),
      deniedPermissions: new Set(),
      diagnostics: {
        console: [],
        dialogs: [],
        downloads: [],
        network: [],
        pageErrors: [],
        permissions: [],
      },
      desiredBounds: args.desiredBounds,
      popupTimestamps: [],
      popupWindows: new Set(),
      rendererRecoveryAttempts: 0,
      rendererRecoveryState: "healthy",
      rendererRecoveryTimer: null,
      suppressNextFocusNotification: false,
      visible: false,
      attached: true,
      frameRegistry: new Map(),
      loadState: "none",
      inFlightRequests: 0,
      networkIdleSince: null,
      networkIdleTimer: null,
      frameRecordsByDebuggerId: new Map(),
      eventWaiters: new Map(),
      pendingExecutionContextIdsByFrameId: new Map(),
      nextFrameDocumentEpoch: 1,
      activeFindRequestId: null,
      navigationEpoch: 0,
      pageScriptSessions: new Map(),
      nextDialogHandler: null,
      viewportProfile: null,
    };
    wireWebContents(args.hostWindow, args.tabId, entry);
    args.hostWindow.contentView.addChildView(view, 0);
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
    entriesByWebContentsId.delete(entry.view.webContents.id);
    clearEntryRendererRecoveryTimer(entry);
    if (entry.networkIdleTimer !== null) {
      clearTimeout(entry.networkIdleTimer);
      entry.networkIdleTimer = null;
    }
    invalidateAllFrames(entry);
    for (const waiter of entry.eventWaiters.values()) {
      waiter.reject(new Error("The Browser tab was detached"));
    }
    entry.eventWaiters.clear();
    clearEntryViewportProfile(entry);
    if (!hostWindow.isDestroyed() && entry.attached) {
      hostWindow.contentView.removeChildView(entry.view);
      entry.attached = false;
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
    detach({ hostWindow, tabId }) {
      destroyEntry(hostWindow, browserViewKey(hostWindow, tabId));
    },
    focus({ hostWindow, tabId }) {
      withEntry({ hostWindow, tabId }, focusEntryWithoutNotifying);
    },
    navigate({ hostWindow, request }) {
      withEntry({ hostWindow, tabId: request.tabId }, (entry) => {
        cancelEntryPageScripts(entry, "navigation");
        clearEntryViewportProfile(entry);
        resetEntryRendererRecovery(entry);
        applyEntryVisibility(entry, hostWindow);
        loadIfNeeded(entry, request.url);
      });
    },
    goBack({ hostWindow, tabId }) {
      withEntry({ hostWindow, tabId }, (entry) => {
        if (entry.view.webContents.navigationHistory.canGoBack()) {
          cancelEntryPageScripts(entry, "navigation");
          clearEntryViewportProfile(entry);
          resetEntryRendererRecovery(entry);
          applyEntryVisibility(entry, hostWindow);
          entry.view.webContents.navigationHistory.goBack();
        }
      });
    },
    goForward({ hostWindow, tabId }) {
      withEntry({ hostWindow, tabId }, (entry) => {
        if (entry.view.webContents.navigationHistory.canGoForward()) {
          cancelEntryPageScripts(entry, "navigation");
          clearEntryViewportProfile(entry);
          resetEntryRendererRecovery(entry);
          applyEntryVisibility(entry, hostWindow);
          entry.view.webContents.navigationHistory.goForward();
        }
      });
    },
    reload({ hostWindow, tabId }) {
      withEntry({ hostWindow, tabId }, (entry) => {
        cancelEntryPageScripts(entry, "navigation");
        clearEntryViewportProfile(entry);
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
    trustLocalhostCertificate({ hostWindow, tabId }) {
      withEntry({ hostWindow, tabId }, (entry) => {
        const host = getLoopbackCertificateHost(entry.view.webContents.getURL());
        if (host === null) {
          throw new Error(
            "Only the current localhost HTTPS page can be trusted",
          );
        }
        trustedCertificateHosts.add(host);
        entry.lastErrorText = null;
        entry.view.webContents.reload();
      });
    },
    async listFrames({ hostWindow, request }) {
      const entry = entries.get(browserViewKey(hostWindow, request.tabId));
      if (
        entry === undefined ||
        entry.view.webContents.isDestroyed() ||
        !entry.visible
      ) {
        throw new Error("The Browser tab is unavailable for frame discovery");
      }
      return listFramesForEntry(entry, request);
    },
    async runPageScript({ hostWindow, request }) {
      const entry = entries.get(browserViewKey(hostWindow, request.tabId));
      if (
        entry === undefined ||
        entry.view.webContents.isDestroyed() ||
        entry.view.webContents.getURL().length === 0 ||
        entry.navigationEpoch !== request.expectedNavigationEpoch
      ) {
        throw new Error("The Browser tab is not available for page scripts");
      }
      let frameExecutionContextId: number | undefined;
      if (request.frame !== undefined) {
        const record = frameRecordFor(entry, request.frame);
        frameExecutionContextId = record.executionContextId ?? undefined;
        if (frameExecutionContextId === undefined) {
          const created = await entry.view.webContents.debugger.sendCommand(
            "Page.createIsolatedWorld",
            { frameId: record.debuggerFrameId, worldName: "bb-browser-frame-v1" },
          );
          const executionContextId = Object.getOwnPropertyDescriptor(
            created,
            "executionContextId",
          )?.value;
          if (typeof executionContextId !== "number") {
            throw new Error("The Browser frame execution context is unavailable");
          }
          frameExecutionContextId = executionContextId;
          record.executionContextId = executionContextId;
        }
      }
      entry.pageScriptSessions.get(request.requestId)?.cancel("replaced");
      const session = startDesktopBrowserPageScript({
        navigationEpoch: entry.navigationEpoch,
        request,
        webContents: entry.view.webContents,
        ...(frameExecutionContextId === undefined ? {} : { frameExecutionContextId }),
      });
      entry.pageScriptSessions.set(request.requestId, session);
      try {
        return await session.promise;
      } finally {
        if (entry.pageScriptSessions.get(request.requestId) === session) {
          entry.pageScriptSessions.delete(request.requestId);
        }
      }
    },
    cancelPageScript({ hostWindow, tabId, requestId }) {
      withEntry({ hostWindow, tabId }, (entry) => {
        const session = entry.pageScriptSessions.get(requestId);
        if (session === undefined) return;
        entry.pageScriptSessions.delete(requestId);
        session.cancel();
      });
    },
    close({ hostWindow, request }) {
      const key = browserViewKey(hostWindow, request.tabId);
      const entry = entries.get(key);
      if (
        entry === undefined ||
        entry.view.webContents.isDestroyed() ||
        entry.navigationEpoch !== request.expectedNavigationEpoch
      ) {
        throw new Error("The Browser page changed before it could be closed");
      }
      const result = { navigationEpoch: entry.navigationEpoch };
      destroyEntry(hostWindow, key);
      return result;
    },
    async sendPointerInput({ hostWindow, request }) {
      const entry = entries.get(browserViewKey(hostWindow, request.tabId));
      if (
        entry === undefined ||
        entry.view.webContents.isDestroyed() ||
        entry.view.webContents.getURL().length === 0
      ) {
        throw new Error("The Browser tab is not available for native input");
      }
      if (entry.navigationEpoch !== request.expectedNavigationEpoch) {
        throw new Error("The Browser page changed before native input");
      }
      if (request.frame !== undefined) frameRecordFor(entry, request.frame);
      const offset =
        request.frame === undefined
          ? { x: 0, y: 0 }
          : await frameViewportOffset(entry, request.frame);
      if (entry.navigationEpoch !== request.expectedNavigationEpoch) {
        throw new Error("The Browser page changed before native input");
      }
      for (const event of request.events) {
        entry.view.webContents.sendInputEvent({
          ...event,
          x: event.x + offset.x,
          y: event.y + offset.y,
        });
      }
      return {
        navigationEpoch: entry.navigationEpoch,
        dispatched: request.events.length,
      };
    },
    async sendTrustedInput({ hostWindow, request }) {
      const entry = entries.get(browserViewKey(hostWindow, request.tabId));
      if (
        entry === undefined ||
        entry.view.webContents.isDestroyed() ||
        !entry.visible ||
        entry.view.webContents.getURL().length === 0
      ) {
        throw new Error("The Browser tab is unavailable for trusted input");
      }
      if (entry.navigationEpoch !== request.expectedNavigationEpoch) {
        throw new Error("The Browser page changed before trusted input");
      }
      if (request.frame !== undefined) frameRecordFor(entry, request.frame);
      const offset =
        request.frame === undefined
          ? { x: 0, y: 0 }
          : await frameViewportOffset(entry, request.frame);
      focusEntryWithoutNotifying(entry);
      if (entry.navigationEpoch !== request.expectedNavigationEpoch) {
        throw new Error("The Browser page changed before trusted input");
      }
      if (request.frame !== undefined) frameRecordFor(entry, request.frame);
      const webContents = entry.view.webContents;
      const action = request.action;
      let dispatched: number;
      if (action.kind === "click") {
        const x = action.x + offset.x;
        const y = action.y + offset.y;
        webContents.sendInputEvent({
          type: "mouseDown",
          x,
          y,
          button: action.button,
          clickCount: action.clickCount,
        });
        webContents.sendInputEvent({
          type: "mouseUp",
          x,
          y,
          button: action.button,
          clickCount: action.clickCount,
        });
        dispatched = 2;
      } else if (action.kind === "type") {
        if (action.clear) {
          const modifier = process.platform === "darwin" ? "meta" : "control";
          webContents.sendInputEvent({
            type: "keyDown",
            keyCode: "A",
            modifiers: [modifier],
          });
          webContents.sendInputEvent({
            type: "keyUp",
            keyCode: "A",
            modifiers: [modifier],
          });
          webContents.sendInputEvent({
            type: "keyDown",
            keyCode: "Backspace",
          });
          webContents.sendInputEvent({
            type: "keyUp",
            keyCode: "Backspace",
          });
        }
        if (entry.navigationEpoch !== request.expectedNavigationEpoch) {
          throw new Error("The Browser page changed during trusted input");
        }
        if (request.frame !== undefined) frameRecordFor(entry, request.frame);
        await webContents.insertText(action.text);
        dispatched = action.clear ? 5 : 1;
      } else {
        const modifiers = action.modifiers.map((modifier) => {
          switch (modifier) {
            case "Alt":
              return "alt";
            case "Control":
              return "control";
            case "Meta":
              return "meta";
            case "Shift":
              return "shift";
          }
        });
        webContents.sendInputEvent({
          type: "keyDown",
          keyCode: action.code ?? action.key,
          modifiers,
        });
        if (action.key.length === 1) {
          webContents.sendInputEvent({
            type: "char",
            keyCode: action.key,
            modifiers,
          });
        }
        webContents.sendInputEvent({
          type: "keyUp",
          keyCode: action.code ?? action.key,
          modifiers,
        });
        dispatched = action.key.length === 1 ? 3 : 2;
      }
      if (request.frame !== undefined) frameRecordFor(entry, request.frame);
      if (entry.navigationEpoch !== request.expectedNavigationEpoch) {
        throw new Error("The Browser page changed during trusted input");
      }
      return {
        navigationEpoch: entry.navigationEpoch,
        ...(request.frame === undefined ? {} : { frame: request.frame }),
        dispatched,
      };
    },
    async waitForBrowserEvent({ hostWindow, request }) {
      const entry = entries.get(browserViewKey(hostWindow, request.tabId));
      if (
        entry === undefined ||
        entry.view.webContents.isDestroyed() ||
        !entry.visible
      ) {
        throw new Error("The Browser tab is unavailable for event waiting");
      }
      if (
        entry.navigationEpoch !== request.expectedNavigationEpoch &&
        !browserWaitIsTransition(request.criteria)
      ) {
        throw new Error("The Browser page changed before event waiting");
      }
      if (entry.eventWaiters.has(request.requestId)) {
        throw new Error("The Browser event request id is already active");
      }
      if (request.criteria.kind === "url") {
        const currentUrl = entry.view.webContents.getURL();
        if (browserUrlMatches(currentUrl, request.criteria.url, request.criteria.match)) {
          return {
            requestId: request.requestId,
            navigationEpoch: entry.navigationEpoch,
            value: { kind: "url" as const, url: truncate(currentUrl, BB_DESKTOP_BROWSER_MAX_URL_LENGTH) },
          };
        }
      }
      if (request.criteria.kind === "load-state") {
        const currentState =
          request.criteria.state === "networkidle"
            ? entry.networkIdleSince !== null &&
              entry.inFlightRequests === 0 &&
              Date.now() - entry.networkIdleSince >= 500
              ? "networkidle"
              : null
            : entry.loadState === request.criteria.state
              ? request.criteria.state
              : null;
        if (
          request.criteria.document === "current" &&
          currentState === request.criteria.state
        ) {
          return {
            requestId: request.requestId,
            navigationEpoch: entry.navigationEpoch,
            value: {
              kind: "load-state" as const,
              state: request.criteria.state,
            },
          };
        }
      }
      return new Promise<BbDesktopBrowserWaitResult>((resolve, reject) => {
        entry.eventWaiters.set(request.requestId, {
          hostWindow,
          request,
          resolve,
          reject,
        });
      });
    },
    cancelBrowserEvent({ hostWindow, request }) {
      const entry = entries.get(browserViewKey(hostWindow, request.tabId));
      const waiter = entry?.eventWaiters.get(request.requestId);
      if (entry === undefined || waiter === undefined) return;
      entry.eventWaiters.delete(request.requestId);
      waiter.reject(new DOMException("Browser event wait was cancelled", "AbortError"));
    },
    setViewportProfile({ hostWindow, request }) {
      const entry = entries.get(browserViewKey(hostWindow, request.tabId));
      if (
        entry === undefined ||
        entry.view.webContents.isDestroyed() ||
        entry.view.webContents.getURL().length === 0
      ) {
        throw new Error(
          "The Browser tab is not available for viewport emulation",
        );
      }
      if (entry.navigationEpoch !== request.expectedNavigationEpoch) {
        throw new Error("The Browser page changed before viewport emulation");
      }
      clearEntryViewportProfile(entry);
      const generation = ++viewportProfileGeneration;
      entry.view.webContents.enableDeviceEmulation(
        viewportParameters(request.profile),
      );
      entry.viewportProfile = { generation, profile: request.profile };
      return {
        navigationEpoch: entry.navigationEpoch,
        generation,
        profile: request.profile,
      };
    },
    clearViewportProfile({ hostWindow, request }) {
      withEntry({ hostWindow, tabId: request.tabId }, (entry) => {
        clearEntryViewportProfile(entry, request.generation);
      });
    },
    async capturePage({ hostWindow, request }) {
      const entry = entries.get(browserViewKey(hostWindow, request.tabId));
      if (
        entry === undefined ||
        entry.view.webContents.isDestroyed() ||
        entry.view.webContents.getURL().length === 0
      ) {
        throw new Error("The Browser tab is not available for capture");
      }
      const navigationEpoch = entry.navigationEpoch;
      if (
        request.expectedNavigationEpoch !== undefined &&
        request.expectedNavigationEpoch !== navigationEpoch
      ) {
        throw new Error("The Browser page changed before capture");
      }
      const image = await entry.view.webContents.capturePage();
      if (entry.navigationEpoch !== navigationEpoch) {
        throw new Error("The Browser page changed during capture");
      }
      if (image.isEmpty()) throw new Error("Browser page capture was empty");
      const bytes =
        request.format === "png"
          ? image.toPNG()
          : image.toJPEG(request.quality);
      return {
        navigationEpoch,
        dataUrl: `data:image/${request.format};base64,${bytes.toString("base64")}`,
        pixelSize: image.getSize(),
      };
    },
    async runAutomation({
      hostWindow,
      request,
    }): Promise<BbDesktopBrowserAutomationResult> {
      const entry = entries.get(browserViewKey(hostWindow, request.tabId));
      if (
        entry === undefined ||
        entry.view.webContents.isDestroyed() ||
        entry.view.webContents.getURL().length === 0
      ) {
        throw new Error("The Browser tab is unavailable for automation");
      }
      if (entry.navigationEpoch !== request.expectedNavigationEpoch) {
        throw new Error("The Browser page changed before automation");
      }
      const navigationEpoch = entry.navigationEpoch;
      if (request.action.kind === "set-dialog-handler") {
        entry.nextDialogHandler = {
          behavior: request.action.behavior,
          ...(request.action.promptText === undefined
            ? {}
            : { promptText: request.action.promptText }),
        };
        return {
          navigationEpoch,
          value: { configured: true, behavior: request.action.behavior },
        };
      }
      if (request.action.kind === "set-permissions") {
        for (const permission of request.action.permissions) {
          if (request.action.decision === "allow") {
            entry.deniedPermissions.delete(permission);
            entry.allowedPermissions.add(permission);
          } else {
            entry.allowedPermissions.delete(permission);
            entry.deniedPermissions.add(permission);
          }
        }
        return {
          navigationEpoch,
          value: {
            decision: request.action.decision,
            permissions: request.action.permissions,
          },
        };
      }
      if (request.action.kind === "diagnostics") {
        return {
          navigationEpoch,
          value: {
            console: entry.diagnostics.console,
            dialogs: entry.diagnostics.dialogs,
            downloads: entry.diagnostics.downloads,
            network: entry.diagnostics.network,
            pageErrors: entry.diagnostics.pageErrors,
            permissions: entry.diagnostics.permissions,
          },
        };
      }
      const browserDebugger = entry.view.webContents.debugger;
      if (!browserDebugger.isAttached()) browserDebugger.attach("1.3");
      await browserDebugger.sendCommand("Page.enable");
      const frameOffset =
        request.action.kind === "capture-clip" &&
        request.action.frame !== undefined
          ? await frameViewportOffset(entry, request.action.frame)
          : { x: 0, y: 0 };
      let x: number;
      let y: number;
      let width: number;
      let height: number;
      if (request.action.kind === "capture-full-page") {
        const metrics = await browserDebugger.sendCommand(
          "Page.getLayoutMetrics",
        );
        if (
          !isObject(metrics) ||
          !isObject(metrics.cssContentSize) ||
          typeof metrics.cssContentSize.width !== "number" ||
          typeof metrics.cssContentSize.height !== "number"
        ) {
          throw new Error("Browser page dimensions were unavailable");
        }
        x = 0;
        y = 0;
        width = metrics.cssContentSize.width;
        height = metrics.cssContentSize.height;
      } else {
        x = request.action.x + frameOffset.x;
        y = request.action.y + frameOffset.y;
        width = request.action.width;
        height = request.action.height;
      }
      if (
        width > BROWSER_CAPTURE_MAX_DIMENSION ||
        height > BROWSER_CAPTURE_MAX_DIMENSION ||
        width * height > BROWSER_CAPTURE_MAX_PIXELS
      ) {
        throw new Error("Browser capture dimensions exceed the safety limit");
      }
      const capture = await browserDebugger.sendCommand(
        "Page.captureScreenshot",
        {
          format: request.action.format,
          captureBeyondViewport: true,
          fromSurface: true,
          clip: { x, y, width, height, scale: 1 },
          ...(request.action.format === "jpeg"
            ? { quality: request.action.quality }
            : {}),
        },
      );
      if (!isObject(capture) || typeof capture.data !== "string") {
        throw new Error("Browser page capture returned an invalid result");
      }
      if (entry.navigationEpoch !== navigationEpoch) {
        throw new Error("The Browser page changed during automation");
      }
      return {
        navigationEpoch,
        value: {
          dataUrl: `data:image/${request.action.format};base64,${capture.data}`,
          pixelSize: {
            width: Math.ceil(width),
            height: Math.ceil(height),
          },
        },
      };
    },
    importCookies({ hostWindow, request }) {
      return mutateBrowserSession(async () => {
        const entry = entries.get(browserViewKey(hostWindow, request.tabId));
        if (entry === undefined || entry.view.webContents.isDestroyed()) {
          throw new Error("The Browser tab is unavailable");
        }
        const importedCookies = await importCookiesIntoSession(
          ensureHardenedSession(),
          request.cookies,
        );
        await ensureHardenedSession().cookies.flushStore();
        reloadEntriesAfterCookieChange();
        return { importedCookies };
      });
    },
    listCookieImportSources({ hostWindow, request }) {
      const entry = entries.get(browserViewKey(hostWindow, request.tabId));
      if (entry === undefined || entry.view.webContents.isDestroyed()) {
        throw new Error("The Browser tab is unavailable");
      }
      return { sources: [...listBrowserCookieImportSources()] };
    },
    importCookiesFromBrowser({ hostWindow, request }) {
      return mutateBrowserSession(async () => {
        const entry = entries.get(browserViewKey(hostWindow, request.tabId));
        if (entry === undefined || entry.view.webContents.isDestroyed()) {
          throw new Error("The Browser tab is unavailable");
        }
        const cookies = importCookiesFromBrowserSource({
          family: request.family,
          profileId: request.profileId,
        });
        if (cookies.length > 5_000) {
          throw new Error(
            "The selected browser profile has too many cookies to import",
          );
        }
        const importedCookies = await importCookiesIntoSession(
          ensureHardenedSession(),
          cookies,
        );
        await ensureHardenedSession().cookies.flushStore();
        reloadEntriesAfterCookieChange();
        return { importedCookies };
      });
    },
    clearImportedCookies({ hostWindow, tabId }) {
      return mutateBrowserSession(async () => {
        const entry = entries.get(browserViewKey(hostWindow, tabId));
        if (entry === undefined || entry.view.webContents.isDestroyed()) {
          throw new Error("The Browser tab is unavailable");
        }
        await clearBrowserSessionStorage();
        await ensureHardenedSession().cookies.flushStore();
        reloadEntriesAfterCookieChange();
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
    releaseWindow(hostWebContentsId) {
      resizingHostIds.delete(hostWebContentsId);
      const prefix = `${hostWebContentsId}:`;
      for (const [key, entry] of [...entries.entries()]) {
        if (!key.startsWith(prefix)) {
          continue;
        }
        entries.delete(key);
        clearEntryViewportProfile(entry);
        entriesByWebContentsId.delete(entry.view.webContents.id);
        clearEntryRendererRecoveryTimer(entry);
        cancelEntryPageScripts(entry, "window-closed");
        for (const popupWindow of [...entry.popupWindows]) {
          if (!popupWindow.isDestroyed()) {
            popupWindow.destroy();
          }
        }
        entry.popupWindows.clear();
        if (!entry.view.webContents.isDestroyed()) {
          entry.view.webContents.close();
        }
      }
    },
    destroyAll() {
      resizingHostIds.clear();
      for (const popupWindow of [...popupWindows]) {
        if (!popupWindow.isDestroyed()) {
          popupWindow.destroy();
        }
      }
      popupWindows.clear();
      for (const [key, entry] of [...entries.entries()]) {
        entries.delete(key);
        entriesByWebContentsId.delete(entry.view.webContents.id);
        clearEntryViewportProfile(entry);
        clearEntryRendererRecoveryTimer(entry);
        cancelEntryPageScripts(entry, "shutdown");
        if (!entry.view.webContents.isDestroyed()) {
          entry.view.webContents.close();
        }
      }
    },
  };
}
