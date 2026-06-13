import {
  BrowserWindow,
  screen,
  type BrowserWindowConstructorOptions,
} from "electron";
import {
  POPOUT_ROUTE_PATH,
  POPOUT_WINDOW_HEIGHT,
  POPOUT_WINDOW_WIDTH,
  type BbDesktopPopoutMouseEventsIgnoredRequest,
  type BbDesktopPopoutThreadRef,
} from "@bb/server-contract";
import { BB_DESKTOP_POPOUT_THREAD_CHANGED_CHANNEL } from "./popout-ipc.js";

interface CreatePopoutWindowManagerArgs {
  appUrl: string;
  preloadPath: string;
  openExternalUrl(args: OpenExternalUrlArgs): void;
  openInMainHandler: PopoutOpenInMainHandler;
}

interface OpenExternalUrlArgs {
  url: string;
}

interface LoadUrlIntoPopoutArgs {
  browserWindow: BrowserWindow;
  url: string;
}

interface SetPopoutWindowPositionArgs {
  browserWindow: BrowserWindow;
}

interface ShouldRepositionPopoutWindowArgs {
  browserWindow: BrowserWindow;
  hasPositionedWindow: boolean;
}

interface CreatePopoutWindowReadinessArgs {
  browserWindow: BrowserWindow;
}

interface DisplayIdentity {
  height: number;
  width: number;
  x: number;
  y: number;
}

interface PopoutWindowReadiness {
  isReadyToReveal(): boolean;
  readyToRevealPromise: Promise<void>;
}

export interface PopoutWindowManager {
  destroy(): void;
  getCurrentThread(): BbDesktopPopoutThreadRef | null;
  openInMain(thread: BbDesktopPopoutThreadRef): void;
  ownsWebContents(webContents: Electron.WebContents): boolean;
  setMouseEventsIgnored(
    request: BbDesktopPopoutMouseEventsIgnoredRequest,
  ): void;
  setCurrentThread(thread: BbDesktopPopoutThreadRef | null): void;
  setThread(thread: BbDesktopPopoutThreadRef): Promise<void>;
  toggle(): Promise<void>;
  warm(): void;
}

export type PopoutOpenInMainHandler = (
  thread: BbDesktopPopoutThreadRef,
) => Promise<boolean>;

function createPopoutUrl(appUrl: string): string {
  const url = new URL(appUrl);
  url.pathname = POPOUT_ROUTE_PATH;
  url.search = "";
  url.hash = "";
  return url.toString();
}

function createPopoutWindowOptions(
  args: CreatePopoutWindowManagerArgs,
): BrowserWindowConstructorOptions {
  return {
    alwaysOnTop: true,
    backgroundColor: "#00000000",
    frame: false,
    fullscreenable: false,
    hasShadow: false,
    height: POPOUT_WINDOW_HEIGHT,
    paintWhenInitiallyHidden: true,
    resizable: false,
    show: false,
    skipTaskbar: true,
    title: "bb Popout Chat",
    transparent: true,
    webPreferences: {
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false,
      preload: args.preloadPath,
      sandbox: true,
    },
    width: POPOUT_WINDOW_WIDTH,
  };
}

async function loadUrlIntoPopout(args: LoadUrlIntoPopoutArgs): Promise<void> {
  try {
    await args.browserWindow.loadURL(args.url);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("ERR_ABORTED")) {
      return;
    }
    throw error;
  }
}

function setPopoutWindowPosition({
  browserWindow,
}: SetPopoutWindowPositionArgs): void {
  const cursor = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursor);
  const workArea = display.workArea;
  const bounds = browserWindow.getBounds();
  const width = Math.min(bounds.width, workArea.width);
  const height = Math.min(bounds.height, workArea.height);
  const x = workArea.x + Math.round((workArea.width - width) / 2);
  const upperThirdCenterY = workArea.y + Math.round(workArea.height / 3);
  const y = Math.min(
    Math.max(workArea.y, upperThirdCenterY - Math.round(height / 2)),
    workArea.y + workArea.height - height,
  );

  browserWindow.setBounds({ x, y, width, height });
}

function getDisplayIdentity(display: Electron.Display): DisplayIdentity {
  return {
    height: display.workArea.height,
    width: display.workArea.width,
    x: display.workArea.x,
    y: display.workArea.y,
  };
}

function areSameDisplay(
  left: Electron.Display,
  right: Electron.Display,
): boolean {
  const leftIdentity = getDisplayIdentity(left);
  const rightIdentity = getDisplayIdentity(right);
  return (
    leftIdentity.x === rightIdentity.x &&
    leftIdentity.y === rightIdentity.y &&
    leftIdentity.width === rightIdentity.width &&
    leftIdentity.height === rightIdentity.height
  );
}

function shouldRepositionPopoutWindow({
  browserWindow,
  hasPositionedWindow,
}: ShouldRepositionPopoutWindowArgs): boolean {
  if (!hasPositionedWindow) {
    return true;
  }
  const cursorDisplay = screen.getDisplayNearestPoint(
    screen.getCursorScreenPoint(),
  );
  const windowDisplay = screen.getDisplayMatching(browserWindow.getBounds());
  return !areSameDisplay(cursorDisplay, windowDisplay);
}

function sendThreadChanged(
  browserWindow: BrowserWindow,
  thread: BbDesktopPopoutThreadRef | null,
): void {
  if (browserWindow.isDestroyed()) {
    return;
  }
  browserWindow.webContents.send(
    BB_DESKTOP_POPOUT_THREAD_CHANGED_CHANNEL,
    thread,
  );
}

function areSameThreadRef(
  left: BbDesktopPopoutThreadRef | null,
  right: BbDesktopPopoutThreadRef | null,
): boolean {
  if (left === null || right === null) {
    return left === right;
  }
  return left.projectId === right.projectId && left.threadId === right.threadId;
}

function logOpenInMainFailure(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(
    `Could not open popout thread in main window: ${message}\n`,
  );
}

function createPopoutWindowReadiness({
  browserWindow,
}: CreatePopoutWindowReadinessArgs): PopoutWindowReadiness {
  let hasFinishedLoad = false;
  let hasFirstPaint = false;
  let isReadyToReveal = false;
  let resolveReadyToReveal: () => void = () => {};

  const readyToRevealPromise = new Promise<void>((resolve) => {
    resolveReadyToReveal = resolve;
  });

  function resolveIfReady(): void {
    if (isReadyToReveal || !hasFinishedLoad || !hasFirstPaint) {
      return;
    }
    isReadyToReveal = true;
    resolveReadyToReveal();
  }

  browserWindow.webContents.on("did-finish-load", () => {
    hasFinishedLoad = true;
    resolveIfReady();
  });
  browserWindow.on("ready-to-show", () => {
    hasFirstPaint = true;
    resolveIfReady();
  });

  return {
    isReadyToReveal() {
      return isReadyToReveal;
    },
    readyToRevealPromise,
  };
}

export function createPopoutWindowManager(
  args: CreatePopoutWindowManagerArgs,
): PopoutWindowManager {
  let popoutWindow: BrowserWindow | null = null;
  let currentThread: BbDesktopPopoutThreadRef | null = null;
  let lastSentThread: BbDesktopPopoutThreadRef | null = null;
  let hasSentThread = false;
  let hasPositionedWindow = false;
  let destroyRequested = false;
  let loadReadyPromise: Promise<void> | null = null;
  let windowReadiness: PopoutWindowReadiness | null = null;
  let hasLoggedWarmReadinessWait = false;

  function getLiveWindow(): BrowserWindow | null {
    if (popoutWindow === null || popoutWindow.isDestroyed()) {
      popoutWindow = null;
      return null;
    }
    return popoutWindow;
  }

  function ensureWindow(): BrowserWindow {
    const existingWindow = getLiveWindow();
    if (existingWindow !== null) {
      return existingWindow;
    }

    destroyRequested = false;
    lastSentThread = null;
    hasSentThread = false;
    hasPositionedWindow = false;
    hasLoggedWarmReadinessWait = false;
    const browserWindow = new BrowserWindow(createPopoutWindowOptions(args));
    popoutWindow = browserWindow;
    windowReadiness = createPopoutWindowReadiness({ browserWindow });
    browserWindow.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: true,
    });
    browserWindow.webContents.setWindowOpenHandler((details) => {
      args.openExternalUrl({ url: details.url });
      return { action: "deny" };
    });
    browserWindow.on("close", (event) => {
      if (destroyRequested) {
        return;
      }
      event.preventDefault();
      browserWindow.hide();
    });
    browserWindow.on("closed", () => {
      if (popoutWindow === browserWindow) {
        popoutWindow = null;
      }
      if (popoutWindow === null) {
        loadReadyPromise = null;
        windowReadiness = null;
        lastSentThread = null;
        hasSentThread = false;
        hasPositionedWindow = false;
        hasLoggedWarmReadinessWait = false;
      }
    });
    browserWindow.webContents.on("did-fail-load", () => {
      if (!browserWindow.isDestroyed()) {
        destroyRequested = true;
        browserWindow.destroy();
      }
    });
    loadReadyPromise = loadUrlIntoPopout({
      browserWindow,
      url: createPopoutUrl(args.appUrl),
    }).catch((error: unknown) => {
      if (!browserWindow.isDestroyed()) {
        destroyRequested = true;
        browserWindow.destroy();
      }
      throw error;
    });
    return browserWindow;
  }

  function sendThreadChangedIfNeeded(browserWindow: BrowserWindow): void {
    if (hasSentThread && areSameThreadRef(lastSentThread, currentThread)) {
      return;
    }
    sendThreadChanged(browserWindow, currentThread);
    lastSentThread = currentThread;
    hasSentThread = true;
  }

  async function show(): Promise<void> {
    const browserWindow = ensureWindow();
    const loadPromise = loadReadyPromise;
    const readiness = windowReadiness;
    if (readiness?.isReadyToReveal() !== true && !hasLoggedWarmReadinessWait) {
      hasLoggedWarmReadinessWait = true;
      process.stderr.write(
        "Popout chat summoned before hidden renderer first paint; waiting for warm readiness.\n",
      );
    }
    if (loadPromise !== null && readiness !== null) {
      await Promise.all([loadPromise, readiness.readyToRevealPromise]);
    } else {
      await loadPromise;
    }
    if (browserWindow.isDestroyed()) {
      return;
    }
    if (shouldRepositionPopoutWindow({ browserWindow, hasPositionedWindow })) {
      setPopoutWindowPosition({ browserWindow });
      hasPositionedWindow = true;
    }
    browserWindow.show();
    browserWindow.focus();
    sendThreadChangedIfNeeded(browserWindow);
  }

  return {
    destroy(): void {
      destroyRequested = true;
      const browserWindow = getLiveWindow();
      popoutWindow = null;
      currentThread = null;
      lastSentThread = null;
      hasSentThread = false;
      hasPositionedWindow = false;
      windowReadiness = null;
      hasLoggedWarmReadinessWait = false;
      if (browserWindow !== null) {
        browserWindow.destroy();
      }
    },
    getCurrentThread(): BbDesktopPopoutThreadRef | null {
      return currentThread;
    },
    openInMain(thread): void {
      void args
        .openInMainHandler(thread)
        .then((didOpen) => {
          if (didOpen) {
            getLiveWindow()?.hide();
          }
        })
        .catch((error: unknown) => {
          logOpenInMainFailure(error);
        });
    },
    ownsWebContents(webContents): boolean {
      const browserWindow = getLiveWindow();
      return browserWindow?.webContents === webContents;
    },
    setMouseEventsIgnored(request): void {
      const browserWindow = getLiveWindow();
      if (browserWindow === null) {
        return;
      }
      browserWindow.setIgnoreMouseEvents(request.ignore, { forward: true });
    },
    setCurrentThread(thread): void {
      currentThread = thread;
    },
    async setThread(thread): Promise<void> {
      currentThread = thread;
      await show();
      const browserWindow = getLiveWindow();
      if (browserWindow !== null) {
        sendThreadChangedIfNeeded(browserWindow);
      }
    },
    async toggle(): Promise<void> {
      const browserWindow = getLiveWindow();
      if (browserWindow !== null && browserWindow.isVisible()) {
        browserWindow.hide();
        return;
      }
      await show();
    },
    warm(): void {
      ensureWindow();
      const loadPromise = loadReadyPromise;
      const readiness = windowReadiness;
      if (loadPromise === null || readiness === null) {
        return;
      }
      void Promise.all([loadPromise, readiness.readyToRevealPromise]).catch(
        () => undefined,
      );
    },
  };
}
