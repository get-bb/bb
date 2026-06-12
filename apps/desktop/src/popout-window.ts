import {
  BrowserWindow,
  screen,
  type BrowserWindowConstructorOptions,
} from "electron";
import {
  BB_DESKTOP_POPOUT_HEIGHT_MAX,
  BB_DESKTOP_POPOUT_HEIGHT_MIN,
  type BbDesktopPopoutResizeRequest,
  type BbDesktopPopoutThreadRef,
} from "@bb/server-contract";
import { BB_DESKTOP_POPOUT_THREAD_CHANGED_CHANNEL } from "./popout-ipc.js";

const POPOUT_ROUTE_PATH = "/popout";
const POPOUT_WIDTH = 480;
const POPOUT_HEIGHT = 200;
const POPOUT_MIN_WIDTH = 420;
const POPOUT_MIN_HEIGHT = BB_DESKTOP_POPOUT_HEIGHT_MIN;

interface CreatePopoutWindowManagerArgs {
  appUrl: string;
  preloadPath: string;
  openExternalUrl(args: OpenExternalUrlArgs): void;
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

export interface PopoutWindowManager {
  destroy(): void;
  hide(): void;
  openInMain(thread: BbDesktopPopoutThreadRef): void;
  requestResize(request: BbDesktopPopoutResizeRequest): void;
  setCurrentThread(thread: BbDesktopPopoutThreadRef | null): void;
  setOpenInMainHandler(handler: PopoutOpenInMainHandler): void;
  setThread(thread: BbDesktopPopoutThreadRef): Promise<void>;
  toggle(): Promise<void>;
}

export type PopoutOpenInMainHandler = (
  thread: BbDesktopPopoutThreadRef,
) => Promise<void>;

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
    frame: false,
    fullscreenable: false,
    height: POPOUT_HEIGHT,
    minHeight: POPOUT_MIN_HEIGHT,
    minWidth: POPOUT_MIN_WIDTH,
    resizable: true,
    show: false,
    skipTaskbar: true,
    title: "bb Popout Chat",
    vibrancy: "under-window",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: args.preloadPath,
      sandbox: true,
    },
    width: POPOUT_WIDTH,
  };
}

async function loadUrlIntoPopout(
  args: LoadUrlIntoPopoutArgs,
): Promise<void> {
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

function clampPopoutHeight(height: number): number {
  return Math.min(
    Math.max(height, BB_DESKTOP_POPOUT_HEIGHT_MIN),
    BB_DESKTOP_POPOUT_HEIGHT_MAX,
  );
}

function setPopoutWindowPosition({
  browserWindow,
}: SetPopoutWindowPositionArgs): void {
  const cursor = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursor);
  const workArea = display.workArea;
  const bounds = browserWindow.getBounds();
  const width = Math.min(Math.max(bounds.width, POPOUT_MIN_WIDTH), workArea.width);
  const height = Math.min(
    Math.max(bounds.height, POPOUT_MIN_HEIGHT),
    workArea.height,
  );
  const x = workArea.x + Math.round((workArea.width - width) / 2);
  const upperThirdCenterY = workArea.y + Math.round(workArea.height / 3);
  const y = Math.min(
    Math.max(workArea.y, upperThirdCenterY - Math.round(height / 2)),
    workArea.y + workArea.height - height,
  );

  browserWindow.setBounds({ x, y, width, height });
}

function sendThreadChanged(
  browserWindow: BrowserWindow,
  thread: BbDesktopPopoutThreadRef | null,
): void {
  if (browserWindow.isDestroyed()) {
    return;
  }
  browserWindow.webContents.send(BB_DESKTOP_POPOUT_THREAD_CHANGED_CHANNEL, thread);
}

export function createPopoutWindowManager(
  args: CreatePopoutWindowManagerArgs,
): PopoutWindowManager {
  let popoutWindow: BrowserWindow | null = null;
  let currentThread: BbDesktopPopoutThreadRef | null = null;
  let destroyRequested = false;
  let openInMainHandler: PopoutOpenInMainHandler = async () => {};

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
    const browserWindow = new BrowserWindow(createPopoutWindowOptions(args));
    popoutWindow = browserWindow;
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
    });
    browserWindow.webContents.once("did-finish-load", () => {
      sendThreadChanged(browserWindow, currentThread);
    });
    void loadUrlIntoPopout({
      browserWindow,
      url: createPopoutUrl(args.appUrl),
    });
    return browserWindow;
  }

  async function show(): Promise<void> {
    const browserWindow = ensureWindow();
    setPopoutWindowPosition({ browserWindow });
    browserWindow.show();
    browserWindow.focus();
    sendThreadChanged(browserWindow, currentThread);
  }

  return {
    destroy(): void {
      destroyRequested = true;
      const browserWindow = getLiveWindow();
      popoutWindow = null;
      currentThread = null;
      if (browserWindow !== null) {
        browserWindow.destroy();
      }
    },
    hide(): void {
      getLiveWindow()?.hide();
    },
    openInMain(thread): void {
      void openInMainHandler(thread).finally(() => {
        getLiveWindow()?.hide();
      });
    },
    requestResize(request): void {
      const browserWindow = getLiveWindow();
      if (browserWindow === null) {
        return;
      }
      const bounds = browserWindow.getBounds();
      browserWindow.setSize(bounds.width, clampPopoutHeight(request.height));
      if (browserWindow.isVisible()) {
        setPopoutWindowPosition({ browserWindow });
      }
    },
    setCurrentThread(thread): void {
      currentThread = thread;
    },
    setOpenInMainHandler(handler): void {
      openInMainHandler = handler;
    },
    async setThread(thread): Promise<void> {
      currentThread = thread;
      await show();
      const browserWindow = getLiveWindow();
      if (browserWindow !== null) {
        sendThreadChanged(browserWindow, currentThread);
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
  };
}
