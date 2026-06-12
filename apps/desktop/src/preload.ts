import { contextBridge, ipcRenderer } from "electron";
import {
  bbDesktopBrowserOpenTabRequestSchema,
  bbDesktopBrowserSnapshotSchema,
  bbDesktopBrowserStateSchema,
  bbDesktopInfoSchema,
  bbDesktopPopoutMouseEventsIgnoredRequestSchema,
  bbDesktopPopoutThreadChangedPayloadSchema,
  type BbDesktopApi,
  type BbDesktopBrowserApi,
  type BbDesktopBrowserOpenTabHandler,
  type BbDesktopBrowserSnapshotHandler,
  type BbDesktopBrowserStateHandler,
  type BbDesktopBrowserUnsubscribe,
  type BbDesktopInfo,
  type BbDesktopInfoChangeHandler,
  type BbDesktopInfoUnsubscribe,
  type BbDesktopPopoutApi,
  type BbDesktopPopoutThreadChangedPayload,
  type BbDesktopPopoutThreadChangedHandler,
  type BbDesktopPopoutUnsubscribe,
  type BbDesktopTheme,
} from "@bb/server-contract";
import {
  BB_DESKTOP_CHECK_FOR_UPDATES_CHANNEL,
  BB_DESKTOP_GET_INFO_CHANNEL,
  BB_DESKTOP_INFO_CHANGED_CHANNEL,
  BB_DESKTOP_INSTALL_UPDATE_CHANNEL,
  BB_DESKTOP_OPEN_EXTERNAL_URL_CHANNEL,
  BB_DESKTOP_SET_THEME_CHANNEL,
} from "./desktop-update-ipc.js";
import {
  BB_DESKTOP_BROWSER_ATTACH_CHANNEL,
  BB_DESKTOP_BROWSER_DETACH_CHANNEL,
  BB_DESKTOP_BROWSER_GO_BACK_CHANNEL,
  BB_DESKTOP_BROWSER_GO_FORWARD_CHANNEL,
  BB_DESKTOP_BROWSER_NAVIGATE_CHANNEL,
  BB_DESKTOP_BROWSER_OPEN_TAB_CHANNEL,
  BB_DESKTOP_BROWSER_RELOAD_CHANNEL,
  BB_DESKTOP_BROWSER_SET_BOUNDS_CHANNEL,
  BB_DESKTOP_BROWSER_SET_VISIBLE_CHANNEL,
  BB_DESKTOP_BROWSER_SNAPSHOT_CHANNEL,
  BB_DESKTOP_BROWSER_STATE_CHANNEL,
  BB_DESKTOP_BROWSER_STOP_CHANNEL,
} from "./desktop-browser-ipc.js";
import {
  BB_DESKTOP_POPOUT_OPEN_IN_MAIN_CHANNEL,
  BB_DESKTOP_POPOUT_GET_CURRENT_THREAD_CHANNEL,
  BB_DESKTOP_POPOUT_SET_MOUSE_EVENTS_IGNORED_CHANNEL,
  BB_DESKTOP_POPOUT_SET_THREAD_CHANNEL,
  BB_DESKTOP_POPOUT_STATE_CHANGED_CHANNEL,
  BB_DESKTOP_POPOUT_THREAD_CHANGED_CHANNEL,
  BB_DESKTOP_POPOUT_TOGGLE_CHANNEL,
} from "./popout-ipc.js";

function getDesktopVersion(version: string | undefined): string {
  if (version === undefined || version.length === 0) {
    throw new Error("Desktop version must be injected at build time");
  }
  return version;
}

function createInitialDesktopInfo(): BbDesktopInfo {
  return {
    lastCheckedAt: null,
    latestVersion: null,
    pendingVersion: null,
    platform: "macos",
    updateAvailable: false,
    updateDownloaded: false,
    version: getDesktopVersion(process.env.BB_DESKTOP_VERSION),
  };
}

const listeners = new Set<BbDesktopInfoChangeHandler>();
let currentInfo = createInitialDesktopInfo();

function notifyListeners(): void {
  for (const listener of listeners) {
    listener(currentInfo);
  }
}

function applyDesktopInfoPayload(payload: unknown): BbDesktopInfo | null {
  const parsed = bbDesktopInfoSchema.safeParse(payload);
  if (!parsed.success) {
    return null;
  }
  currentInfo = parsed.data;
  notifyListeners();
  return currentInfo;
}

async function invokeDesktopInfo(channel: string): Promise<BbDesktopInfo> {
  try {
    const payload: unknown = await ipcRenderer.invoke(channel);
    return applyDesktopInfoPayload(payload) ?? currentInfo;
  } catch {
    return currentInfo;
  }
}

async function invokeInstallUpdate(): Promise<void> {
  try {
    await ipcRenderer.invoke(BB_DESKTOP_INSTALL_UPDATE_CHANNEL);
  } catch {
    return;
  }
}

const browserStateListeners = new Set<BbDesktopBrowserStateHandler>();
const browserOpenTabListeners = new Set<BbDesktopBrowserOpenTabHandler>();
const browserSnapshotListeners = new Set<BbDesktopBrowserSnapshotHandler>();
const popoutThreadChangedListeners =
  new Set<BbDesktopPopoutThreadChangedHandler>();

const bbBrowserApi: BbDesktopBrowserApi = {
  attach(request): void {
    ipcRenderer.send(BB_DESKTOP_BROWSER_ATTACH_CHANNEL, request);
  },
  detach(tabId): void {
    ipcRenderer.send(BB_DESKTOP_BROWSER_DETACH_CHANNEL, { tabId });
  },
  navigate(request): void {
    ipcRenderer.send(BB_DESKTOP_BROWSER_NAVIGATE_CHANNEL, request);
  },
  goBack(tabId): void {
    ipcRenderer.send(BB_DESKTOP_BROWSER_GO_BACK_CHANNEL, { tabId });
  },
  goForward(tabId): void {
    ipcRenderer.send(BB_DESKTOP_BROWSER_GO_FORWARD_CHANNEL, { tabId });
  },
  reload(tabId): void {
    ipcRenderer.send(BB_DESKTOP_BROWSER_RELOAD_CHANNEL, { tabId });
  },
  stop(tabId): void {
    ipcRenderer.send(BB_DESKTOP_BROWSER_STOP_CHANNEL, { tabId });
  },
  setBounds(request): void {
    ipcRenderer.send(BB_DESKTOP_BROWSER_SET_BOUNDS_CHANNEL, request);
  },
  setVisible(request): void {
    ipcRenderer.send(BB_DESKTOP_BROWSER_SET_VISIBLE_CHANNEL, request);
  },
  onState(listener): BbDesktopBrowserUnsubscribe {
    browserStateListeners.add(listener);
    return () => {
      browserStateListeners.delete(listener);
    };
  },
  onOpenTab(listener): BbDesktopBrowserUnsubscribe {
    browserOpenTabListeners.add(listener);
    return () => {
      browserOpenTabListeners.delete(listener);
    };
  },
  onSnapshot(listener): BbDesktopBrowserUnsubscribe {
    browserSnapshotListeners.add(listener);
    return () => {
      browserSnapshotListeners.delete(listener);
    };
  },
};

const bbPopoutApi: BbDesktopPopoutApi = {
  async getCurrentThread(): Promise<BbDesktopPopoutThreadChangedPayload> {
    try {
      const payload: unknown = await ipcRenderer.invoke(
        BB_DESKTOP_POPOUT_GET_CURRENT_THREAD_CHANNEL,
      );
      const parsed =
        bbDesktopPopoutThreadChangedPayloadSchema.safeParse(payload);
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  },
  toggle(): void {
    ipcRenderer.send(BB_DESKTOP_POPOUT_TOGGLE_CHANNEL);
  },
  setThread(thread): void {
    ipcRenderer.send(BB_DESKTOP_POPOUT_SET_THREAD_CHANNEL, thread);
  },
  stateChanged(thread): void {
    ipcRenderer.send(BB_DESKTOP_POPOUT_STATE_CHANGED_CHANNEL, thread);
  },
  openInMain(thread): void {
    ipcRenderer.send(BB_DESKTOP_POPOUT_OPEN_IN_MAIN_CHANNEL, thread);
  },
  setMouseEventsIgnored(request): void {
    const parsed =
      bbDesktopPopoutMouseEventsIgnoredRequestSchema.safeParse(request);
    if (!parsed.success) {
      return;
    }
    ipcRenderer.send(
      BB_DESKTOP_POPOUT_SET_MOUSE_EVENTS_IGNORED_CHANNEL,
      parsed.data,
    );
  },
  onThreadChanged(listener): BbDesktopPopoutUnsubscribe {
    popoutThreadChangedListeners.add(listener);
    return () => {
      popoutThreadChangedListeners.delete(listener);
    };
  },
};

const bbDesktopApi: BbDesktopApi = {
  browser: bbBrowserApi,
  popout: bbPopoutApi,
  get lastCheckedAt() {
    return currentInfo.lastCheckedAt;
  },
  get latestVersion() {
    return currentInfo.latestVersion;
  },
  get pendingVersion() {
    return currentInfo.pendingVersion;
  },
  platform: "macos",
  get updateAvailable() {
    return currentInfo.updateAvailable;
  },
  get updateDownloaded() {
    return currentInfo.updateDownloaded;
  },
  version: currentInfo.version,
  checkForUpdates() {
    return invokeDesktopInfo(BB_DESKTOP_CHECK_FOR_UPDATES_CHANNEL);
  },
  getInfo() {
    return invokeDesktopInfo(BB_DESKTOP_GET_INFO_CHANNEL);
  },
  installUpdate() {
    return invokeInstallUpdate();
  },
  onChange(listener: BbDesktopInfoChangeHandler): BbDesktopInfoUnsubscribe {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  openExternalUrl(url: string): void {
    ipcRenderer.send(BB_DESKTOP_OPEN_EXTERNAL_URL_CHANNEL, url);
  },
  setTheme(theme: BbDesktopTheme): void {
    ipcRenderer.send(BB_DESKTOP_SET_THEME_CHANNEL, theme);
  },
};

ipcRenderer.on(BB_DESKTOP_INFO_CHANGED_CHANNEL, (_event, payload: unknown) => {
  applyDesktopInfoPayload(payload);
});

ipcRenderer.on(BB_DESKTOP_BROWSER_STATE_CHANNEL, (_event, payload: unknown) => {
  const parsed = bbDesktopBrowserStateSchema.safeParse(payload);
  if (!parsed.success) {
    return;
  }
  for (const listener of browserStateListeners) {
    listener(parsed.data);
  }
});

ipcRenderer.on(
  BB_DESKTOP_BROWSER_OPEN_TAB_CHANNEL,
  (_event, payload: unknown) => {
    const parsed = bbDesktopBrowserOpenTabRequestSchema.safeParse(payload);
    if (!parsed.success) {
      return;
    }
    for (const listener of browserOpenTabListeners) {
      listener(parsed.data);
    }
  },
);

ipcRenderer.on(
  BB_DESKTOP_BROWSER_SNAPSHOT_CHANNEL,
  (_event, payload: unknown) => {
    const parsed = bbDesktopBrowserSnapshotSchema.safeParse(payload);
    if (!parsed.success) {
      return;
    }
    for (const listener of browserSnapshotListeners) {
      listener(parsed.data);
    }
  },
);

ipcRenderer.on(
  BB_DESKTOP_POPOUT_THREAD_CHANGED_CHANNEL,
  (_event, payload: unknown) => {
    const parsed = bbDesktopPopoutThreadChangedPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      return;
    }
    for (const listener of popoutThreadChangedListeners) {
      listener(parsed.data);
    }
  },
);

void invokeDesktopInfo(BB_DESKTOP_GET_INFO_CHANNEL);

contextBridge.exposeInMainWorld("bbDesktop", bbDesktopApi);
