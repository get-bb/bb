import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import {
  app,
  BrowserWindow,
  clipboard,
  ipcMain,
  nativeImage,
  shell,
  type Event,
} from "electron";
import { autoUpdater } from "electron-updater";
import type { BbDesktopInfo } from "@bb/server-contract";
import { z } from "zod";
import {
  assertPathExists,
  resolveDesktopAssetPath,
  resolveDesktopBridgePath,
  type DesktopPathContext,
} from "./app-paths.js";
import {
  type BbAppProcess,
  type BbAppProcessExit,
  startBbAppProcess,
} from "./bb-process.js";
import { createLocalViewUrl } from "./local-view.js";
import { installApplicationMenu } from "./menu.js";
import {
  clearOwnedRuntimePidFile,
  reapStaleOwnedRuntime,
  writeOwnedRuntimePidFile,
} from "./owned-runtime-supervisor.js";
import {
  probeBbServer,
  waitForCompatibleServer,
  type ServerProbeResult,
} from "./server-probe.js";
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
import {
  createDesktopUpdateService,
  DESKTOP_UPDATE_FEED_URL,
  type DesktopUpdateService,
} from "./desktop-update-check.js";
import {
  createDesktopAutoUpdateService,
  createElectronAutoUpdaterAdapter,
  shouldEnableDesktopAutoUpdate,
  type DesktopAutoUpdateLogger,
  type DesktopAutoUpdateService,
} from "./desktop-auto-update.js";
import {
  BB_DESKTOP_CHECK_FOR_UPDATES_CHANNEL,
  BB_DESKTOP_GET_INFO_CHANNEL,
  BB_DESKTOP_INFO_CHANGED_CHANNEL,
  BB_DESKTOP_INSTALL_UPDATE_CHANNEL,
} from "./desktop-update-ipc.js";
import { ensurePackagedMacOsUserShellPath } from "./desktop-shell-path.js";
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

interface ResolveDesktopUpdateFeedUrlArgs {
  env: NodeJS.ProcessEnv;
}

interface MergeDesktopUpdateInfoArgs {
  autoInfo: BbDesktopInfo | null;
  feedInfo: BbDesktopInfo | null;
}

const logViewerCopyRequestSchema = z
  .object({
    text: z.string(),
  })
  .strict();

let desktopWindowFactory: DesktopWindowFactory | null = null;
let desktopUpdateService: DesktopUpdateService | null = null;
let desktopAutoUpdateService: DesktopAutoUpdateService | null = null;
let currentRuntime: DesktopRuntime | null = null;
let currentWindowUrl: string | null = null;
let logViewerIpcHandlersInstalled = false;
let logViewerLineBuffer: LogLineBuffer | null = null;
let logViewerPreloadPath: string | null = null;
let logViewerTailer: LogTailer | null = null;
let logViewerWindow: BrowserWindow | null = null;
let bbAppLoaded = false;
let stoppingForQuit = false;
let quitting = false;

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

function resolveDesktopUpdateFeedUrl(
  args: ResolveDesktopUpdateFeedUrlArgs,
): string {
  const rawFeedUrl = args.env.BB_DESKTOP_VERSION_FEED_URL?.trim();
  if (rawFeedUrl === undefined || rawFeedUrl.length === 0) {
    return DESKTOP_UPDATE_FEED_URL;
  }
  return rawFeedUrl;
}

function getDesktopVersion(version: string | undefined): string {
  if (version === undefined || version.length === 0) {
    throw new Error("Desktop version must be injected at build time");
  }
  return version;
}

function latestCheckedAt(
  left: string | null,
  right: string | null,
): string | null {
  if (left === null) {
    return right;
  }
  if (right === null) {
    return left;
  }
  return left > right ? left : right;
}

function mergeDesktopUpdateInfo(
  args: MergeDesktopUpdateInfoArgs,
): BbDesktopInfo | null {
  const baseInfo = args.feedInfo ?? args.autoInfo;
  if (baseInfo === null) {
    return null;
  }

  const feedUpdateAvailable = args.feedInfo?.updateAvailable ?? false;
  const autoUpdateAvailable = args.autoInfo?.updateAvailable ?? false;
  const updateDownloaded = args.autoInfo?.updateDownloaded ?? false;
  const pendingVersion = args.autoInfo?.pendingVersion ?? null;
  const latestVersion =
    pendingVersion ??
    args.feedInfo?.latestVersion ??
    args.autoInfo?.latestVersion ??
    null;

  return {
    ...baseInfo,
    lastCheckedAt: latestCheckedAt(
      args.feedInfo?.lastCheckedAt ?? null,
      args.autoInfo?.lastCheckedAt ?? null,
    ),
    latestVersion,
    pendingVersion,
    updateAvailable:
      feedUpdateAvailable || autoUpdateAvailable || updateDownloaded,
    updateDownloaded,
  };
}

function getCurrentDesktopInfo(): BbDesktopInfo | null {
  return mergeDesktopUpdateInfo({
    autoInfo: desktopAutoUpdateService?.getInfo() ?? null,
    feedInfo: desktopUpdateService?.getInfo() ?? null,
  });
}

function sendDesktopInfoChanged(): void {
  const info = getCurrentDesktopInfo();
  if (info === null) {
    return;
  }
  for (const browserWindow of BrowserWindow.getAllWindows()) {
    browserWindow.webContents.send(BB_DESKTOP_INFO_CHANGED_CHANNEL, info);
  }
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

function refreshApplicationMenu(): void {
  installApplicationMenu({
    createNewWindow() {
      void createApplicationWindow({ stateKey: null });
    },
    openServerDaemonLogs() {
      void openServerDaemonLogs();
    },
    serverDaemonLogsMenuEnabled: shouldEnableServerDaemonLogsMenu(),
  });
}

function setCurrentRuntime(runtime: DesktopRuntime | null): void {
  currentRuntime = runtime;
  refreshApplicationMenu();
  if (runtime?.ownership !== "spawned") {
    closeServerDaemonLogsWindow();
  }
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
  return !app.isPackaged || process.env.BB_DESKTOP_OPEN_DEVTOOLS === "1";
}

async function createApplicationWindow(
  args: CreateApplicationWindowArgs,
): Promise<DesktopBrowserWindow | null> {
  if (desktopWindowFactory === null) {
    return null;
  }

  const browserWindow = await desktopWindowFactory.createWindow({
    initialUrl: currentWindowUrl,
    stateKey: args.stateKey,
  });
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
  desktopUpdateService?.stop();
  desktopAutoUpdateService?.stop();
  await desktopWindowFactory?.persistOpenWindows();
  await stopOwnedRuntime();
}

function registerDesktopUpdateIpc(): void {
  ipcMain.handle(BB_DESKTOP_GET_INFO_CHANNEL, () => {
    return getCurrentDesktopInfo();
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
    quitting = true;
    stoppingForQuit = true;
    await finishQuit();
    desktopAutoUpdateService.installUpdate();
  });
}

async function startOwnedRuntime(
  args: StartOwnedRuntimeArgs,
): Promise<DesktopRuntime | null> {
  const bbProcess = startBbAppProcess({
    bridgePath: args.bridgePath,
    cwd: homedir(),
    env: process.env,
    logLineLimit: PROCESS_LOG_LINE_LIMIT,
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

async function initializeRuntime(args: InitializeRuntimeArgs): Promise<void> {
  const existingProbe = await probeBbServer({
    serverUrl: args.serverUrl,
    timeoutMs: ATTACH_PROBE_TIMEOUT_MS,
  });

  if (existingProbe.kind === "compatible") {
    setCurrentRuntime({
      bbProcess: null,
      ownership: "attached",
      serverUrl: existingProbe.serverUrl,
      userDataPath: null,
    });
    await loadBbApp(existingProbe.serverUrl);
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
    refreshApplicationMenu();
  }
}

async function runDesktopApp(): Promise<void> {
  ensurePackagedMacOsUserShellPath({
    env: process.env,
    isPackaged: app.isPackaged,
    logger: createDesktopLogger(),
    platform: process.platform,
  });

  app.setName("bb");

  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }

  app.on("second-instance", () => {
    if (desktopWindowFactory?.focusFirstWindow() === true) {
      return;
    }
    void createApplicationWindow({ stateKey: null });
  });
  app.on("before-quit", handleBeforeQuit);
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });
  app.on("activate", () => {
    if (desktopWindowFactory?.hasOpenWindows() === false) {
      void createApplicationWindow({ stateKey: null });
    }
  });
  app.on("did-become-active", () => {
    void desktopUpdateService?.checkAfterActive();
    void desktopAutoUpdateService?.checkAfterActive();
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

  const paths = createDesktopPathContext();
  const iconPath = resolveDesktopAssetPath({
    fileName: "icon.png",
    paths,
  });
  const bridgePath = resolveDesktopBridgePath({ paths });
  const resolvedLogViewerPreloadPath = join(
    paths.appPath,
    "dist",
    "log-viewer-preload.cjs",
  );
  const preloadPath = join(paths.appPath, "dist", "preload.cjs");
  const serverUrl = resolveDesktopServerUrl({ env: process.env });
  const desktopVersion = getDesktopVersion(process.env.BB_DESKTOP_VERSION);
  const desktopUpdateFeedUrl = resolveDesktopUpdateFeedUrl({
    env: process.env,
  });
  const userDataPath = app.getPath("userData");

  assertPathExists({ label: "bb-app bridge", path: bridgePath });
  assertPathExists({
    label: "log viewer preload script",
    path: resolvedLogViewerPreloadPath,
  });
  assertPathExists({ label: "preload script", path: preloadPath });
  assertPathExists({ label: "app icon", path: iconPath });

  if (process.platform === "darwin" && app.dock !== undefined) {
    app.dock.setIcon(iconPath);
  }
  await reapStaleOwnedRuntime({
    signal: "SIGTERM",
    timeoutMs: 5_000,
    userDataPath,
  });

  desktopUpdateService = createDesktopUpdateService({
    currentVersion: desktopVersion,
    enabled: app.isPackaged || process.env.BB_DESKTOP_VERSION_CHECK === "1",
    feedUrl: desktopUpdateFeedUrl,
    logger: createDesktopLogger(),
  });
  desktopAutoUpdateService = createDesktopAutoUpdateService({
    currentVersion: desktopVersion,
    enabled: shouldEnableDesktopAutoUpdate({
      env: process.env,
      isPackaged: app.isPackaged,
    }),
    forceDevUpdateConfig:
      !app.isPackaged && process.env.BB_DESKTOP_AUTO_UPDATE === "1",
    logger: createDesktopLogger(),
    updater: createElectronAutoUpdaterAdapter(autoUpdater),
  });
  desktopUpdateService.subscribe(() => {
    sendDesktopInfoChanged();
  });
  desktopAutoUpdateService.subscribe(() => {
    sendDesktopInfoChanged();
  });
  registerDesktopUpdateIpc();
  desktopUpdateService.start();
  desktopAutoUpdateService.start();

  const browserWindowCreator: DesktopBrowserWindowCreator = {
    create(options) {
      return new BrowserWindow(options);
    },
  };
  desktopWindowFactory = createDesktopWindowFactory({
    browserWindowCreator,
    createWindowStateKey() {
      return `window-${randomUUID()}`;
    },
    displayWorkAreas: null,
    icon: nativeImage.createFromPath(iconPath),
    isQuitting() {
      return quitting;
    },
    openExternalUrl(openArgs) {
      void shell.openExternal(openArgs.url);
    },
    preloadPath,
    userDataPath,
  });
  logViewerPreloadPath = resolvedLogViewerPreloadPath;
  installLogViewerIpcHandlers();

  refreshApplicationMenu();
  await loadLoadingView();
  await desktopWindowFactory.restoreSavedWindows({
    initialUrl: currentWindowUrl,
  });
  await initializeRuntime({ bridgePath, serverUrl, userDataPath });
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
