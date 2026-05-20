import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { app, BrowserWindow, nativeImage, shell, type Event } from "electron";
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
  persistBrowserWindowState,
  restoreBrowserWindowState,
} from "./window-state.js";
import {
  ATTACH_PROBE_TIMEOUT_MS,
  DEFAULT_BB_SERVER_URL,
  MIN_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
  PROCESS_LOG_LINE_LIMIT,
  STARTUP_POLL_INTERVAL_MS,
  STARTUP_TIMEOUT_MS,
  type RuntimeOwnership,
} from "./types.js";

interface DesktopRuntime {
  bbProcess: BbAppProcess | null;
  ownership: RuntimeOwnership;
  serverUrl: string;
  userDataPath: string | null;
}

interface CreateMainWindowArgs {
  iconPath: string;
  preloadPath: string;
  userDataPath: string;
}

interface LoadStartupErrorArgs {
  details: string;
  logs: string;
  title: string;
}

interface LoadWindowUrlArgs {
  url: string;
}

interface StartOwnedRuntimeArgs {
  bridgePath: string;
  serverUrl: string;
  userDataPath: string;
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

let mainWindow: BrowserWindow | null = null;
let currentRuntime: DesktopRuntime | null = null;
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

async function loadWindowUrl(args: LoadWindowUrlArgs): Promise<void> {
  if (mainWindow === null) {
    return;
  }

  try {
    await mainWindow.loadURL(args.url);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("ERR_ABORTED")) {
      return;
    }
    throw error;
  }
}

async function createMainWindow(
  args: CreateMainWindowArgs,
): Promise<BrowserWindow> {
  const restoredState = await restoreBrowserWindowState({
    userDataPath: args.userDataPath,
  });
  const browserWindow = new BrowserWindow({
    height: restoredState.bounds.height,
    icon: nativeImage.createFromPath(args.iconPath),
    minHeight: MIN_WINDOW_HEIGHT,
    minWidth: MIN_WINDOW_WIDTH,
    show: false,
    title: "bb",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: args.preloadPath,
      sandbox: true,
    },
    width: restoredState.bounds.width,
    x: restoredState.bounds.x,
    y: restoredState.bounds.y,
  });

  if (restoredState.isMaximized) {
    browserWindow.maximize();
  }
  if (restoredState.isFullScreen) {
    browserWindow.setFullScreen(true);
  }

  browserWindow.once("ready-to-show", () => {
    browserWindow.show();
  });
  browserWindow.on("close", () => {
    void persistBrowserWindowState({
      browserWindow,
      userDataPath: args.userDataPath,
    });
  });
  browserWindow.on("closed", () => {
    mainWindow = null;
    if (!quitting) {
      app.quit();
    }
  });
  browserWindow.webContents.setWindowOpenHandler((details) => {
    void shell.openExternal(details.url);
    return { action: "deny" };
  });

  return browserWindow;
}

async function loadLoadingView(): Promise<void> {
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
  if (mainWindow === null) {
    return;
  }

  await loadWindowUrl({ url: serverUrl });
  if (!app.isPackaged || process.env.BB_DESKTOP_OPEN_DEVTOOLS === "1") {
    mainWindow.webContents.openDevTools({ mode: "detach" });
  }
}

async function stopOwnedRuntime(): Promise<void> {
  const runtime = currentRuntime;
  if (runtime === null || runtime.ownership !== "spawned") {
    currentRuntime = null;
    return;
  }

  currentRuntime = null;
  try {
    await runtime.bbProcess?.stop("SIGTERM");
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
  if (currentRuntime === null || currentRuntime.ownership !== "spawned") {
    return;
  }

  event.preventDefault();
  stoppingForQuit = true;
  void stopOwnedRuntime().finally(() => {
    app.quit();
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
  currentRuntime = runtime;

  void bbProcess.exit.then((exit) => {
    void clearOwnedRuntimePidFile({ userDataPath: args.userDataPath });
    if (quitting || currentRuntime !== runtime) {
      return;
    }
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
    currentRuntime = null;
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
    currentRuntime = {
      bbProcess: null,
      ownership: "attached",
      serverUrl: existingProbe.serverUrl,
      userDataPath: null,
    };
    await loadBbApp(existingProbe.serverUrl);
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
  }
}

async function runDesktopApp(): Promise<void> {
  app.setName("bb");

  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }

  app.on("second-instance", () => {
    if (mainWindow === null) {
      return;
    }
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.focus();
  });
  app.on("before-quit", handleBeforeQuit);
  app.on("window-all-closed", () => {
    app.quit();
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
  const preloadPath = join(paths.appPath, "dist", "preload.cjs");
  const serverUrl = resolveDesktopServerUrl({ env: process.env });
  const userDataPath = app.getPath("userData");

  assertPathExists({ label: "bb-app bridge", path: bridgePath });
  assertPathExists({ label: "preload script", path: preloadPath });
  assertPathExists({ label: "app icon", path: iconPath });

  installApplicationMenu();
  if (process.platform === "darwin" && app.dock !== undefined) {
    app.dock.setIcon(iconPath);
  }
  await reapStaleOwnedRuntime({
    signal: "SIGTERM",
    timeoutMs: 5_000,
    userDataPath,
  });

  mainWindow = await createMainWindow({
    iconPath,
    preloadPath,
    userDataPath,
  });
  await loadLoadingView();
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
