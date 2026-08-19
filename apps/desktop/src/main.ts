import { randomUUID } from "node:crypto";
import { accessSync, constants as fsConstants } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  app,
  BrowserWindow,
  clipboard,
  ipcMain,
  nativeImage,
  nativeTheme,
  net,
  safeStorage,
  session,
  shell,
  type Event,
  type IpcMainInvokeEvent,
  type WebContents,
} from "electron";
import { autoUpdater } from "electron-updater";
import {
  APP_SURFACE_DESKTOP,
  APP_SURFACE_ENV_NAME,
} from "@bb/config/app-surface";
import type { ConnectCredential } from "@bb/connect-client";
import type { AppKeybindings } from "@bb/domain";
import {
  bbDesktopThemeSchema,
  type BbDesktopInfo,
  type BbDesktopWindowState,
} from "@bb/desktop-contract";
import {
  serverMessageLenientSchema,
  type ClientMessage,
} from "@bb/server-contract";
import { z } from "zod";
import {
  assertPathExists,
  resolveDesktopBridgePath,
  resolveDesktopIconPath,
  type DesktopPathContext,
} from "./app-paths.js";
import {
  resolveBbAppProcessRuntime,
  type BbAppProcess,
  type BbAppProcessExit,
  startBbAppProcess,
} from "./bb-process.js";
import { openExistingServerDialog } from "./existing-server-dialog.js";
import {
  readForeignRuntimeDetails,
  stopForeignRuntime,
} from "./foreign-runtime.js";
import { createLocalViewUrl } from "./local-view.js";
import { installApplicationMenu } from "./menu.js";
import {
  DEFAULT_APPLICATION_MENU_ACCELERATORS,
  resolveApplicationMenuAccelerators,
} from "./desktop-menu-shortcuts.js";
import {
  clearOwnedRuntimePidFile,
  reapStaleOwnedRuntime,
  writeOwnedRuntimePidFile,
} from "./owned-runtime-supervisor.js";
import {
  probeBbServer,
  waitForCompatibleServer,
  type CompatibleServerProbeResult,
  type ServerProbeResult,
} from "./server-probe.js";
import {
  BUILTIN_SERVER_NAME,
  createServerTargetStore,
  SERVER_TARGET_FILE_NAME,
  type ConnectServerRef,
  type ServerTargetStore,
} from "./server-target.js";
import { openServerUrlDialog } from "./server-url-dialog.js";
import {
  createConnectServerSync,
  type ConnectAccountServer,
  type ConnectServerSync,
} from "./connect-server-sync.js";
import {
  createCredentialCookieSource,
  createLocalServerCookieSource,
  installConnectDesktopSession,
  type ConnectDesktopSessionResult,
} from "./connect-desktop-session.js";
import {
  createConnectCredentialCache,
  type ConnectCredentialCache,
} from "./connect-credential-cache.js";
import { enrollDesktopMachine } from "./connect-machine-enrollment.js";
import {
  createConnectSessionRenewal,
  type ConnectSessionRenewal,
} from "./connect-session-renewal.js";
import {
  createDesktopShutdownState,
  registerDesktopShutdownSignalHandlers,
} from "./desktop-shutdown.js";
import {
  createDesktopWindowFactory,
  type DesktopBrowserWindow,
  type DesktopBrowserWindowCreator,
  type DesktopWindowFactory,
} from "./desktop-window-factory.js";
import { registerDesktopContextMenu } from "./desktop-context-menu.js";
import { resolveBbDesktopPlatform } from "./desktop-platform.js";
import {
  createDesktopUpdateService,
  createDesktopUpdateFeedUrl,
  type DesktopUpdateService,
} from "./desktop-update-check.js";
import {
  DESKTOP_RELEASE_INFO,
  DESKTOP_UPDATE_CHANNEL,
  resolveDesktopUpdateSupport,
} from "./desktop-update-provider.js";
import {
  createDesktopAutoUpdateService,
  createElectronAutoUpdaterAdapter,
  shouldEnableDesktopAutoUpdate,
  type DesktopAutoUpdateLogger,
  type DesktopAutoUpdateService,
} from "./desktop-auto-update.js";
import { mergeDesktopUpdateInfo } from "./desktop-update-info.js";
import {
  BB_DESKTOP_CHECK_FOR_UPDATES_CHANNEL,
  BB_DESKTOP_GET_INFO_CHANNEL,
  BB_DESKTOP_INFO_CHANGED_CHANNEL,
  BB_DESKTOP_INSTALL_UPDATE_CHANNEL,
  BB_DESKTOP_OPEN_EXTERNAL_URL_CHANNEL,
  BB_DESKTOP_SET_THEME_CHANNEL,
} from "./desktop-update-ipc.js";
import {
  BB_DESKTOP_APP_COMMAND_CHANNEL,
  BB_DESKTOP_CLOSE_WINDOW_REQUEST_CHANNEL,
  BB_DESKTOP_CLOSE_WINDOW_RESPONSE_CHANNEL,
  BB_DESKTOP_GET_WINDOW_STATE_CHANNEL,
  BB_DESKTOP_OPEN_NEW_TAB_CHANNEL,
  BB_DESKTOP_WINDOW_STATE_CHANGED_CHANNEL,
  CLOSE_WINDOW_REQUEST_TIMEOUT_MS,
} from "./desktop-window-command-ipc.js";
import {
  createDesktopBrowserViewManager,
  type DesktopBrowserViewManager,
} from "./desktop-browser-view.js";
import { resolveDesktopBrowserAppCommand } from "./desktop-browser-shortcuts.js";
import { registerDesktopBrowserIpc } from "./desktop-browser-main-ipc.js";
import { parseDesktopSystemConfig } from "./desktop-system-config.js";
import { ensurePackagedUserShellPath } from "./desktop-shell-path.js";
import { clearPackagedSessionHttpCache } from "./desktop-session-cache.js";
import { resolveDesktopReloadShortcut } from "./desktop-reload-shortcut.js";
import {
  createLogTailer,
  createLogLineBuffer,
  createLogViewerViewUrl,
  LOG_VIEWER_IPC_BATCH_INTERVAL_MS,
  LOG_VIEWER_IPC_BATCH_LINE_LIMIT,
  type LogLineBuffer,
  type LogTailer,
} from "./log-viewer.js";
import {
  LOG_VIEWER_APPEND_CHANNEL,
  LOG_VIEWER_COPY_CHANNEL,
  LOG_VIEWER_OPEN_LOGS_FOLDER_CHANNEL,
  LOG_VIEWER_SNAPSHOT_CHANNEL,
  LOG_VIEWER_VISIBLE_LINE_LIMIT,
  type LogViewerLine,
  type LogViewerCopyRequest,
  type LogViewerOpenLogsFolderResult,
} from "./log-viewer-contract.js";
import {
  ATTACH_PROBE_TIMEOUT_MS,
  DEFAULT_BB_SERVER_URL,
  PROCESS_LOG_LINE_LIMIT,
  STARTUP_POLL_INTERVAL_MS,
  STARTUP_TIMEOUT_MS,
  type RuntimeOwnership,
  type WindowStateKey,
} from "./types.js";

const OWNED_RUNTIME_STOP_TIMEOUT_MS = 6_000;
const OWNED_RUNTIME_KILL_TIMEOUT_MS = 1_000;
const FOREIGN_RUNTIME_STOP_TIMEOUT_MS = 15_000;
const FOREIGN_RUNTIME_KILL_TIMEOUT_MS = 3_000;
const REMOTE_SYSTEM_CONFIG_POLL_INTERVAL_MS = 5 * 60 * 1000;

interface DesktopRuntime {
  bbProcess: BbAppProcess | null;
  ownership: RuntimeOwnership;
  serverUrl: string;
  userDataPath: string | null;
}

interface LoadStartupErrorArgs {
  details: string;
  logs: string;
  title: string;
}

interface LoadWindowUrlArgs {
  url: string;
}

interface CreateApplicationWindowArgs {
  initialUrl: string | null;
  stateKey: WindowStateKey | null;
}

interface StartOwnedRuntimeArgs {
  bridgePath: string;
  serverUrl: string;
  userDataPath: string;
}

interface AppendLogViewerLinesArgs {
  lines: LogViewerLine[];
}

interface SendLogViewerSnapshotArgs {
  browserWindow: BrowserWindow;
  lines: LogViewerLine[];
  logDir: string;
}

interface HandleCopyLogsArgs {
  request: LogViewerCopyRequest;
}

interface LoadLogViewerWindowArgs {
  logDir: string;
  preloadPath: string;
}

type StartupRaceResult =
  | ProcessExitedStartupRaceResult
  | ServerProbeStartupRaceResult;

interface ProcessExitedStartupRaceResult {
  exit: BbAppProcessExit;
  kind: "process-exited";
}

interface ServerProbeStartupRaceResult {
  kind: "server-probe";
  result: ServerProbeResult;
}

interface ResolveDataDirFromEnvArgs {
  env: NodeJS.ProcessEnv;
  homeDir: string;
}

interface ResolveDesktopServerUrlArgs {
  env: NodeJS.ProcessEnv;
}

interface ResolveDesktopWindowUrlArgs {
  env: NodeJS.ProcessEnv;
  serverUrl: string;
}

interface ResolveDesktopUpdateFeedUrlArgs {
  env: NodeJS.ProcessEnv;
  platform: BbDesktopInfo["platform"];
}

interface FetchSystemConfigArgs {
  /**
   * Remote servers authenticate with the Electron session cookie, which only
   * Electron's own network stack carries. Local ones use plain node fetch.
   */
  fetchImpl: typeof fetch;
  serverUrl: string;
}

interface RefreshSystemConfigArgs {
  fetchImpl: typeof fetch;
  serverUrl: string;
}

interface SystemConfigSync {
  stop(): void;
}

const logViewerCopyRequestSchema = z
  .object({
    text: z.string(),
  })
  .strict();

let desktopWindowFactory: DesktopWindowFactory | null = null;
let desktopBrowserViewManager: DesktopBrowserViewManager | null = null;
let currentAppKeybindings: AppKeybindings = [];
let currentApplicationMenuAccelerators = DEFAULT_APPLICATION_MENU_ACCELERATORS;
let desktopUpdateService: DesktopUpdateService | null = null;
let desktopAutoUpdateService: DesktopAutoUpdateService | null = null;
let currentRuntime: DesktopRuntime | null = null;
let currentWindowUrl: string | null = null;
let logViewerIpcHandlersInstalled = false;
let logViewerLineBuffer: LogLineBuffer | null = null;
let logViewerPreloadPath: string | null = null;
let logViewerTailer: LogTailer | null = null;
let logViewerWindow: BrowserWindow | null = null;
let systemConfigSync: SystemConfigSync | null = null;
let systemConfigRefreshToken = 0;
let refreshRemoteSystemConfig: (() => void) | null = null;
const applicationWindowWebContentsIds = new Set<number>();
let bbAppLoaded = false;
let stoppingForQuit = false;
let quitting = false;
let serverTargetStore: ServerTargetStore | null = null;
let connectServerSync: ConnectServerSync | null = null;
let connectCredentialCache: ConnectCredentialCache | null = null;
let cachedConnectCredential: ConnectCredential | null = null;
let enrollingDesktopMachine: Promise<void> | null = null;
let connectSessionRenewal: ConnectSessionRenewal | null = null;
let serverTargetGeneration = 0;
let connectAccountServers: ConnectAccountServer[] = [];
let builtinServerUrl: string = DEFAULT_BB_SERVER_URL;
let desktopBridgePath: string | null = null;
let desktopUserDataPath: string | null = null;
let serverUrlDialogPreloadPath: string | null = null;
let existingServerDialogPreloadPath: string | null = null;

function resolveDesktopServerUrl(args: ResolveDesktopServerUrlArgs): string {
  const rawPort = args.env.BB_SERVER_PORT?.trim();
  if (rawPort === undefined || rawPort.length === 0) {
    return DEFAULT_BB_SERVER_URL;
  }

  const port = Number(rawPort);
  if (Number.isInteger(port) && port >= 1 && port <= 65_535) {
    return `http://127.0.0.1:${port}`;
  }

  throw new Error("BB_SERVER_PORT must be a valid TCP port");
}

/**
 * The URL the main window loads. Defaults to the attached/owned bb server, which
 * serves the built UI. In dev, `run-electron-dev.mjs` sets `BB_DESKTOP_APP_URL`
 * to the running Vite dev server — but only when it has confirmed Vite is
 * actually listening — so the desktop shell loads live source with HMR while
 * still talking to the same server it attached to. It is unset in packaged
 * builds, so production always loads the server itself.
 */
function resolveDesktopWindowUrl(args: ResolveDesktopWindowUrlArgs): string {
  const rawAppUrl = args.env.BB_DESKTOP_APP_URL?.trim();
  if (rawAppUrl === undefined || rawAppUrl.length === 0) {
    return args.serverUrl;
  }
  let parsedAppUrl: URL;
  try {
    parsedAppUrl = new URL(rawAppUrl);
  } catch {
    throw new Error("BB_DESKTOP_APP_URL must be a valid URL");
  }
  if (parsedAppUrl.protocol !== "http:" && parsedAppUrl.protocol !== "https:") {
    throw new Error("BB_DESKTOP_APP_URL must be an http(s) URL");
  }
  return rawAppUrl;
}

/**
 * electron-updater unlinks the running AppImage before it moves the downloaded
 * one into place, so both operations need write and search access on the parent
 * directory. Without that access the install deletes the user's app and leaves
 * nothing behind, so this gates the install path rather than the download.
 */
function canReplaceAppImage(appImagePath: string): boolean {
  try {
    accessSync(
      dirname(appImagePath),
      // eslint-disable-next-line no-bitwise
      fsConstants.W_OK | fsConstants.X_OK,
    );
    return true;
  } catch {
    return false;
  }
}

function resolveDesktopUpdateFeedUrl(
  args: ResolveDesktopUpdateFeedUrlArgs,
): string {
  const rawFeedUrl = args.env.BB_DESKTOP_VERSION_FEED_URL?.trim();
  if (rawFeedUrl === undefined || rawFeedUrl.length === 0) {
    return createDesktopUpdateFeedUrl(args.platform);
  }
  return rawFeedUrl;
}

function getDesktopVersion(version: string | undefined): string {
  if (version === undefined || version.length === 0) {
    throw new Error("Desktop version must be injected at build time");
  }
  return version;
}

function getCurrentDesktopInfo(): BbDesktopInfo | null {
  return mergeDesktopUpdateInfo({
    autoInfo: desktopAutoUpdateService?.getInfo() ?? null,
    feedInfo: desktopUpdateService?.getInfo() ?? null,
  });
}

function isRegisteredApplicationWindow(browserWindow: BrowserWindow): boolean {
  return applicationWindowWebContentsIds.has(browserWindow.webContents.id);
}

function resolveApplicationWindow(
  webContents: WebContents,
): BrowserWindow | null {
  return BrowserWindow.fromWebContents(webContents);
}

function sendToApplicationRenderer(
  browserWindow: BrowserWindow,
  channel: string,
  payload: unknown,
): void {
  if (!browserWindow.webContents.isDestroyed()) {
    browserWindow.webContents.send(channel, payload);
  }
}

function registerApplicationRendererReloadShortcut(
  webContents: WebContents,
): void {
  webContents.on("before-input-event", (event, input) => {
    const shortcut = resolveDesktopReloadShortcut(input);
    if (shortcut === null) {
      return;
    }
    event.preventDefault();
    if (shortcut === "force-reload") {
      webContents.reloadIgnoringCache();
    } else {
      webContents.reload();
    }
  });
}

function sendDesktopInfoChanged(): void {
  const info = getCurrentDesktopInfo();
  if (info === null) {
    return;
  }
  for (const browserWindow of BrowserWindow.getAllWindows()) {
    if (isRegisteredApplicationWindow(browserWindow)) {
      sendToApplicationRenderer(
        browserWindow,
        BB_DESKTOP_INFO_CHANGED_CHANNEL,
        info,
      );
    } else {
      browserWindow.webContents.send(BB_DESKTOP_INFO_CHANGED_CHANNEL, info);
    }
  }
}

function getDesktopWindowState(
  browserWindow: Pick<DesktopBrowserWindow, "isFullScreen"> | null,
): BbDesktopWindowState {
  return {
    isFullScreen: browserWindow?.isFullScreen() ?? false,
  };
}

function getSenderDesktopWindowState(
  event: IpcMainInvokeEvent,
): BbDesktopWindowState {
  return getDesktopWindowState(resolveApplicationWindow(event.sender));
}

function sendDesktopWindowStateChanged(
  browserWindow: DesktopBrowserWindow,
): void {
  sendToApplicationRenderer(
    browserWindow as BrowserWindow,
    BB_DESKTOP_WINDOW_STATE_CHANGED_CHANNEL,
    getDesktopWindowState(browserWindow),
  );
}

function createDesktopLogger(): DesktopAutoUpdateLogger {
  return {
    error(message) {
      process.stderr.write(`${message}\n`);
    },
    info(message) {
      process.stderr.write(`${message}\n`);
    },
    warn(message) {
      process.stderr.write(`${message}\n`);
    },
  };
}

function resolveDataDirFromEnv(args: ResolveDataDirFromEnvArgs): string {
  const rawDataDir = args.env.BB_DATA_DIR?.trim();
  if (rawDataDir === undefined || rawDataDir.length === 0) {
    return join(args.homeDir, ".bb");
  }
  if (rawDataDir === "~") {
    return args.homeDir;
  }
  if (rawDataDir.startsWith("~/")) {
    return resolve(args.homeDir, rawDataDir.slice(2));
  }
  return resolve(rawDataDir);
}

function formatLogDirectory(): string {
  return join(
    resolveDataDirFromEnv({
      env: process.env,
      homeDir: homedir(),
    }),
    "logs",
  );
}

function formatExitResult(result: BbAppProcessExit): string {
  if (result.code !== null) {
    return `exit code ${result.code}`;
  }
  return result.signal === null
    ? "without an exit code"
    : `signal ${result.signal}`;
}

function createDesktopPathContext(): DesktopPathContext {
  return {
    appPath: app.getAppPath(),
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
  };
}

function shouldEnableServerDaemonLogsMenu(): boolean {
  // Attached runtimes are owned by an external bb-app, so the desktop has no
  // reliable server/daemon log lifecycle to tail.
  return (
    process.platform === "darwin" && currentRuntime?.ownership === "spawned"
  );
}

// Close requests routed through the renderer, keyed by webContents id. If the
// renderer never answers (crashed, hung, or still loading), the timer closes
// the window from the main process like the native close role used to.
const pendingCloseWindowRequests = new Map<number, NodeJS.Timeout>();

function requestRendererWindowClose(browserWindow: BrowserWindow): void {
  const webContentsId = browserWindow.webContents.id;
  const pending = pendingCloseWindowRequests.get(webContentsId);
  if (pending !== undefined) {
    clearTimeout(pending);
  }
  pendingCloseWindowRequests.set(
    webContentsId,
    setTimeout(() => {
      pendingCloseWindowRequests.delete(webContentsId);
      if (!browserWindow.isDestroyed()) {
        browserWindow.close();
      }
    }, CLOSE_WINDOW_REQUEST_TIMEOUT_MS),
  );
  sendToApplicationRenderer(
    browserWindow,
    BB_DESKTOP_CLOSE_WINDOW_REQUEST_CHANNEL,
    null,
  );
}

function closeFocusedDetachedDevTools(): void {
  for (const browserWindow of BrowserWindow.getAllWindows()) {
    if (browserWindow.webContents.isDevToolsFocused()) {
      browserWindow.webContents.closeDevTools();
      return;
    }
  }
}

function getFocusedApplicationWindow(): BrowserWindow | null {
  const focused = BrowserWindow.getFocusedWindow();
  if (
    focused !== null &&
    !focused.isDestroyed() &&
    applicationWindowWebContentsIds.has(focused.webContents.id)
  ) {
    return focused;
  }
  for (const browserWindow of BrowserWindow.getAllWindows()) {
    if (
      !browserWindow.isDestroyed() &&
      applicationWindowWebContentsIds.has(browserWindow.webContents.id)
    ) {
      return browserWindow;
    }
  }
  return null;
}

function formatCustomServerName(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.host.length > 0 ? parsed.host : url;
  } catch {
    return url;
  }
}

function connectServerMenuId(handle: string): string {
  return `connect:${handle}`;
}

/**
 * Synced account servers plus the persisted selection when its handle has
 * dropped out of the account list (so the checkmark never dangles).
 */
function listMenuConnectServers(): ConnectServerRef[] {
  const servers: ConnectServerRef[] = connectAccountServers.map((server) => ({
    handle: server.handle,
    name: server.name,
    url: server.url,
  }));
  const selected = serverTargetStore?.getConnectServer() ?? null;
  if (
    selected !== null &&
    !servers.some((server) => server.handle === selected.handle)
  ) {
    servers.push(selected);
  }
  return servers;
}

function buildMenuServerItems(): Array<{
  checked: boolean;
  id: string;
  name: string;
}> {
  const target = serverTargetStore?.getTarget() ?? { kind: "builtin" as const };
  const items = [
    {
      checked: target.kind === "builtin",
      id: "builtin",
      name: BUILTIN_SERVER_NAME,
    },
  ];
  for (const server of listMenuConnectServers()) {
    items.push({
      checked:
        target.kind === "connect" && target.server.handle === server.handle,
      id: connectServerMenuId(server.handle),
      name: server.name,
    });
  }
  const customUrl = serverTargetStore?.getCustomServerUrl() ?? null;
  if (customUrl !== null) {
    items.push({
      checked: target.kind === "custom",
      id: "custom",
      name: formatCustomServerName(customUrl),
    });
  }
  return items;
}

function installCurrentApplicationMenu(): void {
  installApplicationMenu({
    accelerators: currentApplicationMenuAccelerators,
    isMac: process.platform === "darwin",
    createNewWindow() {
      void createApplicationWindow({
        initialUrl: currentWindowUrl,
        stateKey: null,
      });
    },
    openNewTab() {
      const browserWindow = getFocusedApplicationWindow();
      if (browserWindow !== null) {
        sendToApplicationRenderer(
          browserWindow,
          BB_DESKTOP_OPEN_NEW_TAB_CHANNEL,
          null,
        );
        sendToApplicationRenderer(
          browserWindow,
          BB_DESKTOP_APP_COMMAND_CHANNEL,
          "panel.newTab",
        );
      }
    },
    openNewThread() {
      const browserWindow = getFocusedApplicationWindow();
      if (browserWindow !== null) {
        sendToApplicationRenderer(
          browserWindow,
          BB_DESKTOP_APP_COMMAND_CHANNEL,
          "thread.new",
        );
      }
    },
    openSettings() {
      const browserWindow = getFocusedApplicationWindow();
      if (browserWindow !== null) {
        sendToApplicationRenderer(
          browserWindow,
          BB_DESKTOP_APP_COMMAND_CHANNEL,
          "settings.open",
        );
      }
    },
    reloadWindow(browserWindow, ignoreCache) {
      if (!(browserWindow instanceof BrowserWindow)) {
        return;
      }
      if (ignoreCache) {
        browserWindow.webContents.reloadIgnoringCache();
      } else {
        browserWindow.webContents.reload();
      }
    },
    closeWindowOrSideTab(browserWindow) {
      if (browserWindow === undefined) {
        // A focused detached DevTools window is the key window but never
        // surfaces as a BaseWindow here; the native close role used to
        // close it.
        closeFocusedDetachedDevTools();
        return;
      }
      if (
        !(browserWindow instanceof BrowserWindow) ||
        browserWindow === logViewerWindow
      ) {
        // Windows that don't run the app preload can't answer the renderer
        // round trip, so close them directly.
        browserWindow.close();
        return;
      }
      requestRendererWindowClose(browserWindow);
    },
    openServerDaemonLogs() {
      void openServerDaemonLogs();
    },
    selectServer(serverId) {
      void setActiveServerTarget(serverId);
    },
    setServerUrl() {
      void openSetServerUrlDialog();
    },
    onServerMenuWillShow() {
      // Refresh the Connect account list (60s-coalesced) so a menu opened
      // after pairing or adding a machine shows current servers.
      connectServerSync?.onListRequested();
    },
    serverDaemonLogsMenuEnabled: shouldEnableServerDaemonLogsMenu(),
    servers: buildMenuServerItems(),
  });
}

function refreshApplicationMenu(): void {
  installCurrentApplicationMenu();
}

function setCurrentRuntime(runtime: DesktopRuntime | null): void {
  currentRuntime = runtime;
  if (runtime === null) {
    stopSystemConfigSync();
  } else {
    // Local runtime is up — pull the Connect account server list.
    connectServerSync?.onRuntimeReady();
  }
  refreshApplicationMenu();
  if (runtime?.ownership !== "spawned") {
    closeServerDaemonLogsWindow();
  }
}

function formatApiUrl(args: FetchSystemConfigArgs): string {
  const url = new URL(args.serverUrl);
  url.pathname = "/api/v1/system/config";
  url.search = "";
  url.hash = "";
  return url.toString();
}

function formatRealtimeUrl(serverUrl: string): string {
  const url = new URL(serverUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/ws";
  url.search = "";
  url.hash = "";
  return url.toString();
}

async function fetchSystemConfig(args: FetchSystemConfigArgs) {
  const response = await args.fetchImpl(formatApiUrl(args));
  if (!response.ok) {
    throw new Error(
      `System config request failed with HTTP ${response.status}`,
    );
  }
  const payload: unknown = await response.json();
  return parseDesktopSystemConfig(payload);
}

function createSystemConfigSync(serverUrl: string): SystemConfigSync {
  const realtimeUrl = formatRealtimeUrl(serverUrl);
  const subscribeMessage: ClientMessage = {
    type: "subscribe",
    target: { kind: "system" },
  };
  let reconnectTimer: NodeJS.Timeout | null = null;
  let socket: WebSocket | null = null;
  let stopped = false;

  function clearReconnectTimer(): void {
    if (reconnectTimer === null) {
      return;
    }
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  function scheduleReconnect(): void {
    if (stopped || reconnectTimer !== null) {
      return;
    }
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, 1_000);
  }

  function handleMessage(event: MessageEvent): void {
    if (typeof event.data !== "string") {
      return;
    }
    try {
      const parsed = serverMessageLenientSchema.safeParse(
        JSON.parse(event.data),
      );
      if (!parsed.success) {
        return;
      }
      if (
        parsed.data.entity === "system" &&
        parsed.data.changes.includes("config-changed")
      ) {
        void refreshSystemConfig({ fetchImpl: fetch, serverUrl });
      }
    } catch {
      return;
    }
  }

  function connect(): void {
    if (stopped) {
      return;
    }
    socket = new WebSocket(realtimeUrl);
    socket.addEventListener("open", () => {
      socket?.send(JSON.stringify(subscribeMessage));
      void refreshSystemConfig({ fetchImpl: fetch, serverUrl });
    });
    socket.addEventListener("message", handleMessage);
    socket.addEventListener("close", scheduleReconnect);
    socket.addEventListener("error", () => {
      socket?.close();
    });
  }

  connect();

  return {
    stop(): void {
      stopped = true;
      clearReconnectTimer();
      socket?.close();
      socket = null;
    },
  };
}

async function refreshSystemConfig(
  args: RefreshSystemConfigArgs,
): Promise<void> {
  const token = systemConfigRefreshToken + 1;
  systemConfigRefreshToken = token;
  try {
    const config = await fetchSystemConfig({
      fetchImpl: args.fetchImpl,
      serverUrl: args.serverUrl,
    });
    if (token !== systemConfigRefreshToken) {
      return;
    }
    currentAppKeybindings = config.keybindings;
    currentApplicationMenuAccelerators = resolveApplicationMenuAccelerators(
      currentAppKeybindings,
    );
    refreshApplicationMenu();
  } catch (error) {
    if (token !== systemConfigRefreshToken) {
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Could not refresh system config: ${message}\n`);
  }
}

/**
 * Poll a remote server for keybindings and theme.
 *
 * The realtime socket is not an option here: a remote server authenticates the
 * desktop with the Electron session cookie, and only Electron's own network
 * stack sends it. So the app re-reads the config on start, when it becomes
 * active, and on a slow timer. A keybinding edit lands within a poll instead
 * of instantly.
 */
function createRemoteSystemConfigSync(serverUrl: string): SystemConfigSync {
  function refresh(): void {
    void refreshSystemConfig({
      fetchImpl: (input, init) =>
        net.fetch(input as string | Request, {
          ...init,
          credentials: "include",
        }),
      serverUrl,
    });
  }

  const timer = setInterval(refresh, REMOTE_SYSTEM_CONFIG_POLL_INTERVAL_MS);
  timer.unref();
  refreshRemoteSystemConfig = refresh;
  refresh();

  return {
    stop(): void {
      clearInterval(timer);
      refreshRemoteSystemConfig = null;
    },
  };
}

function stopSystemConfigSync(): void {
  systemConfigSync?.stop();
  systemConfigSync = null;
}

function startSystemConfigSync(serverUrl: string): void {
  systemConfigSync?.stop();
  systemConfigSync = createSystemConfigSync(serverUrl);
  void refreshSystemConfig({ fetchImpl: fetch, serverUrl });
}

/** System config for a connect or custom target, with no local server. */
function startRemoteSystemConfigSync(serverUrl: string): void {
  systemConfigSync?.stop();
  systemConfigSync = createRemoteSystemConfigSync(serverUrl);
}

function registerApplicationWindow(browserWindow: DesktopBrowserWindow): void {
  const webContentsId = browserWindow.webContents.id;
  applicationWindowWebContentsIds.add(webContentsId);
  registerApplicationRendererReloadShortcut(
    (browserWindow as BrowserWindow).webContents,
  );
  registerDesktopContextMenu({ webContents: browserWindow.webContents });
  browserWindow.on("enter-full-screen", () => {
    sendDesktopWindowStateChanged(browserWindow);
  });
  browserWindow.on("leave-full-screen", () => {
    sendDesktopWindowStateChanged(browserWindow);
  });
  browserWindow.on("closed", () => {
    applicationWindowWebContentsIds.delete(webContentsId);
  });
}

/**
 * Attach to a compatible bb server on this Mac, or start one. The caller pins
 * the system config sync, because a remote target reads its config elsewhere.
 */
async function ensureBuiltinRuntimeAttached(): Promise<boolean> {
  if (currentRuntime !== null) {
    return true;
  }
  if (desktopBridgePath === null || desktopUserDataPath === null) {
    return false;
  }

  const existingProbe = await probeBbServer({
    serverUrl: builtinServerUrl,
    timeoutMs: ATTACH_PROBE_TIMEOUT_MS,
  });

  if (existingProbe.kind === "compatible") {
    setCurrentRuntime({
      bbProcess: null,
      ownership: "attached",
      serverUrl: existingProbe.serverUrl,
      userDataPath: null,
    });
    return true;
  }

  if (existingProbe.kind === "incompatible") {
    return false;
  }

  const runtime = await startOwnedRuntime({
    bridgePath: desktopBridgePath,
    serverUrl: builtinServerUrl,
    userDataPath: desktopUserDataPath,
  });
  return runtime !== null;
}

/**
 * Mint and install the Connect session cookie for a remote server.
 *
 * The app's own machine credential is the fast path: it needs no local bb
 * server. A credential the gate refuses (revoked machine, unpaired account) is
 * dropped, and the local server mints the cookie instead — which is also the
 * first-launch path, before the app has enrolled.
 */
async function authenticateConnectTarget(
  remoteServerUrl: string,
  isCurrent: () => boolean,
): Promise<ConnectDesktopSessionResult> {
  const cookieStore = session.defaultSession.cookies;
  let cachedFailure: ConnectDesktopSessionResult | null = null;
  if (cachedConnectCredential !== null) {
    const cachedResult = await installConnectDesktopSession({
      cookieStore,
      mintCookie: createCredentialCookieSource({
        credential: cachedConnectCredential,
      }),
      remoteServerUrl,
    });
    if (cachedResult.ok) {
      return cachedResult;
    }
    if (cachedResult.code === "unauthorized") {
      createDesktopLogger().info(
        "[desktop] bb Connect refused the cached machine credential — dropping it",
      );
      await clearCachedConnectCredential();
    } else if (cachedResult.code === "network") {
      // The gate is unreachable. The local server would call the same gate, so
      // starting one cannot help — and starting one is what this path avoids.
      return cachedResult;
    }
    cachedFailure = cachedResult;
  }

  if (!isCurrent()) {
    // The app left this server while the gate call ran. Starting the local
    // server now would undo the switch the user just made.
    return (
      cachedFailure ?? {
        code: "network",
        detail: "the app no longer targets this server",
        ok: false,
      }
    );
  }
  const localRuntimeReady = await ensureBuiltinRuntimeAttached();
  if (!localRuntimeReady || currentRuntime === null) {
    return (
      cachedFailure ?? {
        code: "network",
        detail:
          "the local bb server is unavailable, and this app has no stored bb Connect credential",
        ok: false,
      }
    );
  }
  const localResult = await installConnectDesktopSession({
    cookieStore,
    mintCookie: createLocalServerCookieSource({
      localServerUrl: currentRuntime.serverUrl,
    }),
    remoteServerUrl,
  });
  if (localResult.ok) {
    // Enroll for next launch, so this target needs no local server again.
    void ensureDesktopMachineEnrolled();
  }
  return localResult;
}

async function clearCachedConnectCredential(): Promise<void> {
  cachedConnectCredential = null;
  await connectCredentialCache?.clear();
}

/**
 * Give this app its own connect machine credential, using the local server's
 * pairing secret once. Best effort: a failure only means the app keeps asking
 * the local server for session cookies.
 */
function ensureDesktopMachineEnrolled(): void {
  const cache = connectCredentialCache;
  const localServerUrl = currentRuntime?.serverUrl;
  if (
    cache === null ||
    cachedConnectCredential !== null ||
    enrollingDesktopMachine !== null ||
    localServerUrl === undefined
  ) {
    return;
  }
  if (!cache.canPersist()) {
    // Enrolling now would burn an account machine slot on every launch.
    createDesktopLogger().info(
      "[desktop] no OS keychain available — keeping the local bb server for bb Connect sessions",
    );
    return;
  }
  const logger = createDesktopLogger();
  enrollingDesktopMachine = (async () => {
    const result = await enrollDesktopMachine({ localServerUrl });
    if (!result.ok) {
      logger.info(
        `[desktop] could not enroll this app with bb Connect (${result.code}): ${result.detail}`,
      );
      return;
    }
    cachedConnectCredential = result.credential;
    await cache.write(result.credential);
    logger.info("[desktop] enrolled this app as a bb Connect machine");
  })().finally(() => {
    enrollingDesktopMachine = null;
  });
}

/**
 * Load the saved target and pin the session, config sync, and menu to it.
 *
 * The Server menu starts a switch without waiting, so two of these can overlap
 * and a slow one can finish last. Each run therefore claims a generation and
 * checks it after every wait: a run the user has already superseded stops
 * quietly instead of loading its own server over the newer one.
 */
async function applyServerTarget(): Promise<void> {
  if (serverTargetStore === null) {
    return;
  }
  const target = serverTargetStore.getTarget();
  // Retire the outgoing session before any await below. A renewal already in
  // flight would otherwise still read itself as current while this switch
  // runs, and its local-server fallback would undo the switch.
  connectSessionRenewal?.stop();
  serverTargetGeneration += 1;
  const generation = serverTargetGeneration;
  const isCurrent = (): boolean => serverTargetGeneration === generation;

  if (target.kind === "builtin") {
    const attached = await ensureBuiltinRuntimeAttached();
    if (!isCurrent()) {
      return;
    }
    if (!attached) {
      await loadStartupError({
        details:
          "Could not connect to the local bb server on this Mac. Check that the port is free or that a compatible bb server is running.",
        logs: "",
        title: "Could not connect",
      });
      refreshApplicationMenu();
      return;
    }
    const localServerUrl = currentRuntime?.serverUrl ?? builtinServerUrl;
    // Switching back from a remote target leaves that target's config poll
    // running, so re-pin the sync to the local server here.
    startSystemConfigSync(localServerUrl);
    await loadBbApp(
      resolveDesktopWindowUrl({
        env: process.env,
        serverUrl: localServerUrl,
      }),
    );
  } else if (target.kind === "connect") {
    // Connect servers load as plain web pages behind a session cookie. The
    // cookie comes from the app's own machine credential when it has one, so
    // no local bb server has to run.
    const result = await authenticateConnectTarget(
      target.server.url,
      isCurrent,
    );
    if (!isCurrent()) {
      return;
    }
    if (!result.ok) {
      createDesktopLogger().warn(
        `[desktop] Connect authentication failed (${result.code}): ${result.detail}`,
      );
      await loadStartupError({
        details:
          "The desktop app could not establish a session for this Connect server. " +
          `Try switching servers again. (${result.code}: ${result.detail})`,
        logs: "",
        title: "Could not authenticate with bb Connect",
      });
      refreshApplicationMenu();
      return;
    }
    connectSessionRenewal?.start({
      expiresAt: result.expiresAt,
      remoteServerUrl: target.server.url,
    });
    bbAppLoaded = true;
    await loadWindowUrl({ url: target.server.url });
    if (!isCurrent()) {
      return;
    }
    startRemoteSystemConfigSync(target.server.url);
  } else {
    // A custom server is a plain web load with no bb Connect involved.
    bbAppLoaded = true;
    await loadWindowUrl({ url: target.url });
    if (!isCurrent()) {
      return;
    }
    startRemoteSystemConfigSync(target.url);
  }
  refreshApplicationMenu();
}

async function setActiveServerTarget(serverId: string): Promise<void> {
  if (serverTargetStore === null) {
    return;
  }
  if (serverId.startsWith("connect:")) {
    const handle = serverId.slice("connect:".length);
    const server = listMenuConnectServers().find(
      (candidate) => candidate.handle === handle,
    );
    if (server === undefined) {
      refreshApplicationMenu();
      return;
    }
    await serverTargetStore.setConnectServer(server);
    await applyServerTarget();
    return;
  }
  if (serverId !== "builtin" && serverId !== "custom") {
    return;
  }
  const switched = await serverTargetStore.setTarget(serverId);
  if (!switched) {
    refreshApplicationMenu();
    return;
  }
  await applyServerTarget();
}

async function openSetServerUrlDialog(): Promise<void> {
  if (serverTargetStore === null || serverUrlDialogPreloadPath === null) {
    return;
  }
  const result = await openServerUrlDialog({
    initialUrl: serverTargetStore.getCustomServerUrl(),
    parentWindow: getFocusedApplicationWindow(),
    preloadPath: serverUrlDialogPreloadPath,
  });
  if (result.kind === "cancelled") {
    return;
  }
  if (
    result.kind === "clear" &&
    serverTargetStore.getCustomServerUrl() === null
  ) {
    return;
  }
  await serverTargetStore.setCustomServerUrl(
    result.kind === "set" ? result.url : null,
  );
  await applyServerTarget();
}

function sendLogViewerSnapshot(args: SendLogViewerSnapshotArgs): void {
  if (args.browserWindow.isDestroyed()) {
    return;
  }
  args.browserWindow.webContents.send(LOG_VIEWER_SNAPSHOT_CHANNEL, {
    lines: args.lines,
    logDir: args.logDir,
  });
}

function appendLogViewerLines(args: AppendLogViewerLinesArgs): void {
  if (args.lines.length === 0) {
    return;
  }

  logViewerLineBuffer?.append(args.lines);
}

function closeServerDaemonLogsWindow(): void {
  logViewerTailer?.stop();
  logViewerTailer = null;
  logViewerLineBuffer?.stop();
  logViewerLineBuffer = null;

  const browserWindow = logViewerWindow;
  logViewerWindow = null;
  if (browserWindow !== null && !browserWindow.isDestroyed()) {
    browserWindow.close();
  }
}

function handleCopyLogs(args: HandleCopyLogsArgs): void {
  const request = logViewerCopyRequestSchema.parse(args.request);
  clipboard.writeText(request.text);
}

async function handleOpenLogsFolder(): Promise<LogViewerOpenLogsFolderResult> {
  if (!shouldEnableServerDaemonLogsMenu()) {
    throw new Error(
      "Server and daemon logs are only available for owned runtimes",
    );
  }

  const logDir = formatLogDirectory();
  const errorMessage = await shell.openPath(logDir);
  if (errorMessage.length > 0) {
    throw new Error(errorMessage);
  }
  return { path: logDir };
}

function installLogViewerIpcHandlers(): void {
  if (logViewerIpcHandlersInstalled) {
    return;
  }
  logViewerIpcHandlersInstalled = true;
  ipcMain.handle(
    LOG_VIEWER_COPY_CHANNEL,
    (_event, request: LogViewerCopyRequest) => {
      handleCopyLogs({ request });
    },
  );
  ipcMain.handle(LOG_VIEWER_OPEN_LOGS_FOLDER_CHANNEL, () =>
    handleOpenLogsFolder(),
  );
}

async function loadLogViewerWindow(
  args: LoadLogViewerWindowArgs,
): Promise<void> {
  const browserWindow = new BrowserWindow({
    height: 720,
    minHeight: 520,
    minWidth: 840,
    show: false,
    title: "bb - Server & Daemon Logs",
    titleBarStyle: "default",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: args.preloadPath,
      sandbox: true,
    },
    width: 1180,
  });
  const tailer = createLogTailer({
    logDir: args.logDir,
    onLines(lines) {
      appendLogViewerLines({ lines });
    },
  });
  const lineBuffer = createLogLineBuffer({
    flushIntervalMs: LOG_VIEWER_IPC_BATCH_INTERVAL_MS,
    flushLineCount: LOG_VIEWER_IPC_BATCH_LINE_LIMIT,
    maxLines: LOG_VIEWER_VISIBLE_LINE_LIMIT,
    onFlush(lines) {
      if (logViewerWindow === null || logViewerWindow.isDestroyed()) {
        return;
      }
      logViewerWindow.webContents.send(LOG_VIEWER_APPEND_CHANNEL, {
        lines,
      });
    },
  });

  logViewerLineBuffer = lineBuffer;
  logViewerTailer = tailer;
  logViewerWindow = browserWindow;

  browserWindow.once("ready-to-show", () => {
    browserWindow.show();
  });
  browserWindow.on("closed", () => {
    if (logViewerTailer === tailer) {
      logViewerTailer = null;
      tailer.stop();
    }
    if (logViewerWindow === browserWindow) {
      logViewerWindow = null;
    }
    if (logViewerLineBuffer === lineBuffer) {
      logViewerLineBuffer = null;
    }
    lineBuffer.stop();
  });

  await browserWindow.loadURL(createLogViewerViewUrl({ logDir: args.logDir }));
  sendLogViewerSnapshot({
    browserWindow,
    lines: lineBuffer.lines(),
    logDir: args.logDir,
  });
  await tailer.start();
}

async function openServerDaemonLogs(): Promise<void> {
  if (!shouldEnableServerDaemonLogsMenu() || logViewerPreloadPath === null) {
    return;
  }

  if (logViewerWindow !== null && !logViewerWindow.isDestroyed()) {
    logViewerWindow.focus();
    return;
  }

  await loadLogViewerWindow({
    logDir: formatLogDirectory(),
    preloadPath: logViewerPreloadPath,
  });
}

async function loadWindowUrl(args: LoadWindowUrlArgs): Promise<void> {
  currentWindowUrl = args.url;
  if (desktopWindowFactory === null) {
    return;
  }

  await desktopWindowFactory.loadUrl({ url: args.url });
}

async function loadLoadingView(): Promise<void> {
  bbAppLoaded = false;
  await loadWindowUrl({
    url: createLocalViewUrl({
      viewModel: {
        kind: "loading",
        message: "Starting local services and opening the bb workspace.",
        title: "Opening bb",
      },
    }),
  });
}

async function loadStartupError(args: LoadStartupErrorArgs): Promise<void> {
  bbAppLoaded = false;
  await loadWindowUrl({
    url: createLocalViewUrl({
      viewModel: {
        details: `${args.details} Logs are under ${formatLogDirectory()}/.`,
        kind: "error",
        logText: args.logs,
        title: args.title,
      },
    }),
  });
}

async function loadBbApp(serverUrl: string): Promise<void> {
  bbAppLoaded = true;
  await loadWindowUrl({ url: serverUrl });
  if (shouldOpenDevTools()) {
    desktopWindowFactory?.openDevTools();
  }
}

function shouldOpenDevTools(): boolean {
  return process.env.BB_DESKTOP_OPEN_DEVTOOLS === "1";
}

async function createApplicationWindow(
  args: CreateApplicationWindowArgs,
): Promise<DesktopBrowserWindow | null> {
  if (desktopWindowFactory === null) {
    return null;
  }

  const browserWindow = await desktopWindowFactory.createWindow({
    initialUrl: args.initialUrl,
    stateKey: args.stateKey,
  });
  registerApplicationWindow(browserWindow);
  if (bbAppLoaded && shouldOpenDevTools()) {
    browserWindow.webContents.openDevTools({ mode: "detach" });
  }
  return browserWindow;
}

async function stopOwnedRuntime(): Promise<void> {
  const runtime = currentRuntime;
  if (runtime === null || runtime.ownership !== "spawned") {
    setCurrentRuntime(null);
    return;
  }

  setCurrentRuntime(null);
  try {
    await runtime.bbProcess?.stop({
      killSignal: "SIGKILL",
      killTimeoutMs: OWNED_RUNTIME_KILL_TIMEOUT_MS,
      signal: "SIGTERM",
      timeoutMs: OWNED_RUNTIME_STOP_TIMEOUT_MS,
    });
  } finally {
    if (runtime.userDataPath !== null) {
      await clearOwnedRuntimePidFile({ userDataPath: runtime.userDataPath });
    }
  }
}

function handleBeforeQuit(event: Event): void {
  quitting = true;
  if (stoppingForQuit) {
    return;
  }

  event.preventDefault();
  stoppingForQuit = true;
  void finishQuit().finally(() => {
    app.quit();
  });
}

async function finishQuit(): Promise<void> {
  stopSystemConfigSync();
  connectSessionRenewal?.stop();
  desktopUpdateService?.stop();
  desktopAutoUpdateService?.stop();
  desktopBrowserViewManager?.destroyAll();
  await desktopWindowFactory?.persistOpenWindows();
  await stopOwnedRuntime();
}

function registerDesktopUpdateIpc(): void {
  ipcMain.handle(BB_DESKTOP_GET_INFO_CHANNEL, () => {
    return getCurrentDesktopInfo();
  });
  ipcMain.handle(BB_DESKTOP_GET_WINDOW_STATE_CHANNEL, (event) => {
    return getSenderDesktopWindowState(event);
  });
  ipcMain.handle(BB_DESKTOP_CHECK_FOR_UPDATES_CHANNEL, async () => {
    await Promise.all([
      desktopUpdateService?.checkForUpdates() ?? Promise.resolve(null),
      desktopAutoUpdateService?.checkForUpdates() ?? Promise.resolve(null),
    ]);
    return getCurrentDesktopInfo();
  });
  ipcMain.handle(BB_DESKTOP_INSTALL_UPDATE_CHANNEL, async () => {
    if (desktopAutoUpdateService === null) {
      return;
    }
    if (!desktopAutoUpdateService.getInfo().updateDownloaded) {
      desktopAutoUpdateService.installUpdate();
      return;
    }
    // finishQuit stops the local runtime, and it cannot be undone. Re-check
    // that the swap can still succeed first: permissions may have changed
    // since startup, and on Linux a failed swap would otherwise leave a shell
    // with no runtime and no application file.
    const appImagePath = process.env.APPIMAGE?.trim() ?? "";
    if (
      process.platform === "linux" &&
      (appImagePath.length === 0 || !canReplaceAppImage(appImagePath))
    ) {
      createDesktopLogger().error(
        `Desktop update install skipped: ${appImagePath || "this build"} cannot be replaced in place. The runtime stays up; download the new AppImage instead.`,
      );
      return;
    }
    quitting = true;
    stoppingForQuit = true;
    await finishQuit();
    desktopAutoUpdateService.installUpdate();
  });
  // Renderer pushes the bb theme preference so the NSWindow appearance —
  // traffic lights and inactive title-bar chrome — follows an explicit bb
  // theme or the OS when set to system. `themeSource` is app-global so a
  // single assignment covers every BrowserWindow, including the log viewer.
  ipcMain.on(BB_DESKTOP_SET_THEME_CHANNEL, (_event, payload: unknown) => {
    const parsed = bbDesktopThemeSchema.safeParse(payload);
    if (!parsed.success) {
      return;
    }
    nativeTheme.themeSource = parsed.data;
  });

  ipcMain.on(BB_DESKTOP_CLOSE_WINDOW_RESPONSE_CHANNEL, (event, payload) => {
    const pending = pendingCloseWindowRequests.get(event.sender.id);
    if (pending !== undefined) {
      clearTimeout(pending);
      pendingCloseWindowRequests.delete(event.sender.id);
    }
    if (payload === false) {
      resolveApplicationWindow(event.sender)?.close();
    }
  });
  // The in-app browser tab hands off the current address to the system
  // browser. The URL originates from a possibly-hostile page, so only open
  // well-formed `http(s)` URLs — never `file:`, custom schemes, or junk.
  ipcMain.on(
    BB_DESKTOP_OPEN_EXTERNAL_URL_CHANNEL,
    (_event, payload: unknown) => {
      if (typeof payload !== "string") {
        return;
      }
      let parsed: URL;
      try {
        parsed = new URL(payload);
      } catch {
        return;
      }
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return;
      }
      void shell.openExternal(parsed.toString());
    },
  );
}

interface DesktopBrowserWindowLifecycleArgs {
  browserWindow: BrowserWindow;
  manager: DesktopBrowserViewManager;
}

/**
 * After the last `resize` tick of a burst, wait this long before revealing the
 * browser views again. Long enough for the renderer's post-resize relayout and
 * bounds push (~100-150ms on a large window) to land first, short enough that
 * the overlay does not feel missing once the window is at rest. Manual drags
 * usually end through the `resized` event instead and never wait this out.
 */
const WINDOW_RESIZE_SETTLE_MS = 200;

function registerDesktopBrowserWindowLifecycle({
  browserWindow,
  manager,
}: DesktopBrowserWindowLifecycleArgs): void {
  const hostWebContentsId = browserWindow.webContents.id;
  let resizeSettleTimer: NodeJS.Timeout | null = null;
  const endWindowResize = () => {
    if (resizeSettleTimer !== null) {
      clearTimeout(resizeSettleTimer);
      resizeSettleTimer = null;
    }
    if (!browserWindow.isDestroyed()) {
      manager.endWindowResize(browserWindow);
    }
  };
  // During a native window resize the host chrome repaints at its own (much
  // slower) cadence while the native browser views composite independently, so
  // no bounds protocol keeps a view visually inside its panel mid-drag. Hide
  // the views for the duration of the resize burst — the chrome's own panel
  // background shows in their place, always exactly where the chrome painted
  // it — and reveal them at the settled bounds afterwards. `resized` ends a
  // manual drag immediately on mouse release; the settle timer covers
  // programmatic resize streams (maximize animations, setBounds), which never
  // emit `resized`.
  browserWindow.on("resize", () => {
    manager.beginWindowResize(browserWindow);
    if (resizeSettleTimer !== null) {
      clearTimeout(resizeSettleTimer);
    }
    resizeSettleTimer = setTimeout(endWindowResize, WINDOW_RESIZE_SETTLE_MS);
  });
  browserWindow.on("resized", endWindowResize);
  browserWindow.once("closed", () => {
    if (resizeSettleTimer !== null) {
      clearTimeout(resizeSettleTimer);
      resizeSettleTimer = null;
    }
    manager.releaseWindow(hostWebContentsId);
  });
}

async function startOwnedRuntime(
  args: StartOwnedRuntimeArgs,
): Promise<DesktopRuntime | null> {
  const bbProcess = startBbAppProcess({
    bridgePath: args.bridgePath,
    cwd: homedir(),
    env: {
      ...process.env,
      [APP_SURFACE_ENV_NAME]: APP_SURFACE_DESKTOP,
    },
    logLineLimit: PROCESS_LOG_LINE_LIMIT,
    runtime: resolveBbAppProcessRuntime({
      env: process.env,
      isPackaged: app.isPackaged,
      processExecPath: process.execPath,
    }),
  });
  const runtime: DesktopRuntime = {
    bbProcess,
    ownership: "spawned",
    serverUrl: args.serverUrl,
    userDataPath: args.userDataPath,
  };
  await writeOwnedRuntimePidFile({
    bridgePath: args.bridgePath,
    pid: bbProcess.pid,
    serverUrl: args.serverUrl,
    userDataPath: args.userDataPath,
  });
  setCurrentRuntime(runtime);

  void bbProcess.exit.then((exit) => {
    void clearOwnedRuntimePidFile({ userDataPath: args.userDataPath });
    if (quitting || currentRuntime !== runtime) {
      return;
    }
    setCurrentRuntime(null);
    void loadStartupError({
      details: `The Electron-owned bb-app process stopped with ${formatExitResult(
        exit,
      )}.`,
      logs: bbProcess.logs.text(),
      title: "bb stopped",
    });
  });

  const raceResult = await Promise.race<StartupRaceResult>([
    waitForCompatibleServer({
      intervalMs: STARTUP_POLL_INTERVAL_MS,
      serverUrl: args.serverUrl,
      timeoutMs: STARTUP_TIMEOUT_MS,
    }).then((result) => ({
      kind: "server-probe",
      result,
    })),
    bbProcess.exit.then((exit) => ({
      exit,
      kind: "process-exited",
    })),
  ]);

  if (raceResult.kind === "process-exited") {
    await loadStartupError({
      details: `bb-app exited before the server was ready with ${formatExitResult(
        raceResult.exit,
      )}.`,
      logs: bbProcess.logs.text(),
      title: "Could not start bb",
    });
    setCurrentRuntime(null);
    return null;
  }

  if (raceResult.result.kind === "compatible") {
    return runtime;
  }

  await loadStartupError({
    details:
      raceResult.result.kind === "incompatible"
        ? `Port ${args.serverUrl} is responding, but it does not look like bb: ${raceResult.result.reason}.`
        : `Timed out waiting for bb at ${args.serverUrl}: ${raceResult.result.reason}.`,
    logs: bbProcess.logs.text(),
    title: "Could not start bb",
  });
  await stopOwnedRuntime();
  return null;
}

interface InitializeRuntimeArgs {
  bridgePath: string;
  serverUrl: string;
  userDataPath: string;
}

/**
 * Attaching to a bb this app did not start is invisible to the person using it,
 * so ask first. Local development stays silent, because attaching to a
 * `pnpm dev` server is the whole point there.
 *
 * `BB_DESKTOP_ATTACH_WITHOUT_PROMPT` exists for the packaged smoke test, which
 * points a packaged build at a stub server and has no one to click the dialog.
 * It is deliberately opt-in and never set by the app itself: the prompt is a
 * safety boundary, so suppressing it must be an explicit act by the harness.
 */
function shouldAskBeforeAttaching(): boolean {
  if (!app.isPackaged || existingServerDialogPreloadPath === null) {
    return false;
  }
  if (process.env.BB_DESKTOP_ATTACH_WITHOUT_PROMPT === "1") {
    return false;
  }
  return (process.env.BB_DESKTOP_APP_URL ?? "").trim().length === 0;
}

/**
 * Wait for the port to close after the other copy was told to stop. A new
 * server cannot bind a port that the old process still holds.
 */
async function waitForServerToStop(serverUrl: string): Promise<boolean> {
  const deadline = Date.now() + FOREIGN_RUNTIME_STOP_TIMEOUT_MS;
  while (Date.now() <= deadline) {
    const probe = await probeBbServer({
      serverUrl,
      timeoutMs: ATTACH_PROBE_TIMEOUT_MS,
    });
    if (probe.kind === "unavailable") {
      return true;
    }
    await new Promise<void>((resolvePromise) => {
      setTimeout(resolvePromise, STARTUP_POLL_INTERVAL_MS);
    });
  }
  return false;
}

type ExistingServerDecision = "attach" | "quit" | "start-fresh";

async function decideOnExistingServer(
  probe: CompatibleServerProbeResult,
): Promise<ExistingServerDecision> {
  if (!shouldAskBeforeAttaching()) {
    return "attach";
  }

  const preloadPath = existingServerDialogPreloadPath;
  if (preloadPath === null) {
    return "attach";
  }

  const details = await readForeignRuntimeDetails({
    dataDir: probe.dataDir,
    serverUrl: probe.serverUrl,
  });
  const choice = await openExistingServerDialog({
    details,
    parentWindow: getFocusedApplicationWindow(),
    preloadPath,
    serverUrl: probe.serverUrl,
  });

  if (choice === "quit") {
    return "quit";
  }
  if (choice === "connect" || details === null) {
    return "attach";
  }

  const stopResult = await stopForeignRuntime({
    details,
    killTimeoutMs: FOREIGN_RUNTIME_KILL_TIMEOUT_MS,
    timeoutMs: FOREIGN_RUNTIME_STOP_TIMEOUT_MS,
  });
  if (stopResult.kind === "unverified") {
    await loadStartupError({
      details:
        `The bb at ${probe.serverUrl} records process ${String(stopResult.pid)}, but that ` +
        "process no longer matches the record. bb did not stop it. Stop it yourself, then open bb again.",
      logs: "",
      title: "Could not stop the running bb",
    });
    return "quit";
  }
  if (stopResult.kind === "still-running") {
    await loadStartupError({
      details: `bb could not stop process ${String(stopResult.pid)}, even after SIGKILL.`,
      logs: "",
      title: "Could not stop the running bb",
    });
    return "quit";
  }
  if (stopResult.kind === "replaced") {
    await loadStartupError({
      details:
        `Another bb started at ${probe.serverUrl} while the question was open, so bb stopped nothing. ` +
        "Open bb again to see the copy that runs now.",
      logs: "",
      title: "Could not stop the running bb",
    });
    return "quit";
  }
  if (!(await waitForServerToStop(probe.serverUrl))) {
    await loadStartupError({
      details: `The bb at ${probe.serverUrl} stopped, but the address is still in use.`,
      logs: "",
      title: "Could not stop the running bb",
    });
    return "quit";
  }
  return "start-fresh";
}

async function initializeRuntime(args: InitializeRuntimeArgs): Promise<void> {
  const existingProbe = await probeBbServer({
    serverUrl: args.serverUrl,
    timeoutMs: ATTACH_PROBE_TIMEOUT_MS,
  });

  if (existingProbe.kind === "compatible") {
    const decision = await decideOnExistingServer(existingProbe);
    if (decision === "quit") {
      app.quit();
      return;
    }
    if (decision === "start-fresh") {
      await loadLoadingView();
      const freshRuntime = await startOwnedRuntime({
        bridgePath: args.bridgePath,
        serverUrl: args.serverUrl,
        userDataPath: args.userDataPath,
      });
      if (freshRuntime !== null) {
        await loadBbApp(freshRuntime.serverUrl);
        startSystemConfigSync(freshRuntime.serverUrl);
        refreshApplicationMenu();
      }
      return;
    }

    setCurrentRuntime({
      bbProcess: null,
      ownership: "attached",
      serverUrl: existingProbe.serverUrl,
      userDataPath: null,
    });
    // When attaching to an already-running server (the `pnpm dev` case) load the
    // Vite dev URL if the launcher provided one, so the shell gets live source
    // and HMR. The attached server still handles every API/WS request.
    await loadBbApp(
      resolveDesktopWindowUrl({
        env: process.env,
        serverUrl: existingProbe.serverUrl,
      }),
    );
    startSystemConfigSync(existingProbe.serverUrl);
    refreshApplicationMenu();
    return;
  }

  if (existingProbe.kind === "incompatible") {
    await loadStartupError({
      details: `Port ${args.serverUrl} is already in use, but it is not a compatible bb server: ${existingProbe.reason}.`,
      logs: "",
      title: "Port conflict",
    });
    return;
  }

  const runtime = await startOwnedRuntime({
    bridgePath: args.bridgePath,
    serverUrl: args.serverUrl,
    userDataPath: args.userDataPath,
  });
  if (runtime !== null) {
    await loadBbApp(runtime.serverUrl);
    startSystemConfigSync(runtime.serverUrl);
    refreshApplicationMenu();
  }
}

async function runDesktopApp(): Promise<void> {
  ensurePackagedUserShellPath({
    env: process.env,
    isPackaged: app.isPackaged,
    logger: createDesktopLogger(),
    platform: process.platform,
  });

  app.setName(app.isPackaged ? DESKTOP_RELEASE_INFO.applicationName : "bb-dev");

  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }

  app.on("second-instance", () => {
    if (desktopWindowFactory?.focusFirstWindow() === true) {
      return;
    }
    void createApplicationWindow({
      initialUrl: currentWindowUrl,
      stateKey: null,
    });
  });
  app.on("before-quit", handleBeforeQuit);
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });
  app.on("activate", () => {
    if (desktopWindowFactory?.hasOpenWindows() === false) {
      void createApplicationWindow({
        initialUrl: currentWindowUrl,
        stateKey: null,
      });
    }
  });
  app.on("did-become-active", () => {
    void desktopUpdateService?.checkAfterActive();
    void desktopAutoUpdateService?.checkAfterActive();
    // A remote target has no realtime socket for config changes.
    refreshRemoteSystemConfig?.();
    connectSessionRenewal?.renewIfDue();
  });
  app.on("browser-window-created", (_event, browserWindow) => {
    if (desktopBrowserViewManager === null) {
      return;
    }
    registerDesktopBrowserWindowLifecycle({
      browserWindow,
      manager: desktopBrowserViewManager,
    });
  });
  registerDesktopShutdownSignalHandlers({
    exitProcess(code) {
      process.exitCode = code;
    },
    processEvents: process,
    quitApplication() {
      app.quit();
    },
    state: createDesktopShutdownState(),
    async stopOwnedRuntime() {
      quitting = true;
      await stopOwnedRuntime();
    },
  });

  await app.whenReady();
  await clearPackagedSessionHttpCache({
    isPackaged: app.isPackaged,
    session: session.defaultSession,
  });

  const paths = createDesktopPathContext();
  const iconPath = resolveDesktopIconPath({
    packagedIconFileName: DESKTOP_RELEASE_INFO.iconFileName,
    paths,
  });
  const bridgePath = resolveDesktopBridgePath({ paths });
  const resolvedLogViewerPreloadPath = join(
    paths.appPath,
    "dist",
    "log-viewer-preload.cjs",
  );
  const preloadPath = join(paths.appPath, "dist", "preload.cjs");
  const resolvedExistingServerDialogPreloadPath = join(
    paths.appPath,
    "dist",
    "existing-server-dialog-preload.cjs",
  );
  const resolvedServerUrlDialogPreloadPath = join(
    paths.appPath,
    "dist",
    "server-url-dialog-preload.cjs",
  );
  const serverUrl = resolveDesktopServerUrl({ env: process.env });
  builtinServerUrl = serverUrl;
  desktopBridgePath = bridgePath;
  const desktopVersion = getDesktopVersion(process.env.BB_DESKTOP_VERSION);
  const desktopPlatform = resolveBbDesktopPlatform(process.platform);
  const desktopUpdateFeedUrl = resolveDesktopUpdateFeedUrl({
    env: process.env,
    platform: desktopPlatform,
  });
  const userDataPath = app.getPath("userData");
  desktopUserDataPath = userDataPath;

  assertPathExists({ label: "bb-app bridge", path: bridgePath });
  assertPathExists({
    label: "existing server dialog preload script",
    path: resolvedExistingServerDialogPreloadPath,
  });
  assertPathExists({
    label: "log viewer preload script",
    path: resolvedLogViewerPreloadPath,
  });
  assertPathExists({ label: "preload script", path: preloadPath });
  assertPathExists({
    label: "server URL dialog preload script",
    path: resolvedServerUrlDialogPreloadPath,
  });
  assertPathExists({ label: "app icon", path: iconPath });

  // Packaged builds must not call dock.setIcon: it replaces the bundle icon
  // (already channel-correct via electron-builder) with a raw NSImage that
  // bypasses the macOS appearance pipeline, so dark mode shows the light
  // rendering. Dev runs still need it to show icon-dev.png instead of the
  // stock Electron icon.
  if (
    process.platform === "darwin" &&
    app.dock !== undefined &&
    !paths.isPackaged
  ) {
    app.dock.setIcon(iconPath);
  }
  await reapStaleOwnedRuntime({
    signal: "SIGTERM",
    timeoutMs: 5_000,
    userDataPath,
  });

  serverTargetStore = createServerTargetStore({
    storagePath: join(userDataPath, SERVER_TARGET_FILE_NAME),
  });
  await serverTargetStore.load();
  connectCredentialCache = createConnectCredentialCache({
    encryption: safeStorage,
    userDataPath,
  });
  cachedConnectCredential = await connectCredentialCache.read();
  const logger = createDesktopLogger();
  connectServerSync = createConnectServerSync({
    getCredential: () => cachedConnectCredential,
    getLocalServerUrl: () => currentRuntime?.serverUrl ?? null,
    onUnauthorized() {
      void clearCachedConnectCredential();
    },
    onServers(servers) {
      connectAccountServers = servers;
      const selected = serverTargetStore?.getConnectServer() ?? null;
      const synced = servers.find(
        (server) => server.handle === selected?.handle,
      );
      if (synced !== undefined) {
        void serverTargetStore?.refreshConnectServer({
          handle: synced.handle,
          name: synced.name,
          url: synced.url,
        });
      }
      refreshApplicationMenu();
    },
    log: (message) => {
      logger.info(`[desktop] ${message}`);
    },
  });
  connectServerSync.start();
  connectSessionRenewal = createConnectSessionRenewal({
    async authenticate(remoteServerUrl, isCurrent) {
      const result = await authenticateConnectTarget(
        remoteServerUrl,
        isCurrent,
      );
      return result.ok
        ? result
        : { detail: `${result.code}: ${result.detail}`, ok: false };
    },
    log: (message) => {
      logger.warn(`[desktop] ${message}`);
    },
  });

  const desktopUpdateSupport = resolveDesktopUpdateSupport({
    canReplaceAppImage,
    env: process.env,
    platform: desktopPlatform,
  });
  desktopUpdateService = createDesktopUpdateService({
    channel: DESKTOP_UPDATE_CHANNEL,
    currentVersion: desktopVersion,
    enabled:
      desktopUpdateSupport.versionCheck &&
      (app.isPackaged || process.env.BB_DESKTOP_VERSION_CHECK === "1"),
    feedUrl: desktopUpdateFeedUrl,
    logger: createDesktopLogger(),
    platform: desktopPlatform,
  });
  desktopAutoUpdateService = createDesktopAutoUpdateService({
    currentVersion: desktopVersion,
    enabled:
      desktopUpdateSupport.autoUpdate &&
      shouldEnableDesktopAutoUpdate({
        env: process.env,
        isPackaged: app.isPackaged,
      }),
    forceDevUpdateConfig:
      !app.isPackaged && process.env.BB_DESKTOP_AUTO_UPDATE === "1",
    logger: createDesktopLogger(),
    platform: desktopPlatform,
    updater: createElectronAutoUpdaterAdapter(autoUpdater),
  });
  desktopUpdateService.subscribe(() => {
    sendDesktopInfoChanged();
  });
  desktopAutoUpdateService.subscribe(() => {
    sendDesktopInfoChanged();
  });
  registerDesktopUpdateIpc();
  desktopBrowserViewManager = createDesktopBrowserViewManager({
    dispatchAppCommand({ command, hostWebContentsId }) {
      const browserWindow = BrowserWindow.getAllWindows().find(
        (candidate) => candidate.webContents.id === hostWebContentsId,
      );
      if (browserWindow === undefined) {
        return;
      }
      sendToApplicationRenderer(
        browserWindow,
        BB_DESKTOP_APP_COMMAND_CHANNEL,
        command,
      );
    },
    focusHostWebContents(hostWebContentsId) {
      const browserWindow = BrowserWindow.getAllWindows().find(
        (candidate) => candidate.webContents.id === hostWebContentsId,
      );
      if (browserWindow !== undefined) {
        browserWindow.webContents.focus();
      }
    },
    resolveAppCommand(input) {
      return resolveDesktopBrowserAppCommand({
        input,
        isMac: process.platform === "darwin",
        keybindings: currentAppKeybindings,
      });
    },
  });
  registerDesktopBrowserIpc(desktopBrowserViewManager);
  if (desktopUpdateSupport.versionCheck) {
    desktopUpdateService.start();
  }
  if (desktopUpdateSupport.autoUpdate) {
    desktopAutoUpdateService.start();
  } else {
    logger.info(
      "Desktop auto-install is disabled: only the Linux AppImage build can replace itself. Version checks still report new releases.",
    );
  }

  const browserWindowCreator: DesktopBrowserWindowCreator = {
    create(options) {
      return new BrowserWindow(options);
    },
  };
  logViewerPreloadPath = resolvedLogViewerPreloadPath;
  serverUrlDialogPreloadPath = resolvedServerUrlDialogPreloadPath;
  existingServerDialogPreloadPath = resolvedExistingServerDialogPreloadPath;
  desktopWindowFactory = createDesktopWindowFactory({
    browserWindowCreator,
    createWindowStateKey() {
      return `window-${randomUUID()}`;
    },
    displayWorkAreas: null,
    icon: nativeImage.createFromPath(iconPath),
    isMac: process.platform === "darwin",
    isQuitting() {
      return quitting;
    },
    openExternalUrl(openArgs) {
      void shell.openExternal(openArgs.url);
    },
    preloadPath,
    userDataPath,
  });
  installLogViewerIpcHandlers();

  refreshApplicationMenu();
  await loadLoadingView();
  const restoredWindows = await desktopWindowFactory.restoreSavedWindows({
    initialUrl: currentWindowUrl,
  });
  for (const browserWindow of restoredWindows) {
    registerApplicationWindow(browserWindow);
  }
  if (serverTargetStore.getTarget().kind === "builtin") {
    await initializeRuntime({ bridgePath, serverUrl, userDataPath });
  } else {
    // A saved remote target needs no bb server on this Mac: the session cookie
    // and the account server list both come from bb Connect. The local server
    // starts only when the user switches back to "This Mac", or when this app
    // has no credential of its own yet.
    await applyServerTarget();
    connectServerSync.syncNow().catch(() => {});
  }
}

void runDesktopApp().catch((error) => {
  const message =
    error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`${message}\n`);
  void loadStartupError({
    details: message,
    logs: "",
    title: "Could not open bb",
  });
});
