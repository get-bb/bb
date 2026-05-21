import { contextBridge, ipcRenderer } from "electron";
import {
  bbDesktopInfoSchema,
  type BbDesktopApi,
  type BbDesktopInfo,
  type BbDesktopInfoChangeHandler,
  type BbDesktopInfoUnsubscribe,
} from "@bb/server-contract";
import {
  BB_DESKTOP_CHECK_FOR_UPDATES_CHANNEL,
  BB_DESKTOP_GET_INFO_CHANNEL,
  BB_DESKTOP_INFO_CHANGED_CHANNEL,
} from "./desktop-update-ipc.js";

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
    platform: "macos",
    updateAvailable: false,
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

const bbDesktopApi: BbDesktopApi = {
  get lastCheckedAt() {
    return currentInfo.lastCheckedAt;
  },
  get latestVersion() {
    return currentInfo.latestVersion;
  },
  platform: "macos",
  get updateAvailable() {
    return currentInfo.updateAvailable;
  },
  version: currentInfo.version,
  checkForUpdates() {
    return invokeDesktopInfo(BB_DESKTOP_CHECK_FOR_UPDATES_CHANNEL);
  },
  getInfo() {
    return invokeDesktopInfo(BB_DESKTOP_GET_INFO_CHANNEL);
  },
  onChange(
    listener: BbDesktopInfoChangeHandler,
  ): BbDesktopInfoUnsubscribe {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

ipcRenderer.on(BB_DESKTOP_INFO_CHANGED_CHANNEL, (_event, payload: unknown) => {
  applyDesktopInfoPayload(payload);
});

void invokeDesktopInfo(BB_DESKTOP_GET_INFO_CHANNEL);

contextBridge.exposeInMainWorld("bbDesktop", bbDesktopApi);
