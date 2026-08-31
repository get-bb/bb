import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BbDesktopApi } from "@bb/desktop-contract";
import { BB_DESKTOP_GET_WINDOW_IDENTITY_CHANNEL } from "../src/desktop-window-command-ipc.js";

const electronMock = vi.hoisted(() => {
  const invokeCalls: string[] = [];
  let exposedApi: BbDesktopApi | null = null;
  let windowIdentityPayload: unknown = null;

  return {
    get exposedApi() {
      return exposedApi;
    },
    invokeCalls,
    reset(): void {
      exposedApi = null;
      invokeCalls.length = 0;
      windowIdentityPayload = null;
    },
    setWindowIdentityPayload(payload: unknown): void {
      windowIdentityPayload = payload;
    },
    contextBridge: {
      exposeInMainWorld(name: string, api: unknown): void {
        if (name === "bbDesktop") {
          exposedApi = api as BbDesktopApi;
        }
      },
    },
    ipcRenderer: {
      invoke(channel: string): Promise<unknown> {
        invokeCalls.push(channel);
        if (channel === BB_DESKTOP_GET_WINDOW_IDENTITY_CHANNEL) {
          return Promise.resolve(windowIdentityPayload);
        }
        if (channel === "bb-desktop:get-window-state") {
          return Promise.resolve({ isFullScreen: false });
        }
        return Promise.resolve({
          lastCheckedAt: null,
          latestVersion: null,
          pendingVersion: null,
          platform: "macos",
          updateAvailable: false,
          updateDownloaded: false,
          version: "0.0.0-test",
        });
      },
      on(): void {},
      send(): void {},
    },
    webFrame: {
      getZoomFactor(): number {
        return 1;
      },
    },
  };
});

vi.mock("electron", () => ({
  contextBridge: electronMock.contextBridge,
  ipcRenderer: electronMock.ipcRenderer,
  webFrame: electronMock.webFrame,
}));

async function loadPreload(): Promise<BbDesktopApi> {
  electronMock.reset();
  vi.resetModules();
  process.env.BB_DESKTOP_VERSION = "0.0.0-test";
  await import("../src/preload.js");
  const api = electronMock.exposedApi;
  if (api === null) {
    throw new Error("Expected preload to expose window.bbDesktop.");
  }
  return api;
}

describe("desktop preload window identity", () => {
  beforeEach(() => {
    electronMock.reset();
  });

  it("resolves the identity issued by desktop main through the fixed invoke channel", async () => {
    const api = await loadPreload();
    electronMock.setWindowIdentityPayload({ windowId: "window-main-1" });

    await expect(api.getWindowIdentity?.()).resolves.toEqual({
      windowId: "window-main-1",
    });
    expect(electronMock.invokeCalls).toContain(
      BB_DESKTOP_GET_WINDOW_IDENTITY_CHANNEL,
    );
  });

  it("reports no identity when desktop main declines or answers with an invalid payload", async () => {
    const api = await loadPreload();

    electronMock.setWindowIdentityPayload(null);
    await expect(api.getWindowIdentity?.()).resolves.toBeNull();

    electronMock.setWindowIdentityPayload({ windowId: "" });
    await expect(api.getWindowIdentity?.()).resolves.toBeNull();

    electronMock.setWindowIdentityPayload({
      windowId: "window-main-1",
      tabs: [],
    });
    await expect(api.getWindowIdentity?.()).resolves.toBeNull();
  });
});
