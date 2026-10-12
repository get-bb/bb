import { registerServerChoiceIpc } from "./server-choice-ipc.js";
import { randomUUID } from "node:crypto";
import { accessSync, constants as fsConstants } from "node:fs";
import { arch, homedir, release, type as osType } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  net,
  safeStorage,
  session as electronSession,
  shell,
  webContents as electronWebContents,
  type Event,
  type IpcMainInvokeEvent,
  type MessageBoxOptions,
  type WebContents,
} from "electron";
import { autoUpdater } from "electron-updater";
import {
  APP_SURFACE_DESKTOP,
  APP_SURFACE_ENV_NAME,
} from "@bb/config/app-surface";
import { findMachineServiceFile } from "@bb/config/machine-service";
import {
  deriveConnectBaseUrl,
  type ConnectCredential,
} from "@bb/connect-client";
import {
  appCommandIdSchema,
  type AppCommandId,
  type AppKeybindings,
} from "@bb/domain";
import {
  bbDesktopBrowserImportCookiesRequestSchema,
  bbDesktopThemeSchema,
  type BbDesktopInfo,
  type BbDesktopTheme,
  type BbDesktopWindowState,
} from "@bb/desktop-contract";
import {
  serverMessageLenientSchema,
  type ClientMessage,
} from "@bb/server-contract";
import { z } from "zod";
import { registerDesktopClipboardIpc } from "./desktop-clipboard.js";
import { registerDesktopWindowFocusIpc } from "./desktop-window-focus.js";
import {
  assertPathExists,
  resolveDesktopBridgePath,
  resolveDesktopIconPath,
  resolveDesktopMachineInstallerPath,
  type DesktopPathContext,
} from "./app-paths.js";
import {
  keepMovedMachineConnected,
  MACHINE_SERVICE_INSTALL_LOG_FILE_NAME,
  MACHINE_SERVICE_NOTICE_FILE_NAME,
  runMachineInstaller,
} from "./moved-machine-service.js";
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
import {
  createLocalViewUrl,
  STARTUP_ACTION_CHANNEL,
  startupActionIdSchema,
  type StartupAction,
  type StartupActionId,
} from "./local-view.js";
import {
  createServerMenuItems,
  installApplicationMenu,
  type ServerMenuArgs,
} from "./menu.js";
import {
  DEFAULT_APPLICATION_MENU_ACCELERATORS,
  resolveApplicationMenuAccelerators,
  type ApplicationMenuAccelerators,
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
import { loadRemoteServerPage } from "./remote-server-load.js";
import {
  applyServerMove,
  createServerMovedWatcher,
  createServerMoveNoticeStore,
  ensureServerMovedRuntime,
  hasLiveBbAppLauncher,
  probeLocalServerMove,
  readServerMovedConnectCredential,
  readServerMovedLock,
  SERVER_MOVE_COMMIT_INTERVAL_MS,
  SERVER_MOVE_COMMIT_TIMEOUT_MS,
  SERVER_MOVE_DESTINATION_INTERVAL_MS,
  SERVER_MOVE_DESTINATION_TIMEOUT_MS,
  SERVER_MOVE_NOTICE_FILE_NAME,
  SERVER_MOVED_POLL_INTERVAL_MS,
  SERVER_MOVED_WATCH_DEBOUNCE_MS,
  waitForCommittedServerMove,
  waitForServerMoveDestination,
  type DesktopServerMove,
  type ServerMovedNotice,
  type ServerMovedWatcher,
  type ServerMoveNoticeStore,
} from "./server-moved.js";
import {
  BUILTIN_SERVER_NAME,
  createServerTargetStore,
  isSameServerTarget,
  SERVER_TARGET_FILE_NAME,
  type ConnectServerRef,
  type DesktopServerTarget,
  type ServerTargetStore,
} from "./server-target.js";
import {
  buildDesktopServerChoices,
  listDesktopServerTargets,
  serverTargetId,
  serverTargetName,
} from "./server-list.js";
import {
  formatApplicationWindowTitle,
  shouldShowServerInWindowTitles,
} from "./window-title.js";
import { openServerUrlDialog } from "./server-url-dialog.js";
import {
  createConnectServerSync,
  type ConnectAccountServer,
  type ConnectServerSync,
  type ConnectServerSyncSkipReason,
} from "./connect-server-sync.js";
import {
  createAccountCookieSource,
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
import { registerDesktopShutdownSignalHandlers } from "./desktop-shutdown.js";
import {
  createDesktopWindowFactory,
  type CreatedDesktopWindow,
  type DesktopBrowserWindow,
  type DesktopBrowserWindowCreator,
  type DesktopWindowFactory,
} from "./desktop-window-factory.js";
import {
  hasLinuxWindowArgument,
  LINUX_FRAMELESS_WINDOW_ARGUMENT,
  LINUX_TRANSPARENT_WINDOW_ARGUMENT,
} from "./desktop-linux-window-options.js";
import {
  createDesktopAboutDialogOptions,
  createDesktopAboutPanelOptions,
  type DesktopAboutFacts,
} from "./desktop-about-panel.js";
import { registerDesktopContextMenu } from "./desktop-context-menu.js";
import {
  getDesktopVersion,
  resolveBbDesktopPlatform,
} from "./desktop-platform.js";
import { createDesktopUpdateService } from "./desktop-update-check.js";
import {
  createDesktopUpdateFeedUrl,
  DESKTOP_RELEASE_CHANNEL,
  DESKTOP_RELEASE_INFO,
  resolveDesktopUpdateSupport,
} from "./desktop-update-provider.js";
import type { DesktopUpdateService } from "./desktop-update-scheduler.js";
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
  BB_DESKTOP_ZOOM_COMMAND_CHANNEL,
} from "./desktop-update-ipc.js";
import {
  BB_DESKTOP_SERVER_CHOICES_CHANGED_CHANNEL,
  BB_DESKTOP_APP_COMMAND_CHANNEL,
  BB_DESKTOP_OPEN_WINDOW_FIND_CHANNEL,
  BB_DESKTOP_RELOAD_WINDOW_CHANNEL,
  BB_DESKTOP_SET_SPLIT_NAVIGATION_ENABLED_CHANNEL,
  BB_DESKTOP_CLOSE_WINDOW_REQUEST_CHANNEL,
  BB_DESKTOP_CLOSE_WINDOW_RESPONSE_CHANNEL,
  BB_DESKTOP_GET_WINDOW_STATE_CHANNEL,
  BB_DESKTOP_OPEN_NEW_TAB_CHANNEL,
  BB_DESKTOP_OPEN_DATA_DIRECTORY_CHANNEL,
  BB_DESKTOP_OPEN_SERVER_DAEMON_LOGS_CHANNEL,
  BB_DESKTOP_WINDOW_STATE_CHANGED_CHANNEL,
  CLOSE_WINDOW_REQUEST_TIMEOUT_MS,
} from "./desktop-window-command-ipc.js";
import {
  createDesktopBrowserViewManager,
  type DesktopBrowserViewManager,
} from "./desktop-browser-view.js";
import { removeLegacyAutomationPartitions } from "./desktop-browser-legacy-partitions.js";
import { resolveDesktopBrowserAppCommand } from "./desktop-browser-shortcuts.js";
import { registerDesktopBrowserIpc } from "./desktop-browser-main-ipc.js";
import { resolveDesktopExternalUrl } from "./desktop-external-url.js";
import {
  createDesktopFindViewManager,
  type DesktopFindViewManager,
} from "./desktop-find-view.js";
import { createBrowserImportService } from "./browser-import/browser-import.js";
import { readMacAppIcon } from "./browser-import/mac-app-icon.js";
import {
  createDesktopBrowserBroker,
  type DesktopBrowserBroker,
} from "./desktop-browser-broker.js";
import { createDesktopBrowserBrokerClient } from "./desktop-browser-broker-client.js";
import {
  bbDesktopBrowserTabRefSchema,
  bbDesktopZoomCommandSchema,
  bbDesktopWindowFindRequestSchema,
  type BbDesktopZoomCommand,
} from "@bb/desktop-contract";
import { nextZoomFactor } from "./desktop-zoom.js";
import {
  BB_DESKTOP_BROWSER_TARGET_CHANNEL,
  BB_DESKTOP_BROWSER_GET_CONTROL_CHANNEL,
  BB_DESKTOP_BROWSER_RELEASE_CONTROL_CHANNEL,
  BB_DESKTOP_BROWSER_LIST_IMPORT_SOURCES_CHANNEL,
  BB_DESKTOP_BROWSER_IMPORT_COOKIES_CHANNEL,
  BB_DESKTOP_BROWSER_OPEN_FULL_DISK_ACCESS_SETTINGS_CHANNEL,
} from "./desktop-browser-ipc.js";
import { parseDesktopSystemConfig } from "./desktop-system-config.js";
import { ensurePackagedUserShellPath } from "./desktop-shell-path.js";
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
  actions: StartupAction[];
  details: string;
  logs: string;
  title: string;
}

interface StartupErrorPage {
  actions: StartupActionId[];
  url: string;
}

interface ApplicationWindowSession {
  actionPage: StartupErrorPage | null;
  actionPending: boolean;
  appLoaded: boolean;
  awaitingConnectSignIn: boolean;
  browserWindow: BrowserWindow;
  generation: number;
  pageTitle: string;
  stateKey: WindowStateKey;
  target: DesktopServerTarget;
  themePreference: BbDesktopTheme | null;
  webContentsId: number;
}

interface OpenApplicationWindowArgs {
  stateKey: WindowStateKey | null;
  target: DesktopServerTarget;
}

interface OpenSetServerUrlDialogArgs {
  edit: boolean;
  session: ApplicationWindowSession | null;
}

interface EnsureBuiltinRuntimeArgs {
  startup: boolean;
}

type BuiltinRuntimeResult =
  | { error: LoadStartupErrorArgs; kind: "failed" }
  | { kind: "moved" }
  | { kind: "quitting" }
  | { kind: "ready"; serverUrl: string };

type OwnedRuntimeStartResult =
  | { error: LoadStartupErrorArgs; kind: "failed" }
  | { kind: "ready"; runtime: DesktopRuntime };

type DesktopBrowserBrokerClient = ReturnType<
  typeof createDesktopBrowserBrokerClient
>;

interface StartOwnedRuntimeArgs {
  bridgePath: string;
  serverUrl: string;
  userDataPath: string;
}

interface OwnedRuntime {
  bbProcess: BbAppProcess;
  runtime: DesktopRuntime;
}

interface SendLogViewerSnapshotArgs {
  browserWindow: BrowserWindow;
  lines: LogViewerLine[];
  logDir: string;
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

interface SystemConfigRequestArgs {
  fetchImpl: typeof fetch;
  serverUrl: string;
}

interface SystemConfigSync {
  refresh(): void;
  stop(): void;
}

const logViewerCopyRequestSchema = z
  .object({
    text: z.string(),
  })
  .strict();

let desktopWindowFactory: DesktopWindowFactory | null = null;
let desktopBrowserViewManager: DesktopBrowserViewManager | null = null;
let desktopFindViewManager: DesktopFindViewManager | null = null;
let desktopBrowserBroker: DesktopBrowserBroker | null = null;
const desktopBrowserBrokerClients = new Map<
  string,
  DesktopBrowserBrokerClient
>();
const keybindingsByServerUrl = new Map<string, AppKeybindings>();
let desktopUpdateService: DesktopUpdateService | null = null;
let desktopAutoUpdateService: DesktopAutoUpdateService | null = null;
let currentRuntime: DesktopRuntime | null = null;
let builtinRuntimeRequest: Promise<BuiltinRuntimeResult> | null = null;
let logViewerLineBuffer: LogLineBuffer | null = null;
let logViewerPreloadPath: string | null = null;
let logViewerTailer: LogTailer | null = null;
let logViewerWindow: BrowserWindow | null = null;
const systemConfigSyncs = new Map<string, SystemConfigSync>();
const applicationWindowWebContentsIds = new Set<number>();
const windowSessions = new Map<number, ApplicationWindowSession>();
let lastFocusedWebContentsId: number | null = null;
const splitNavigationEnabledWebContentsIds = new Set<number>();
const splitNavigationCommandsByWebContentsId = new Map<
  number,
  readonly AppCommandId[]
>();
let connectSignInWindow: BrowserWindow | null = null;
let stoppingForQuit = false;
let quitting = false;
let serverTargetStore: ServerTargetStore | null = null;
let connectServerSync: ConnectServerSync | null = null;
let connectCredentialCache: ConnectCredentialCache | null = null;
let cachedConnectCredential: ConnectCredential | null = null;
let enrollingDesktopMachine: Promise<void> | null = null;
const connectSessionRenewals = new Map<string, ConnectSessionRenewal>();
const connectAuthentications = new Map<
  string,
  Promise<ConnectDesktopSessionResult>
>();
let connectAccountServers: ConnectAccountServer[] = [];
let connectServerSyncSkipReason: ConnectServerSyncSkipReason | null = null;
let builtinServerUrl: string = DEFAULT_BB_SERVER_URL;
let desktopBridgePath: string | null = null;
let desktopUserDataPath: string | null = null;
let builtinDataDir: string | null = null;
let serverMoveNoticeStore: ServerMoveNoticeStore | null = null;
let machineServiceNoticeStore: ServerMoveNoticeStore | null = null;
let movedMachineConnection: Promise<void> | null = null;
let localServerMove: DesktopServerMove | null = null;
let serverMovedWatcher: ServerMovedWatcher | null = null;
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

function canReplaceAppImage(appImagePath: string): boolean {
  try {
    accessSync(
      dirname(appImagePath),
      // oxlint-disable-next-line no-bitwise
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

function readDesktopAboutFacts(applicationName: string): DesktopAboutFacts {
  return {
    applicationName,
    buildDate: process.env.BB_DESKTOP_BUILD_DATE ?? "",
    channel: DESKTOP_RELEASE_CHANNEL,
    commit: process.env.BB_DESKTOP_COMMIT ?? "",
    electronVersion: process.versions.electron,
    osArch: arch(),
    osRelease: release(),
    osType: osType(),
    platform: process.platform,
    pluginSdkVersion: process.env.BB_DESKTOP_PLUGIN_SDK_VERSION ?? "",
    version: getDesktopVersion(process.env.BB_DESKTOP_VERSION),
  };
}

function installAboutPanel(applicationName: string): void {
  app.setAboutPanelOptions(
    createDesktopAboutPanelOptions(readDesktopAboutFacts(applicationName)),
  );
}

async function showAboutDialog(): Promise<void> {
  const { copyButtonId, ...messageBoxOptions } =
    createDesktopAboutDialogOptions(
      readDesktopAboutFacts(app.getName()),
      Date.now(),
    );
  const parentWindow = getFocusedApplicationWindow();
  const result =
    parentWindow === null
      ? await dialog.showMessageBox(messageBoxOptions)
      : await dialog.showMessageBox(parentWindow, messageBoxOptions);
  if (result.response === copyButtonId) {
    await clipboard.writeText(messageBoxOptions.detail);
  }
}

function getCurrentDesktopInfo(): BbDesktopInfo | null {
  const info = mergeDesktopUpdateInfo({
    autoInfo: desktopAutoUpdateService?.getInfo() ?? null,
    feedInfo: desktopUpdateService?.getInfo() ?? null,
  });
  if (info === null) {
    return null;
  }
  return {
    ...info,
    serverDaemonLogsAvailable: shouldEnableServerDaemonLogsMenu(),
  };
}

function resolveApplicationWindow(
  webContents: WebContents,
): BrowserWindow | null {
  return BrowserWindow.fromWebContents(webContents);
}

function zoomWebContents(
  target: WebContents | null | undefined,
  command: BbDesktopZoomCommand,
): void {
  if (!target) {
    return;
  }
  target.setZoomFactor(nextZoomFactor(target.getZoomFactor(), command));
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
    const browserWindow = resolveApplicationWindow(webContents);
    if (browserWindow !== null) {
      reloadApplicationWindow(browserWindow, shortcut === "force-reload");
    }
  });
}

function reloadApplicationWindow(
  browserWindow: BrowserWindow,
  ignoreCache: boolean,
): void {
  desktopBrowserViewManager?.prepareWindowReload(browserWindow);
  if (ignoreCache) {
    browserWindow.webContents.reloadIgnoringCache();
  } else {
    browserWindow.webContents.reload();
  }
}

function sendDesktopInfoChanged(): void {
  const info = getCurrentDesktopInfo();
  if (info === null) {
    return;
  }
  for (const browserWindow of BrowserWindow.getAllWindows()) {
    if (applicationWindowWebContentsIds.has(browserWindow.webContents.id)) {
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

const desktopLogger: DesktopAutoUpdateLogger = {
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
  return (
    (process.platform === "darwin" || process.platform === "win32") &&
    currentRuntime?.ownership === "spawned"
  );
}

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

function liveSession(
  session: ApplicationWindowSession,
): ApplicationWindowSession | null {
  return windowSessions.get(session.webContentsId) === session &&
    !session.browserWindow.isDestroyed()
    ? session
    : null;
}

function targetSession(): ApplicationWindowSession | null {
  const focused = BrowserWindow.getFocusedWindow();
  const focusedSession =
    focused === null || focused.isDestroyed()
      ? undefined
      : windowSessions.get(focused.webContents.id);
  if (focusedSession !== undefined) {
    return focusedSession;
  }
  const lastFocused =
    lastFocusedWebContentsId === null
      ? undefined
      : windowSessions.get(lastFocusedWebContentsId);
  if (lastFocused !== undefined && liveSession(lastFocused) !== null) {
    return lastFocused;
  }
  for (const session of windowSessions.values()) {
    if (liveSession(session) !== null) {
      return session;
    }
  }
  return null;
}

function defaultServerTarget(): DesktopServerTarget {
  return serverTargetStore?.getDefaultTarget() ?? { kind: "builtin" };
}

function serverUrlForTarget(target: DesktopServerTarget): string {
  if (target.kind === "connect") {
    return target.server.url;
  }
  if (target.kind === "custom") {
    return target.url;
  }
  return currentRuntime?.serverUrl ?? builtinServerUrl;
}

function serverOriginForTarget(target: DesktopServerTarget): string {
  return new URL(serverUrlForTarget(target)).origin;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function persistServerTargets(write: Promise<unknown> | undefined): void {
  write?.catch((error: unknown) => {
    desktopLogger.warn(
      `[desktop] could not save which server each window opens: ${describeError(error)}`,
    );
  });
}

function logServerSwitchError(error: unknown): void {
  desktopLogger.error(`Could not switch server: ${describeError(error)}`);
}

function logWindowOpenError(error: unknown): void {
  desktopLogger.error(`Could not open a window: ${describeError(error)}`);
}

function listMenuConnectServers(): ConnectServerRef[] {
  const servers: ConnectServerRef[] = connectAccountServers.map((server) => ({
    handle: server.handle,
    name: server.name,
    url: server.url,
  }));
  for (const referenced of serverTargetStore?.listReferencedConnectServers() ??
    []) {
    if (!servers.some((server) => server.handle === referenced.handle)) {
      servers.push(referenced);
    }
  }
  return servers;
}

function listServerChoices(activeTarget: DesktopServerTarget | null) {
  return buildDesktopServerChoices({
    activeTarget,
    connectServers: listMenuConnectServers(),
    customServerUrls: serverTargetStore?.getCustomServerUrls() ?? [],
  });
}

function resolveServerChoice(serverId: string): DesktopServerTarget | null {
  return (
    listDesktopServerTargets({
      connectServers: listMenuConnectServers(),
      customServerUrls: serverTargetStore?.getCustomServerUrls() ?? [],
    }).find((target) => serverTargetId(target) === serverId) ?? null
  );
}

function buildServerMenuArgs(
  resolveSession: () => ApplicationWindowSession | null,
): ServerMenuArgs {
  const connectServers = listMenuConnectServers();
  return {
    addServer() {
      void openSetServerUrlDialog({
        edit: false,
        session: resolveSession(),
      }).catch(logServerSwitchError);
    },
    connectServersSkipReason:
      connectServers.length === 0 ? connectServerSyncSkipReason : null,
    selectServer(serverId) {
      const session = resolveSession();
      if (session === null) {
        selectDefaultServer(serverId);
        return;
      }
      void selectServerForWindow(session, serverId).catch(logServerSwitchError);
    },
    servers: buildDesktopServerChoices({
      activeTarget: resolveSession()?.target ?? defaultServerTarget(),
      connectServers,
      customServerUrls: serverTargetStore?.getCustomServerUrls() ?? [],
    }).map(({ active, id, name }) => ({ checked: active, id, name })),
    setServerUrl() {
      void openSetServerUrlDialog({
        edit: true,
        session: resolveSession(),
      }).catch(logServerSwitchError);
    },
  };
}

function popupServerMenu(session: ApplicationWindowSession): void {
  connectServerSync?.onListRequested();
  Menu.buildFromTemplate(
    createServerMenuItems(buildServerMenuArgs(() => liveSession(session))),
  ).popup({ window: session.browserWindow });
}

function keybindingsForSession(
  session: ApplicationWindowSession | null | undefined,
): AppKeybindings | undefined {
  return session === null || session === undefined
    ? undefined
    : keybindingsByServerUrl.get(serverUrlForTarget(session.target));
}

function applicationMenuAccelerators(
  session: ApplicationWindowSession | null,
): ApplicationMenuAccelerators {
  const keybindings = keybindingsForSession(session);
  return keybindings === undefined
    ? DEFAULT_APPLICATION_MENU_ACCELERATORS
    : resolveApplicationMenuAccelerators(keybindings);
}

function applyWindowTitles(): void {
  const sessions = [...windowSessions.values()];
  const showServer = shouldShowServerInWindowTitles(
    sessions.map((session) => serverTargetId(session.target)),
  );
  for (const session of sessions) {
    if (!session.browserWindow.isDestroyed()) {
      session.browserWindow.setTitle(
        formatApplicationWindowTitle({
          pageTitle: session.pageTitle,
          serverName: showServer ? serverTargetName(session.target) : null,
        }),
      );
    }
  }
}

function refreshServerChoices(): void {
  for (const session of windowSessions.values()) {
    if (!session.browserWindow.isDestroyed()) {
      sendToApplicationRenderer(
        session.browserWindow,
        BB_DESKTOP_SERVER_CHOICES_CHANGED_CHANNEL,
        listServerChoices(session.target),
      );
    }
  }
  applyWindowTitles();
  rebuildApplicationMenu();
}

function rebuildApplicationMenu(): void {
  installApplicationMenu({
    ...buildServerMenuArgs(targetSession),
    accelerators: applicationMenuAccelerators(targetSession()),
    isMac: process.platform === "darwin",
    createNewWindow() {
      void openApplicationWindow({
        stateKey: null,
        target: targetSession()?.target ?? defaultServerTarget(),
      }).catch(logWindowOpenError);
    },
    openAbout() {
      void showAboutDialog();
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
    reopenClosedTab() {
      const browserWindow = getFocusedApplicationWindow();
      if (browserWindow !== null) {
        sendToApplicationRenderer(
          browserWindow,
          BB_DESKTOP_APP_COMMAND_CHANNEL,
          "panel.reopenClosedTab",
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
    zoomFocusedPage(command) {
      zoomWebContents(electronWebContents.getFocusedWebContents(), command);
    },
    reloadWindow(browserWindow, ignoreCache) {
      if (!(browserWindow instanceof BrowserWindow)) {
        return;
      }
      reloadApplicationWindow(browserWindow, ignoreCache);
    },
    closeWindowOrSideTab(browserWindow) {
      if (browserWindow === undefined) {
        closeFocusedDetachedDevTools();
        return;
      }
      if (
        !(browserWindow instanceof BrowserWindow) ||
        browserWindow === logViewerWindow
      ) {
        browserWindow.close();
        return;
      }
      requestRendererWindowClose(browserWindow);
    },
    openServerDaemonLogs() {
      void openServerDaemonLogs();
    },
    onServerMenuWillShow() {
      connectServerSync?.onListRequested();
    },
    serverDaemonLogsMenuEnabled: shouldEnableServerDaemonLogsMenu(),
  });
}

function setCurrentRuntime(runtime: DesktopRuntime | null): void {
  currentRuntime = runtime;
  if (runtime !== null) {
    connectServerSync?.onRuntimeReady();
    desktopBrowserBrokerClients
      .get(new URL(runtime.serverUrl).origin)
      ?.reconnect();
  }
  reconcileServerServices();
  refreshServerChoices();
  if (runtime?.ownership !== "spawned") {
    closeServerDaemonLogsWindow();
  }
  sendDesktopInfoChanged();
}

function formatApiUrl(serverUrl: string): string {
  const url = new URL(serverUrl);
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

async function fetchSystemConfig(args: SystemConfigRequestArgs) {
  const response = await args.fetchImpl(formatApiUrl(args.serverUrl));
  if (!response.ok) {
    throw new Error(
      `System config request failed with HTTP ${response.status}`,
    );
  }
  const payload: unknown = await response.json();
  return parseDesktopSystemConfig(payload);
}

function createSystemConfigRefresh(
  args: SystemConfigRequestArgs,
): SystemConfigSync {
  let token = 0;
  let stopped = false;
  return {
    refresh(): void {
      token += 1;
      const requestToken = token;
      const isCurrent = (): boolean => !stopped && requestToken === token;
      fetchSystemConfig(args).then(
        (config) => {
          if (!isCurrent()) {
            return;
          }
          keybindingsByServerUrl.set(args.serverUrl, config.keybindings);
          rebuildApplicationMenu();
        },
        (error: unknown) => {
          if (isCurrent()) {
            process.stderr.write(
              `Could not refresh system config: ${describeError(error)}\n`,
            );
          }
        },
      );
    },
    stop(): void {
      stopped = true;
    },
  };
}

function createSystemConfigSync(serverUrl: string): SystemConfigSync {
  const realtimeUrl = formatRealtimeUrl(serverUrl);
  const config = createSystemConfigRefresh({ fetchImpl: fetch, serverUrl });
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
        config.refresh();
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
      config.refresh();
    });
    socket.addEventListener("message", handleMessage);
    socket.addEventListener("close", scheduleReconnect);
    socket.addEventListener("error", () => {
      socket?.close();
    });
  }

  connect();
  config.refresh();

  return {
    refresh: config.refresh,
    stop(): void {
      stopped = true;
      config.stop();
      clearReconnectTimer();
      socket?.close();
      socket = null;
    },
  };
}

function createRemoteSystemConfigSync(serverUrl: string): SystemConfigSync {
  const config = createSystemConfigRefresh({
    fetchImpl: (input, init) =>
      net.fetch(input as string | Request, {
        ...init,
        credentials: "include",
      }),
    serverUrl,
  });
  const timer = setInterval(
    config.refresh,
    REMOTE_SYSTEM_CONFIG_POLL_INTERVAL_MS,
  );
  timer.unref();
  config.refresh();

  return {
    refresh: config.refresh,
    stop(): void {
      clearInterval(timer);
      config.stop();
    },
  };
}

function systemConfigServerUrl(
  session: ApplicationWindowSession,
): string | null {
  if (!session.appLoaded) {
    return null;
  }
  if (session.target.kind === "builtin") {
    return localServerMove === null && currentRuntime !== null
      ? currentRuntime.serverUrl
      : null;
  }
  return serverUrlForTarget(session.target);
}

function connectHandleForUrl(serverUrl: string): string | null {
  for (const session of windowSessions.values()) {
    if (
      session.target.kind === "connect" &&
      session.target.server.url === serverUrl
    ) {
      return session.target.server.handle;
    }
  }
  return null;
}

function reconcileServerServices(): void {
  if (quitting) {
    return;
  }
  const sessions = [...windowSessions.values()];
  if (
    localServerMove === null &&
    sessions.some((session) => session.target.kind === "builtin")
  ) {
    startServerMovedWatcher();
  } else {
    stopServerMovedWatcher();
  }

  const configServerUrls = new Set<string>();
  for (const session of sessions) {
    const serverUrl = systemConfigServerUrl(session);
    if (serverUrl !== null) {
      configServerUrls.add(serverUrl);
    }
  }
  for (const [serverUrl, sync] of systemConfigSyncs) {
    if (!configServerUrls.has(serverUrl)) {
      sync.stop();
      systemConfigSyncs.delete(serverUrl);
      keybindingsByServerUrl.delete(serverUrl);
    }
  }
  for (const serverUrl of configServerUrls) {
    if (!systemConfigSyncs.has(serverUrl)) {
      systemConfigSyncs.set(
        serverUrl,
        serverUrl === currentRuntime?.serverUrl
          ? createSystemConfigSync(serverUrl)
          : createRemoteSystemConfigSync(serverUrl),
      );
    }
  }

  for (const [serverUrl, renewal] of connectSessionRenewals) {
    if (connectHandleForUrl(serverUrl) === null) {
      renewal.stop();
      connectSessionRenewals.delete(serverUrl);
    }
  }

  const serverOrigins = new Set(
    sessions.map((session) => serverOriginForTarget(session.target)),
  );
  for (const [serverOrigin, client] of desktopBrowserBrokerClients) {
    if (!serverOrigins.has(serverOrigin)) {
      client.stop();
      desktopBrowserBrokerClients.delete(serverOrigin);
    }
  }
  const broker = desktopBrowserBroker;
  const dataDir = builtinDataDir;
  if (broker === null || dataDir === null) {
    return;
  }
  for (const serverOrigin of serverOrigins) {
    if (!desktopBrowserBrokerClients.has(serverOrigin)) {
      desktopBrowserBrokerClients.set(
        serverOrigin,
        createDesktopBrowserBrokerClient({
          broker,
          dataDir,
          homeDir: homedir(),
          serverOrigin,
        }),
      );
    }
  }
}

function registerApplicationWindow(
  created: CreatedDesktopWindow,
  target: DesktopServerTarget,
): ApplicationWindowSession | null {
  const browserWindow = BrowserWindow.fromId(created.browserWindow.id);
  if (browserWindow === null) {
    return null;
  }
  const webContentsId = browserWindow.webContents.id;
  const session: ApplicationWindowSession = {
    actionPage: null,
    actionPending: false,
    appLoaded: false,
    awaitingConnectSignIn: false,
    browserWindow,
    generation: 0,
    pageTitle: browserWindow.getTitle(),
    stateKey: created.stateKey,
    target,
    themePreference: null,
    webContentsId,
  };
  windowSessions.set(webContentsId, session);
  applicationWindowWebContentsIds.add(webContentsId);
  desktopBrowserBroker?.registerWindow(
    browserWindow,
    serverOriginForTarget(target),
  );
  browserWindow.webContents.on(
    "did-start-navigation",
    (_event, _url, isInPlace, isMainFrame) => {
      if (isMainFrame && !isInPlace) {
        splitNavigationEnabledWebContentsIds.delete(webContentsId);
        splitNavigationCommandsByWebContentsId.delete(webContentsId);
        desktopFindViewManager?.close(browserWindow);
      }
    },
  );
  const layoutFindView = () => {
    desktopFindViewManager?.layout(browserWindow);
  };
  browserWindow.on("resize", layoutFindView);
  browserWindow.on("enter-full-screen", layoutFindView);
  browserWindow.on("leave-full-screen", layoutFindView);
  browserWindow.on("page-title-updated", (event, title) => {
    event.preventDefault();
    session.pageTitle = title;
    applyWindowTitles();
  });
  registerApplicationRendererReloadShortcut(browserWindow.webContents);
  registerDesktopContextMenu({ webContents: browserWindow.webContents });
  browserWindow.on("enter-full-screen", () => {
    sendDesktopWindowStateChanged(browserWindow);
  });
  browserWindow.on("leave-full-screen", () => {
    sendDesktopWindowStateChanged(browserWindow);
  });
  browserWindow.on("closed", () => {
    desktopFindViewManager?.releaseWindow(webContentsId);
    desktopBrowserBroker?.releaseWindow(webContentsId);
    applicationWindowWebContentsIds.delete(webContentsId);
    splitNavigationEnabledWebContentsIds.delete(webContentsId);
    splitNavigationCommandsByWebContentsId.delete(webContentsId);
    windowSessions.delete(webContentsId);
    if (lastFocusedWebContentsId === webContentsId) {
      lastFocusedWebContentsId = null;
    }
    if (quitting) {
      return;
    }
    persistServerTargets(
      serverTargetStore?.removeWindowTarget(session.stateKey),
    );
    reconcileServerServices();
    refreshServerChoices();
  });
  return session;
}

const BUILTIN_RUNTIME_UNAVAILABLE_ERROR: LoadStartupErrorArgs = {
  actions: [
    { id: "retry", label: "Try again" },
    { id: "choose-server", label: "Choose server…" },
  ],
  details:
    `Could not connect to the local bb server on ${process.platform === "darwin" ? "this Mac" : "this computer"}. ` +
    "Check that the port is free or that a compatible bb server is running.",
  logs: "",
  title: "Could not connect to bb server",
};

function ensureBuiltinRuntime(
  args: EnsureBuiltinRuntimeArgs,
): Promise<BuiltinRuntimeResult> {
  builtinRuntimeRequest ??= resolveBuiltinRuntime(args.startup).finally(() => {
    builtinRuntimeRequest = null;
  });
  return builtinRuntimeRequest;
}

async function resolveBuiltinRuntime(
  startup: boolean,
): Promise<BuiltinRuntimeResult> {
  if (localServerMove === null) {
    const move = await readCommittedLocalServerMove();
    if (move !== null) {
      for (const session of await activateLocalServerMove(move)) {
        void applyWindowTarget(session);
      }
    }
  }
  if (localServerMove !== null) {
    return { kind: "moved" };
  }
  if (currentRuntime !== null) {
    return { kind: "ready", serverUrl: currentRuntime.serverUrl };
  }
  const failed = (error: LoadStartupErrorArgs): BuiltinRuntimeResult => ({
    error: startup ? error : BUILTIN_RUNTIME_UNAVAILABLE_ERROR,
    kind: "failed",
  });
  if (desktopBridgePath === null || desktopUserDataPath === null) {
    return { error: BUILTIN_RUNTIME_UNAVAILABLE_ERROR, kind: "failed" };
  }
  const existingProbe = await probeBbServer({
    serverUrl: builtinServerUrl,
    timeoutMs: ATTACH_PROBE_TIMEOUT_MS,
  });
  if (existingProbe.kind === "incompatible") {
    return failed({
      details: `Port ${builtinServerUrl} is already in use, but it is not a compatible bb server: ${existingProbe.reason}.`,
      logs: "",
      actions: [],
      title: "Port conflict",
    });
  }
  if (existingProbe.kind === "compatible") {
    const decision = startup
      ? await decideOnExistingServer(existingProbe)
      : "attach";
    if (decision === "quit") {
      app.quit();
      return { kind: "quitting" };
    }
    if (decision === "attach") {
      setCurrentRuntime({
        bbProcess: null,
        ownership: "attached",
        serverUrl: existingProbe.serverUrl,
        userDataPath: null,
      });
      return { kind: "ready", serverUrl: existingProbe.serverUrl };
    }
  }
  const started = await startOwnedRuntime({
    bridgePath: desktopBridgePath,
    serverUrl: builtinServerUrl,
    userDataPath: desktopUserDataPath,
  });
  return started.kind === "ready"
    ? { kind: "ready", serverUrl: started.runtime.serverUrl }
    : failed(started.error);
}

async function authenticateConnectTarget(
  remoteServerUrl: string,
  targetHandle: string,
  isCurrent: () => boolean,
): Promise<ConnectDesktopSessionResult> {
  const cookieStore = electronSession.defaultSession.cookies;
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
      desktopLogger.info(
        "[desktop] bb Connect refused the cached machine credential — dropping it",
      );
      await clearCachedConnectCredential();
    } else if (cachedResult.code === "network") {
      return cachedResult;
    }
    cachedFailure = cachedResult;
  }

  if (!isCurrent()) {
    return (
      cachedFailure ?? {
        code: "network",
        detail: "the app no longer targets this server",
        ok: false,
      }
    );
  }
  const movedCredential = await readLocalServerMoveCredential(remoteServerUrl);
  if (movedCredential !== null) {
    const movedResult = await installConnectDesktopSession({
      cookieStore,
      mintCookie: createCredentialCookieSource({
        credential: movedCredential,
      }),
      remoteServerUrl,
    });
    if (movedResult.ok || movedResult.code !== "unauthorized") {
      return movedResult;
    }
    cachedFailure = movedResult;
  }
  const accountUrl = deriveConnectBaseUrl(remoteServerUrl);
  const accountCookieName =
    new URL(accountUrl).protocol === "http:"
      ? "better-auth.session_token"
      : "__Secure-better-auth.session_token";
  const accountCookies = await cookieStore.get({
    name: accountCookieName,
    url: accountUrl,
  });
  const accountCookie = accountCookies.find(
    (cookie) => cookie.name === accountCookieName,
  );
  if (accountCookie !== undefined) {
    const accountResult = await installConnectDesktopSession({
      cookieStore,
      mintCookie: createAccountCookieSource({
        accountCookie,
        remoteServerUrl,
        targetHandle,
      }),
      remoteServerUrl,
    });
    if (accountResult.ok || accountResult.code !== "unauthorized") {
      return accountResult;
    }
    cachedFailure = accountResult;
  }
  if (movedCredential !== null) {
    return (
      cachedFailure ?? {
        code: "unauthorized",
        detail: "bb Connect rejected this app",
        ok: false,
      }
    );
  }
  const localRuntime = await ensureBuiltinRuntime({ startup: false });
  if (localRuntime.kind !== "ready") {
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
      localServerUrl: localRuntime.serverUrl,
    }),
    remoteServerUrl,
  });
  if (localResult.ok) {
    void ensureDesktopMachineEnrolled();
  }
  return localResult;
}

function authenticateConnectServer(
  server: ConnectServerRef,
): Promise<ConnectDesktopSessionResult> {
  const pending = connectAuthentications.get(server.url);
  if (pending !== undefined) {
    return pending;
  }
  const authentication = authenticateConnectTarget(
    server.url,
    server.handle,
    () => connectHandleForUrl(server.url) !== null,
  ).finally(() => {
    connectAuthentications.delete(server.url);
  });
  connectAuthentications.set(server.url, authentication);
  return authentication;
}

function startConnectSessionRenewal(
  serverUrl: string,
  expiresAt: number,
): void {
  let renewal = connectSessionRenewals.get(serverUrl);
  if (renewal === undefined) {
    renewal = createConnectSessionRenewal({
      async authenticate(remoteServerUrl, isCurrent) {
        const handle = connectHandleForUrl(remoteServerUrl);
        if (handle === null) {
          return { detail: "no window shows this server", ok: false };
        }
        const result = await authenticateConnectTarget(
          remoteServerUrl,
          handle,
          () => isCurrent() && connectHandleForUrl(remoteServerUrl) !== null,
        );
        return result.ok
          ? result
          : { detail: `${result.code}: ${result.detail}`, ok: false };
      },
      log: (message) => {
        desktopLogger.warn(`[desktop] ${message}`);
      },
    });
    connectSessionRenewals.set(serverUrl, renewal);
  }
  renewal.start({ expiresAt, remoteServerUrl: serverUrl });
}

async function clearCachedConnectCredential(): Promise<void> {
  cachedConnectCredential = null;
  await connectCredentialCache?.clear();
}

async function readLocalServerMoveCredential(
  remoteServerUrl: string,
): Promise<ConnectCredential | null> {
  if (localServerMove === null || builtinDataDir === null) {
    return null;
  }
  return readServerMovedConnectCredential({
    dataDir: builtinDataDir,
    logWarning: (message) => {
      desktopLogger.warn(message);
    },
    move: localServerMove,
    remoteServerUrl,
  });
}

function showServerMovedNotice(notice: ServerMovedNotice): void {
  const options: MessageBoxOptions = {
    buttons: ["OK"],
    detail: notice.detail,
    message: notice.message,
    type: "info",
  };
  const parentWindow = getFocusedApplicationWindow();
  const shown =
    parentWindow === null
      ? dialog.showMessageBox(options)
      : dialog.showMessageBox(parentWindow, options);
  shown.catch((error: unknown) => {
    desktopLogger.warn(
      `[desktop] could not show the server move notice: ${error instanceof Error ? error.message : String(error)}`,
    );
  });
}

function adoptStoredTargets(
  stateKeys: readonly WindowStateKey[],
): ApplicationWindowSession[] {
  const adopted: ApplicationWindowSession[] = [];
  for (const session of windowSessions.values()) {
    const stored = stateKeys.includes(session.stateKey)
      ? (serverTargetStore?.getWindowTarget(session.stateKey) ?? null)
      : null;
    if (stored !== null) {
      session.target = stored;
      adopted.push(session);
    }
  }
  return adopted;
}

async function activateLocalServerMove(
  move: DesktopServerMove,
): Promise<ApplicationWindowSession[]> {
  if (
    serverTargetStore === null ||
    serverMoveNoticeStore === null ||
    machineServiceNoticeStore === null ||
    desktopBridgePath === null ||
    desktopUserDataPath === null ||
    builtinDataDir === null
  ) {
    return [];
  }
  const bridgePath = desktopBridgePath;
  const userDataPath = desktopUserDataPath;
  localServerMove = move;
  stopServerMovedWatcher();
  desktopLogger.info(
    `[desktop] this computer's bb server moved to ${move.toHostName}; windows on ${BUILTIN_SERVER_NAME} now open that server and this computer runs as a regular machine`,
  );
  const { retargeted } = await applyServerMove({
    move,
    noticeStore: serverMoveNoticeStore,
    showNotice: showServerMovedNotice,
    targetStore: serverTargetStore,
  });
  const moved = adoptStoredTargets(retargeted);
  refreshServerChoices();
  connectMovedMachine({
    bridgePath,
    dataDir: builtinDataDir,
    move,
    noticeStore: machineServiceNoticeStore,
    userDataPath,
  });
  return moved;
}

function connectMovedMachine(args: {
  bridgePath: string;
  dataDir: string;
  move: DesktopServerMove;
  noticeStore: ServerMoveNoticeStore;
  userDataPath: string;
}): void {
  if (movedMachineConnection !== null) {
    return;
  }
  const logPath = join(
    args.dataDir,
    "logs",
    MACHINE_SERVICE_INSTALL_LOG_FILE_NAME,
  );
  movedMachineConnection = (async () => {
    await keepMovedMachineConnected({
      findService: () =>
        findMachineServiceFile({
          dataDir: args.dataDir,
          homeDir: homedir(),
          platform: process.platform,
        }),
      install: () =>
        runMachineInstaller({
          dataDir: args.dataDir,
          env: process.env,
          installerPath: resolveDesktopMachineInstallerPath(args.bridgePath),
          logPath,
        }),
      logInfo: (message) => {
        desktopLogger.info(message);
      },
      logPath,
      move: args.move,
      noticeStore: args.noticeStore,
      showNotice: showServerMovedNotice,
      stopLocalRuntime: stopOwnedRuntime,
    });
    if (quitting) {
      return;
    }
    await ensureServerMovedRuntime({
      hasLocalRuntime: () => currentRuntime !== null,
      async isLocalAddressFree() {
        const probe = await probeBbServer({
          serverUrl: builtinServerUrl,
          timeoutMs: ATTACH_PROBE_TIMEOUT_MS,
        });
        return probe.kind === "unavailable";
      },
      localServerUrl: builtinServerUrl,
      logInfo: (message) => {
        desktopLogger.info(message);
      },
      async startLocalRuntime() {
        await spawnOwnedRuntime({
          bridgePath: args.bridgePath,
          serverUrl: builtinServerUrl,
          userDataPath: args.userDataPath,
        });
      },
    });
    refreshServerChoices();
  })()
    .catch((error: unknown) => {
      desktopLogger.warn(
        `[desktop] could not keep this computer connected as a machine: ${error instanceof Error ? error.message : String(error)}`,
      );
    })
    .finally(() => {
      movedMachineConnection = null;
    });
}

async function confirmLocalServerMove(
  move: DesktopServerMove,
  timeoutMs: number,
  isCancelled: () => boolean,
): Promise<boolean> {
  const dataDir = builtinDataDir;
  if (dataDir === null) {
    return false;
  }
  const result = await waitForCommittedServerMove({
    dataDir,
    async hasLiveLocalLauncher() {
      return (
        currentRuntime?.ownership === "spawned" ||
        (await hasLiveBbAppLauncher({ dataDir }))
      );
    },
    intervalMs: SERVER_MOVE_COMMIT_INTERVAL_MS,
    isCancelled: () => quitting || isCancelled(),
    logWarning: (message) => {
      desktopLogger.warn(message);
    },
    move,
    probeLocalServer: () =>
      probeLocalServerMove({
        serverUrl: builtinServerUrl,
        timeoutMs: ATTACH_PROBE_TIMEOUT_MS,
      }),
    timeoutMs,
  });
  if (result === "withdrawn") {
    desktopLogger.info(
      `[desktop] server move ${move.moveId} was withdrawn before it finished; staying on ${BUILTIN_SERVER_NAME}`,
    );
  } else if (result === "timed-out" && timeoutMs > 0) {
    desktopLogger.warn(
      `[desktop] server move ${move.moveId} is locked, but ${builtinServerUrl} did not report server_moved within ${timeoutMs}ms; staying on ${BUILTIN_SERVER_NAME}`,
    );
  }
  return result === "committed";
}

async function readCommittedLocalServerMove(): Promise<DesktopServerMove | null> {
  if (builtinDataDir === null) {
    return null;
  }
  const move = await readServerMovedLock({
    dataDir: builtinDataDir,
    logWarning: (message) => {
      desktopLogger.warn(message);
    },
  });
  if (move === null || !(await confirmLocalServerMove(move, 0, () => false))) {
    return null;
  }
  return move;
}

async function activateLocalServerMoveIfLocked(): Promise<void> {
  const move = await readCommittedLocalServerMove();
  if (move === null) {
    localServerMove = null;
    return;
  }
  await activateLocalServerMove(move);
}

function startServerMovedWatcher(): void {
  if (
    serverMovedWatcher !== null ||
    localServerMove !== null ||
    builtinDataDir === null
  ) {
    return;
  }
  serverMovedWatcher = createServerMovedWatcher({
    confirmMove: (move, isCancelled) =>
      confirmLocalServerMove(move, SERVER_MOVE_COMMIT_TIMEOUT_MS, isCancelled),
    dataDir: builtinDataDir,
    debounceMs: SERVER_MOVED_WATCH_DEBOUNCE_MS,
    logWarning: (message) => {
      desktopLogger.warn(message);
    },
    onMove(move) {
      void handleWatchedServerMove(move);
    },
    pollIntervalMs: SERVER_MOVED_POLL_INTERVAL_MS,
  });
  serverMovedWatcher.start();
}

function stopServerMovedWatcher(): void {
  serverMovedWatcher?.stop();
  serverMovedWatcher = null;
}

async function handleWatchedServerMove(move: DesktopServerMove): Promise<void> {
  if (localServerMove !== null) {
    stopServerMovedWatcher();
    return;
  }
  let moved: ApplicationWindowSession[];
  try {
    moved = await activateLocalServerMove(move);
  } catch (error) {
    desktopLogger.warn(
      `[desktop] could not switch to the moved bb server: ${describeError(error)}`,
    );
    return;
  }
  const generations = new Map(
    moved.map((session) => [session, session.generation]),
  );
  const isWaiting = (session: ApplicationWindowSession): boolean =>
    liveSession(session) !== null &&
    session.generation === generations.get(session);
  if (move.target.kind === "custom") {
    await waitForServerMoveDestination({
      fetchImpl: (input, init) => net.fetch(input, init),
      intervalMs: SERVER_MOVE_DESTINATION_INTERVAL_MS,
      isCancelled: () => quitting || !moved.some(isWaiting),
      serverUrl: move.target.url,
      timeoutMs: SERVER_MOVE_DESTINATION_TIMEOUT_MS,
    });
  }
  if (quitting) {
    return;
  }
  for (const session of moved) {
    if (isWaiting(session)) {
      void applyWindowTarget(session);
    }
  }
  connectServerSync?.syncNow().catch(() => {});
}

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
    desktopLogger.info(
      "[desktop] no OS keychain available — keeping the local bb server for bb Connect sessions",
    );
    return;
  }
  enrollingDesktopMachine = (async () => {
    const result = await enrollDesktopMachine({ localServerUrl });
    if (!result.ok) {
      desktopLogger.info(
        `[desktop] could not enroll this app with bb Connect (${result.code}): ${result.detail}`,
      );
      return;
    }
    cachedConnectCredential = result.credential;
    await cache.write(result.credential);
    desktopLogger.info("[desktop] enrolled this app as a bb Connect machine");
  })().finally(() => {
    enrollingDesktopMachine = null;
  });
}

async function runStartupAction(
  session: ApplicationWindowSession,
  action: StartupActionId,
): Promise<void> {
  if (action === "choose-server") {
    popupServerMenu(session);
    return;
  }
  if (action === "reconnect-connect") {
    openConnectSignIn(session);
    return;
  }
  if (session.actionPending) {
    return;
  }
  session.actionPending = true;
  try {
    await loadLoadingView(session);
    if (action === "open-moved-server" && localServerMove !== null) {
      await switchWindowTarget(session, localServerMove.target);
      return;
    }
    await applyWindowTarget(session);
  } catch (error) {
    await loadStartupError(session, {
      actions: [],
      details: describeError(error),
      logs: "",
      title: "Could not open bb",
    });
  } finally {
    session.actionPending = false;
  }
}

function openConnectSignIn(session: ApplicationWindowSession): void {
  const target = session.target;
  if (target.kind !== "connect") return;
  const targetUrl = target.server.url;
  if (connectSignInWindow !== null && !connectSignInWindow.isDestroyed()) {
    connectSignInWindow.focus();
    return;
  }
  const accountUrl = deriveConnectBaseUrl(targetUrl);
  const accountHost = new URL(accountUrl).hostname;
  const cookieName =
    new URL(accountUrl).protocol === "http:"
      ? "better-auth.session_token"
      : "__Secure-better-auth.session_token";
  const signInUrl = new URL("/dashboard", accountUrl);
  signInUrl.searchParams.set("returnTo", targetUrl);
  const signInWindow = new BrowserWindow({
    height: 720,
    parent: liveSession(session)?.browserWindow,
    title: "Reconnect bb Connect",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    width: 520,
  });
  connectSignInWindow = signInWindow;
  let completed = false;
  const onCookieChanged = (
    _event: Electron.Event,
    cookie: Electron.Cookie,
    _cause: string,
    removed: boolean,
  ): void => {
    if (
      completed ||
      removed ||
      cookie.name !== cookieName ||
      (cookie.domain ?? "").replace(/^\./u, "") !== accountHost
    )
      return;
    completed = true;
    electronSession.defaultSession.cookies.removeListener(
      "changed",
      onCookieChanged,
    );
    if (!signInWindow.isDestroyed()) signInWindow.close();
    for (const waiting of windowSessions.values()) {
      if (
        waiting.awaitingConnectSignIn &&
        waiting.target.kind === "connect" &&
        deriveConnectBaseUrl(waiting.target.server.url) === accountUrl
      ) {
        void applyWindowTarget(waiting);
      }
    }
  };
  electronSession.defaultSession.cookies.on("changed", onCookieChanged);
  signInWindow.on("closed", () => {
    electronSession.defaultSession.cookies.removeListener(
      "changed",
      onCookieChanged,
    );
    if (connectSignInWindow === signInWindow) connectSignInWindow = null;
  });
  void electronSession.defaultSession.cookies
    .remove(accountUrl, cookieName)
    .catch((error: unknown) => {
      desktopLogger.warn(
        `[desktop] could not clear bb Connect sign-in: ${describeError(error)}`,
      );
    })
    .then(async () => {
      if (!signInWindow.isDestroyed()) {
        await signInWindow.loadURL(signInUrl.toString());
      }
    })
    .catch((error: unknown) => {
      desktopLogger.warn(
        `[desktop] could not open bb Connect sign-in: ${describeError(error)}`,
      );
      if (!signInWindow.isDestroyed()) signInWindow.close();
    });
}

async function loadServerMovedView(
  session: ApplicationWindowSession,
  move: DesktopServerMove,
): Promise<void> {
  await loadActionView(session, {
    actions: [
      { id: "open-moved-server", label: `Open ${move.toHostName}` },
      { id: "choose-server", label: "Choose server…" },
    ],
    details: move.oldCopyKept
      ? "The old copy on this computer is locked after the move."
      : "The old copy on this computer was deleted.",
    logs: "",
    title: `bb moved to ${move.toHostName}`,
  });
}

function beginWindowLoad(session: ApplicationWindowSession): () => boolean {
  session.generation += 1;
  const generation = session.generation;
  session.actionPage = null;
  session.appLoaded = false;
  session.awaitingConnectSignIn = false;
  desktopBrowserBroker?.setWindowServer(
    session.webContentsId,
    serverOriginForTarget(session.target),
  );
  reconcileServerServices();
  return () =>
    liveSession(session) !== null && session.generation === generation;
}

async function applyWindowTarget(
  session: ApplicationWindowSession,
): Promise<void> {
  const isCurrent = beginWindowLoad(session);
  try {
    await loadWindowTarget(session, isCurrent);
  } catch (error) {
    if (isCurrent()) {
      await loadStartupError(session, {
        actions: [],
        details: describeError(error),
        logs: "",
        title: "Could not open bb",
      });
    }
  }
  if (isCurrent()) {
    reconcileServerServices();
    refreshServerChoices();
  }
}

async function loadWindowTarget(
  session: ApplicationWindowSession,
  isCurrent: () => boolean,
): Promise<void> {
  const target = session.target;
  if (target.kind === "builtin") {
    const runtime = await ensureBuiltinRuntime({ startup: false });
    if (!isCurrent() || runtime.kind === "quitting") {
      return;
    }
    if (runtime.kind === "moved") {
      if (localServerMove !== null) {
        await loadServerMovedView(session, localServerMove);
      }
      return;
    }
    if (runtime.kind === "failed") {
      await loadStartupError(session, runtime.error);
      return;
    }
    await loadBbApp(
      session,
      resolveDesktopWindowUrl({
        env: process.env,
        serverUrl: runtime.serverUrl,
      }),
    );
    return;
  }
  if (target.kind === "custom") {
    await loadRemoteServerTarget(session, target.url, isCurrent);
    return;
  }
  const result = await authenticateConnectServer(target.server);
  if (!isCurrent()) {
    return;
  }
  if (!result.ok) {
    desktopLogger.warn(
      `[desktop] Connect authentication failed (${result.code}): ${result.detail}`,
    );
    const unauthorized = result.code === "unauthorized";
    await loadStartupError(session, {
      actions: [
        ...(unauthorized
          ? [
              {
                id: "reconnect-connect" as const,
                label: "Reconnect",
              },
            ]
          : [{ id: "retry" as const, label: "Try again" }]),
        { id: "choose-server", label: "Choose server…" },
      ],
      details: unauthorized
        ? "The desktop app could not establish a session for this Connect server. " +
          (result.detail === "this account does not own the selected server"
            ? `(unauthorized: This account does not own ${target.server.name}.)`
            : "(unauthorized: The app was rejected.)")
        : "The desktop app could not establish a session for this Connect server. " +
          `(${result.code}: ${result.detail})`,
      logs: "",
      title: "Could not authenticate with bb Connect",
    });
    session.awaitingConnectSignIn = unauthorized;
    return;
  }
  startConnectSessionRenewal(target.server.url, result.expiresAt);
  await loadRemoteServerTarget(session, target.server.url, isCurrent);
}

async function loadRemoteServerTarget(
  session: ApplicationWindowSession,
  serverUrl: string,
  isCurrent: () => boolean,
): Promise<void> {
  const loaded = await loadRemoteServerPage({
    isCurrent,
    loadStartupError: (args) => loadStartupError(session, args),
    loadUrl: (args) => loadWindowUrl(session, args.url),
    logWarning: (message) => {
      desktopLogger.warn(message);
    },
    serverUrl,
  });
  if (loaded && isCurrent()) {
    session.appLoaded = true;
  }
}

async function switchWindowTarget(
  session: ApplicationWindowSession,
  target: DesktopServerTarget,
): Promise<void> {
  session.target = target;
  persistServerTargets(
    serverTargetStore?.setWindowTarget(session.stateKey, target),
  );
  if (targetSession() === session) {
    persistServerTargets(serverTargetStore?.setDefaultTarget(target));
  }
  refreshServerChoices();
  await applyWindowTarget(session);
}

async function selectServerForWindow(
  session: ApplicationWindowSession,
  serverId: string,
): Promise<void> {
  const target = resolveServerChoice(serverId);
  if (target === null) {
    refreshServerChoices();
    return;
  }
  if (serverTargetId(target) === serverTargetId(session.target)) {
    return;
  }
  await switchWindowTarget(session, target);
}

async function selectServerForSender(
  webContentsId: number,
  serverId: string,
): Promise<void> {
  const session = windowSessions.get(webContentsId);
  if (session !== undefined) {
    await selectServerForWindow(session, serverId);
  }
}

function selectDefaultServer(serverId: string): void {
  const target = resolveServerChoice(serverId);
  if (target !== null) {
    persistServerTargets(serverTargetStore?.setDefaultTarget(target));
  }
  refreshServerChoices();
}

async function openSetServerUrlDialog(
  args: OpenSetServerUrlDialogArgs,
): Promise<void> {
  const store = serverTargetStore;
  if (store === null || serverUrlDialogPreloadPath === null) {
    return;
  }
  const previousUrl =
    args.edit && args.session?.target.kind === "custom"
      ? args.session.target.url
      : null;
  const result = await openServerUrlDialog({
    initialUrl: previousUrl,
    parentWindow:
      args.session === null
        ? null
        : (liveSession(args.session)?.browserWindow ?? null),
    preloadPath: serverUrlDialogPreloadPath,
  });
  if (result.kind === "cancelled") {
    return;
  }
  if (previousUrl === null) {
    if (result.kind === "clear") {
      return;
    }
    const target: DesktopServerTarget = {
      kind: "custom",
      url: await store.addCustomServerUrl(result.url),
    };
    const session = args.session === null ? null : liveSession(args.session);
    if (session === null) {
      persistServerTargets(store.setDefaultTarget(target));
      refreshServerChoices();
    } else {
      await switchWindowTarget(session, target);
    }
    return;
  }
  const moved =
    result.kind === "clear"
      ? await store.removeCustomServerUrl(previousUrl)
      : await store.replaceCustomServerUrl(previousUrl, result.url);
  const adopted = adoptStoredTargets(moved);
  refreshServerChoices();
  await Promise.all(adopted.map((session) => applyWindowTarget(session)));
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
  ipcMain.handle(
    LOG_VIEWER_COPY_CHANNEL,
    (_event, request: LogViewerCopyRequest) => {
      return clipboard.writeText(
        logViewerCopyRequestSchema.parse(request).text,
      );
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
      logViewerLineBuffer?.append(lines);
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

async function openDataDirectory(): Promise<void> {
  const dataDir = resolveDataDirFromEnv({
    env: process.env,
    homeDir: homedir(),
  });
  const errorMessage = await shell.openPath(dataDir);
  if (errorMessage.length > 0) {
    desktopLogger.error(
      `[desktop] could not open the data directory ${dataDir}: ${errorMessage}`,
    );
  }
}

async function loadWindowUrl(
  session: ApplicationWindowSession,
  url: string,
): Promise<void> {
  session.actionPage = null;
  if (desktopWindowFactory === null || session.browserWindow.isDestroyed()) {
    return;
  }
  await desktopWindowFactory.loadUrl({
    browserWindow: session.browserWindow,
    url,
  });
}

async function loadLoadingView(
  session: ApplicationWindowSession,
): Promise<void> {
  session.appLoaded = false;
  await loadWindowUrl(
    session,
    createLocalViewUrl({
      viewModel: {
        kind: "loading",
        message: "Starting local services and opening the bb workspace.",
        title: "Opening bb",
      },
    }),
  );
}

async function loadStartupError(
  session: ApplicationWindowSession,
  args: LoadStartupErrorArgs,
): Promise<void> {
  await loadActionView(session, {
    ...args,
    details:
      args.actions.length === 0
        ? `${args.details} Logs are under ${formatLogDirectory()}/.`
        : args.details,
  });
}

async function loadStartupErrorInAllWindows(
  args: LoadStartupErrorArgs,
): Promise<void> {
  await Promise.all(
    [...windowSessions.values()].map((session) =>
      loadStartupError(session, args),
    ),
  );
}

async function loadActionView(
  session: ApplicationWindowSession,
  args: LoadStartupErrorArgs,
): Promise<void> {
  session.appLoaded = false;
  const url = createLocalViewUrl({
    viewModel: {
      actions: args.actions,
      details: args.details,
      kind: "error",
      logText: args.logs,
      title: args.title,
    },
  });
  const loading = loadWindowUrl(session, url);
  session.actionPage =
    args.actions.length === 0
      ? null
      : { actions: args.actions.map((action) => action.id), url };
  await loading;
}

async function loadBbApp(
  session: ApplicationWindowSession,
  url: string,
): Promise<void> {
  session.appLoaded = true;
  await loadWindowUrl(session, url);
  if (shouldOpenDevTools() && !session.browserWindow.isDestroyed()) {
    session.browserWindow.webContents.openDevTools({ mode: "detach" });
  }
}

function shouldOpenDevTools(): boolean {
  return process.env.BB_DESKTOP_OPEN_DEVTOOLS === "1";
}

async function openApplicationWindow(
  args: OpenApplicationWindowArgs,
): Promise<void> {
  if (desktopWindowFactory === null) {
    return;
  }
  const session = registerApplicationWindow(
    await desktopWindowFactory.createWindow({ stateKey: args.stateKey }),
    args.target,
  );
  if (session === null) {
    return;
  }
  persistServerTargets(
    serverTargetStore?.setWindowTarget(session.stateKey, session.target),
  );
  refreshServerChoices();
  await loadLoadingView(session);
  await applyWindowTarget(session);
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
  stopServerMovedWatcher();
  for (const client of desktopBrowserBrokerClients.values()) {
    client.stop();
  }
  desktopBrowserBrokerClients.clear();
  desktopBrowserBroker?.dispose();
  for (const sync of systemConfigSyncs.values()) {
    sync.stop();
  }
  systemConfigSyncs.clear();
  for (const renewal of connectSessionRenewals.values()) {
    renewal.stop();
  }
  connectSessionRenewals.clear();
  desktopUpdateService?.stop();
  desktopAutoUpdateService?.stop();
  desktopBrowserViewManager?.destroyAll();
  desktopFindViewManager?.destroyAll();
  await desktopWindowFactory?.persistOpenWindows();
  await stopOwnedRuntime();
}

function registerDesktopUpdateIpc(): void {
  registerServerChoiceIpc({
    applicationWindowWebContentsIds,
    onListRequested: () => connectServerSync?.onListRequested(),
    list: (webContentsId) =>
      listServerChoices(windowSessions.get(webContentsId)?.target ?? null),
    select: selectServerForSender,
    onError: logServerSwitchError,
  });
  registerDesktopWindowFocusIpc(applicationWindowWebContentsIds);
  registerDesktopClipboardIpc(applicationWindowWebContentsIds);
  ipcMain.on(BB_DESKTOP_ZOOM_COMMAND_CHANNEL, (event, payload: unknown) => {
    const parsed = bbDesktopZoomCommandSchema.safeParse(payload);
    if (parsed.success) {
      zoomWebContents(
        resolveApplicationWindow(event.sender)?.webContents,
        parsed.data,
      );
    }
  });
  ipcMain.handle(BB_DESKTOP_GET_INFO_CHANNEL, () => {
    return getCurrentDesktopInfo();
  });
  ipcMain.handle(BB_DESKTOP_GET_WINDOW_STATE_CHANNEL, (event) => {
    return getSenderDesktopWindowState(event);
  });
  ipcMain.handle(BB_DESKTOP_OPEN_SERVER_DAEMON_LOGS_CHANNEL, async () => {
    await openServerDaemonLogs();
  });
  ipcMain.handle(BB_DESKTOP_OPEN_DATA_DIRECTORY_CHANNEL, async () => {
    await openDataDirectory();
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
    const appImagePath = process.env.APPIMAGE?.trim() ?? "";
    if (
      process.platform === "linux" &&
      (appImagePath.length === 0 || !canReplaceAppImage(appImagePath))
    ) {
      desktopLogger.error(
        `Desktop update install skipped: ${appImagePath || "this build"} cannot be replaced in place. The runtime stays up; download the new AppImage instead.`,
      );
      return;
    }
    quitting = true;
    stoppingForQuit = true;
    await finishQuit();
    desktopAutoUpdateService.installUpdate();
  });
  ipcMain.on(
    BB_DESKTOP_SET_SPLIT_NAVIGATION_ENABLED_CHANNEL,
    (event, enabled: unknown, directionalCommands: unknown) => {
      if (
        !applicationWindowWebContentsIds.has(event.sender.id) ||
        event.senderFrame !== event.sender.mainFrame ||
        typeof enabled !== "boolean"
      ) {
        return;
      }
      const parsed = appCommandIdSchema
        .array()
        .safeParse(directionalCommands ?? []);
      if (!parsed.success) return;
      if (enabled) {
        splitNavigationEnabledWebContentsIds.add(event.sender.id);
        if (directionalCommands !== undefined) {
          splitNavigationCommandsByWebContentsId.set(
            event.sender.id,
            parsed.data,
          );
        }
      } else {
        splitNavigationEnabledWebContentsIds.delete(event.sender.id);
        splitNavigationCommandsByWebContentsId.delete(event.sender.id);
      }
    },
  );
  ipcMain.on(BB_DESKTOP_SET_THEME_CHANNEL, (event, payload: unknown) => {
    const parsed = bbDesktopThemeSchema.safeParse(payload);
    const session = windowSessions.get(event.sender.id);
    if (!parsed.success || session === undefined) {
      return;
    }
    session.themePreference = parsed.data;
    if (targetSession() === session) {
      nativeTheme.themeSource = parsed.data;
    }
  });
  ipcMain.on(STARTUP_ACTION_CHANNEL, (event, ...payload: unknown[]) => {
    const action = startupActionIdSchema.safeParse(payload[0]);
    const session = windowSessions.get(event.sender.id);
    const page = session?.actionPage ?? null;
    if (
      payload.length !== 1 ||
      !action.success ||
      session === undefined ||
      page === null ||
      !page.actions.includes(action.data) ||
      !applicationWindowWebContentsIds.has(event.sender.id) ||
      event.senderFrame !== event.sender.mainFrame ||
      event.senderFrame?.url !== page.url
    ) {
      return;
    }
    void runStartupAction(session, action.data);
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
  ipcMain.on(
    BB_DESKTOP_OPEN_EXTERNAL_URL_CHANNEL,
    (_event, payload: unknown) => {
      const url = resolveDesktopExternalUrl(payload);
      if (url !== null) {
        void shell.openExternal(url);
      }
    },
  );
}

interface DesktopBrowserWindowLifecycleArgs {
  browserWindow: BrowserWindow;
  manager: DesktopBrowserViewManager;
}

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

async function spawnOwnedRuntime(
  args: StartOwnedRuntimeArgs,
): Promise<OwnedRuntime> {
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
      platform: process.platform,
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
    if (localServerMove !== null) {
      desktopLogger.warn(
        `[desktop] the Electron-owned bb-app process that runs this computer as a machine stopped with ${formatExitResult(exit)}`,
      );
      return;
    }
    for (const session of windowSessions.values()) {
      if (session.target.kind === "builtin") {
        void loadStartupError(session, {
          details: `The Electron-owned bb-app process stopped with ${formatExitResult(
            exit,
          )}.`,
          logs: bbProcess.logs.text(),
          actions: [],
          title: "bb stopped",
        });
      }
    }
  });
  return { bbProcess, runtime };
}

async function startOwnedRuntime(
  args: StartOwnedRuntimeArgs,
): Promise<OwnedRuntimeStartResult> {
  const { bbProcess, runtime } = await spawnOwnedRuntime(args);

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
    setCurrentRuntime(null);
    return {
      error: {
        details: `bb-app exited before the server was ready with ${formatExitResult(
          raceResult.exit,
        )}.`,
        logs: bbProcess.logs.text(),
        actions: [],
        title: "Could not start bb",
      },
      kind: "failed",
    };
  }

  if (raceResult.result.kind === "compatible") {
    return { kind: "ready", runtime };
  }

  const error: LoadStartupErrorArgs = {
    details:
      raceResult.result.kind === "incompatible"
        ? `Port ${args.serverUrl} is responding, but it does not look like bb: ${raceResult.result.reason}.`
        : `Timed out waiting for bb at ${args.serverUrl}: ${raceResult.result.reason}.`,
    logs: bbProcess.logs.text(),
    actions: [],
    title: "Could not start bb",
  };
  await stopOwnedRuntime();
  return { error, kind: "failed" };
}

function shouldAskBeforeAttaching(): boolean {
  if (!app.isPackaged || existingServerDialogPreloadPath === null) {
    return false;
  }
  if (process.env.BB_DESKTOP_ATTACH_WITHOUT_PROMPT === "1") {
    return false;
  }
  return (process.env.BB_DESKTOP_APP_URL ?? "").trim().length === 0;
}

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
    await loadStartupErrorInAllWindows({
      details:
        `The bb at ${probe.serverUrl} records process ${String(stopResult.pid)}, but that ` +
        "process no longer matches the record. bb did not stop it. Stop it yourself, then open bb again.",
      logs: "",
      actions: [],
      title: "Could not stop the running bb",
    });
    return "quit";
  }
  if (stopResult.kind === "still-running") {
    await loadStartupErrorInAllWindows({
      details: `bb could not stop process ${String(stopResult.pid)}, even after SIGKILL.`,
      logs: "",
      actions: [],
      title: "Could not stop the running bb",
    });
    return "quit";
  }
  if (stopResult.kind === "replaced") {
    await loadStartupErrorInAllWindows({
      details:
        `Another bb started at ${probe.serverUrl} while the question was open, so bb stopped nothing. ` +
        "Open bb again to see the copy that runs now.",
      logs: "",
      actions: [],
      title: "Could not stop the running bb",
    });
    return "quit";
  }
  if (!(await waitForServerToStop(probe.serverUrl))) {
    await loadStartupErrorInAllWindows({
      details: `The bb at ${probe.serverUrl} stopped, but the address is still in use.`,
      logs: "",
      actions: [],
      title: "Could not stop the running bb",
    });
    return "quit";
  }
  return "start-fresh";
}

async function refreshConnectServerNames(
  servers: readonly ConnectAccountServer[],
): Promise<void> {
  const store = serverTargetStore;
  if (store === null) {
    return;
  }
  const referenced = new Set(
    store.listReferencedConnectServers().map((server) => server.handle),
  );
  try {
    for (const server of servers) {
      if (referenced.has(server.handle)) {
        await store.refreshConnectServer({
          handle: server.handle,
          name: server.name,
          url: server.url,
        });
      }
    }
  } catch (error) {
    desktopLogger.warn(
      `[desktop] could not save renamed Connect servers: ${describeError(error)}`,
    );
  }
  let renamed = false;
  for (const session of windowSessions.values()) {
    const stored = store.getWindowTarget(session.stateKey);
    if (
      session.target.kind === "connect" &&
      stored?.kind === "connect" &&
      !isSameServerTarget(session.target, stored)
    ) {
      session.target = stored;
      renamed = true;
    }
  }
  if (renamed) {
    reconcileServerServices();
    refreshServerChoices();
  }
}

async function runDesktopApp(): Promise<void> {
  ensurePackagedUserShellPath({
    env: process.env,
    isPackaged: app.isPackaged,
    logger: desktopLogger,
    platform: process.platform,
  });

  const applicationName = app.isPackaged
    ? DESKTOP_RELEASE_INFO.applicationName
    : "bb-dev";
  app.setName(applicationName);
  installAboutPanel(applicationName);

  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }

  app.on("second-instance", () => {
    if (desktopWindowFactory?.focusFirstWindow() === true) {
      return;
    }
    void openApplicationWindow({
      stateKey: null,
      target: defaultServerTarget(),
    }).catch(logWindowOpenError);
  });
  app.on("before-quit", handleBeforeQuit);
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });
  app.on("activate", () => {
    if (desktopWindowFactory?.hasOpenWindows() === false) {
      void openApplicationWindow({
        stateKey: null,
        target: defaultServerTarget(),
      }).catch(logWindowOpenError);
    }
  });
  app.on("did-become-active", () => {
    void desktopUpdateService?.checkAfterActive();
    void desktopAutoUpdateService?.checkAfterActive();
    for (const sync of systemConfigSyncs.values()) {
      sync.refresh();
    }
    for (const renewal of connectSessionRenewals.values()) {
      renewal.renewIfDue();
    }
  });
  app.on("browser-window-focus", (_event, browserWindow) => {
    const session = windowSessions.get(browserWindow.webContents.id);
    if (session === undefined) {
      return;
    }
    lastFocusedWebContentsId = session.webContentsId;
    persistServerTargets(serverTargetStore?.setDefaultTarget(session.target));
    if (session.themePreference !== null) {
      nativeTheme.themeSource = session.themePreference;
    }
    rebuildApplicationMenu();
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
    async stopOwnedRuntime() {
      quitting = true;
      await stopOwnedRuntime();
    },
  });

  await app.whenReady();
  if (app.isPackaged) {
    await electronSession.defaultSession.clearCache();
  }

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
  const browserPagePreloadPath = join(
    paths.appPath,
    "dist",
    "browser-page-preload.cjs",
  );
  const findBarPreloadPath = join(
    paths.appPath,
    "dist",
    "find-bar-preload.cjs",
  );
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
    label: "browser page preload script",
    path: browserPagePreloadPath,
  });
  assertPathExists({
    label: "find bar preload script",
    path: findBarPreloadPath,
  });
  assertPathExists({
    label: "server URL dialog preload script",
    path: resolvedServerUrlDialogPreloadPath,
  });
  assertPathExists({ label: "app icon", path: iconPath });

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
  const dataDir = resolveDataDirFromEnv({
    env: process.env,
    homeDir: homedir(),
  });
  builtinDataDir = dataDir;
  serverMoveNoticeStore = createServerMoveNoticeStore({
    storagePath: join(userDataPath, SERVER_MOVE_NOTICE_FILE_NAME),
  });
  machineServiceNoticeStore = createServerMoveNoticeStore({
    storagePath: join(userDataPath, MACHINE_SERVICE_NOTICE_FILE_NAME),
  });
  connectCredentialCache = createConnectCredentialCache({
    encryption: safeStorage,
    userDataPath,
  });
  cachedConnectCredential = await connectCredentialCache.read();
  connectServerSync = createConnectServerSync({
    getCredential: () => cachedConnectCredential,
    getLocalServerUrl: () =>
      localServerMove === null ? (currentRuntime?.serverUrl ?? null) : null,
    onUnauthorized() {
      void clearCachedConnectCredential();
    },
    onSkipped(reason) {
      connectServerSyncSkipReason = reason;
      refreshServerChoices();
    },
    onServers(servers) {
      connectAccountServers = servers;
      connectServerSyncSkipReason = null;
      refreshServerChoices();
      void refreshConnectServerNames(servers);
    },
    log: (message) => {
      desktopLogger.info(`[desktop] ${message}`);
    },
  });
  connectServerSync.start();

  const desktopUpdateSupport = resolveDesktopUpdateSupport({
    canReplaceAppImage,
    env: process.env,
    platform: desktopPlatform,
  });
  desktopUpdateService = createDesktopUpdateService({
    channel: DESKTOP_RELEASE_CHANNEL,
    currentVersion: desktopVersion,
    enabled:
      desktopUpdateSupport.versionCheck &&
      (app.isPackaged || process.env.BB_DESKTOP_VERSION_CHECK === "1"),
    feedUrl: desktopUpdateFeedUrl,
    logger: desktopLogger,
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
    logger: desktopLogger,
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
  desktopFindViewManager = createDesktopFindViewManager({
    preloadPath: findBarPreloadPath,
  });
  ipcMain.on(BB_DESKTOP_OPEN_WINDOW_FIND_CHANNEL, (event, payload: unknown) => {
    if (
      !applicationWindowWebContentsIds.has(event.sender.id) ||
      event.senderFrame !== event.sender.mainFrame
    ) {
      return;
    }
    const parsed = bbDesktopWindowFindRequestSchema.safeParse(payload);
    const browserWindow = resolveApplicationWindow(event.sender);
    if (!parsed.success || browserWindow === null) {
      return;
    }
    desktopFindViewManager?.open(browserWindow, parsed.data);
  });
  ipcMain.on(BB_DESKTOP_RELOAD_WINDOW_CHANNEL, (event) => {
    if (
      !applicationWindowWebContentsIds.has(event.sender.id) ||
      event.senderFrame !== event.sender.mainFrame
    ) {
      return;
    }
    const browserWindow = resolveApplicationWindow(event.sender);
    if (browserWindow !== null) {
      reloadApplicationWindow(browserWindow, false);
    }
  });
  void removeLegacyAutomationPartitions(userDataPath).catch(() => {});
  desktopBrowserViewManager = createDesktopBrowserViewManager({
    pagePreloadPath: browserPagePreloadPath,
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
    resolveAppCommand(input, hostWebContentsId) {
      return resolveDesktopBrowserAppCommand({
        input,
        platform: process.platform,
        keybindings:
          keybindingsForSession(windowSessions.get(hostWebContentsId)) ?? [],
        splitNavigationEnabled:
          splitNavigationEnabledWebContentsIds.has(hostWebContentsId),
        splitNavigationCommands:
          splitNavigationCommandsByWebContentsId.get(hostWebContentsId),
      });
    },
  });
  registerDesktopBrowserIpc(desktopBrowserViewManager);
  const browserImportService = createBrowserImportService({
    context: {
      platform: process.platform,
      home: homedir(),
      configHome: process.env.XDG_CONFIG_HOME,
      excludedDirectories: [app.getPath("userData")],
    },
    resolveIcon: (appPath) => readMacAppIcon(appPath),
    log(message, details) {
      desktopLogger.info(
        `[desktop] ${message}${details ? ` ${JSON.stringify(details)}` : ""}`,
      );
    },
  });
  desktopBrowserBroker = createDesktopBrowserBroker({
    manager: desktopBrowserViewManager,
    product: `Chrome/${process.versions.chrome}`,
    browserImport: browserImportService,
  });
  ipcMain.handle(
    BB_DESKTOP_BROWSER_LIST_IMPORT_SOURCES_CHANNEL,
    async (event) => {
      if (!applicationWindowWebContentsIds.has(event.sender.id)) return null;
      return { sources: await browserImportService.listSources() };
    },
  );
  ipcMain.handle(
    BB_DESKTOP_BROWSER_IMPORT_COOKIES_CHANNEL,
    async (event, payload: unknown) => {
      const parsed =
        bbDesktopBrowserImportCookiesRequestSchema.safeParse(payload);
      if (
        !parsed.success ||
        !applicationWindowWebContentsIds.has(event.sender.id)
      )
        return null;
      const manager = desktopBrowserViewManager;
      if (!manager) return null;
      return browserImportService.importCookies(
        {
          sourceId: parsed.data.sourceId,
          sourceProfileDirectory: parsed.data.sourceProfileDirectory,
        },
        manager.session(),
      );
    },
  );
  ipcMain.on(
    BB_DESKTOP_BROWSER_OPEN_FULL_DISK_ACCESS_SETTINGS_CHANNEL,
    (event) => {
      if (
        !applicationWindowWebContentsIds.has(event.sender.id) ||
        process.platform !== "darwin"
      )
        return;
      void shell.openExternal(
        "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles",
      );
    },
  );
  ipcMain.handle(BB_DESKTOP_BROWSER_TARGET_CHANNEL, (event) => {
    return applicationWindowWebContentsIds.has(event.sender.id)
      ? (desktopBrowserBroker?.getTarget(event.sender.id) ?? null)
      : null;
  });
  ipcMain.handle(
    BB_DESKTOP_BROWSER_GET_CONTROL_CHANNEL,
    (event, payload: unknown) => {
      const parsed = bbDesktopBrowserTabRefSchema.safeParse(payload);
      return parsed.success &&
        applicationWindowWebContentsIds.has(event.sender.id)
        ? (desktopBrowserBroker?.getControl(
            event.sender.id,
            parsed.data.tabId,
          ) ?? null)
        : null;
    },
  );
  ipcMain.on(
    BB_DESKTOP_BROWSER_RELEASE_CONTROL_CHANNEL,
    (event, payload: unknown) => {
      const parsed = bbDesktopBrowserTabRefSchema.safeParse(payload);
      if (
        parsed.success &&
        applicationWindowWebContentsIds.has(event.sender.id)
      )
        desktopBrowserBroker?.takeOver(event.sender.id, parsed.data.tabId);
    },
  );
  if (desktopUpdateSupport.versionCheck) {
    desktopUpdateService.start();
  }
  if (desktopUpdateSupport.autoUpdate) {
    desktopAutoUpdateService.start();
  } else {
    desktopLogger.info(
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
    shouldUseDarkColors() {
      return nativeTheme.shouldUseDarkColors;
    },
    displayWorkAreas: null,
    icon: nativeImage.createFromPath(iconPath),
    isLinuxTransparent: hasLinuxWindowArgument({
      argument: LINUX_TRANSPARENT_WINDOW_ARGUMENT,
      argv: process.argv,
      platform: process.platform,
    }),
    isMac: process.platform === "darwin",
    isLinuxFrameless: hasLinuxWindowArgument({
      argument: LINUX_FRAMELESS_WINDOW_ARGUMENT,
      argv: process.argv,
      platform: process.platform,
    }),
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

  rebuildApplicationMenu();
  const targetStore = serverTargetStore;
  const sessions: ApplicationWindowSession[] = [];
  for (const created of await desktopWindowFactory.restoreSavedWindows()) {
    const session = registerApplicationWindow(
      created,
      targetStore.getWindowTarget(created.stateKey) ??
        targetStore.getDefaultTarget(),
    );
    if (session !== null) {
      sessions.push(session);
    }
  }
  persistServerTargets(
    targetStore.pruneWindowTargets(
      new Set(sessions.map((session) => session.stateKey)),
    ),
  );
  for (const session of sessions) {
    persistServerTargets(
      targetStore.setWindowTarget(session.stateKey, session.target),
    );
  }
  refreshServerChoices();
  await Promise.all(sessions.map((session) => loadLoadingView(session)));
  await activateLocalServerMoveIfLocked();
  if (
    localServerMove === null &&
    sessions.some((session) => session.target.kind === "builtin")
  ) {
    void ensureBuiltinRuntime({ startup: true });
  }
  await Promise.all(sessions.map((session) => applyWindowTarget(session)));
  if (sessions.some((session) => session.target.kind !== "builtin")) {
    connectServerSync.syncNow().catch(() => {});
  }
}

void runDesktopApp().catch((error) => {
  const message =
    error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`${message}\n`);
  void loadStartupErrorInAllWindows({
    details: message,
    logs: "",
    actions: [],
    title: "Could not open bb",
  });
});
