import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppCommandId } from "@bb/domain";
import type {
  BbDesktopApi,
  BbDesktopBrowserFindResult,
  BbDesktopBrowserOpenTabRequest,
  BbDesktopBrowserScopedOpenTabRequest,
  BbDesktopBrowserSnapshot,
  BbDesktopBrowserState,
  BbDesktopInfo,
  BbDesktopWindowState,
} from "@bb/desktop-contract";
import {
  BB_DESKTOP_INFO_CHANGED_CHANNEL,
} from "../src/desktop-update-ipc.js";
import {
  BB_DESKTOP_BROWSER_ATTACH_CHANNEL,
  BB_DESKTOP_BROWSER_FOCUSED_CHANNEL,
  BB_DESKTOP_BROWSER_EXPERIMENTAL_IMPORT_COOKIES_CHANNEL,
  BB_DESKTOP_BROWSER_EXPERIMENTAL_IMPORT_COOKIES_FROM_BROWSER_CHANNEL,
  BB_DESKTOP_BROWSER_EXPERIMENTAL_LIST_COOKIE_IMPORT_SOURCES_CHANNEL,
  BB_DESKTOP_BROWSER_EXPERIMENTAL_TRUST_LOCALHOST_CERTIFICATE_CHANNEL,
  BB_DESKTOP_BROWSER_EXPERIMENTAL_WAIT_EVENT_CHANNEL,
  BB_DESKTOP_BROWSER_FIND_RESULT_CHANNEL,
  BB_DESKTOP_BROWSER_OPEN_TAB_CHANNEL,
  BB_DESKTOP_BROWSER_SCOPED_OPEN_TAB_CHANNEL,
  BB_DESKTOP_BROWSER_SET_BOUNDS_CHANNEL,
  BB_DESKTOP_BROWSER_SNAPSHOT_CHANNEL,
  BB_DESKTOP_BROWSER_STATE_CHANNEL,
} from "../src/desktop-browser-ipc.js";
import {
  BB_DESKTOP_APP_COMMAND_CHANNEL,
  BB_DESKTOP_CLOSE_WINDOW_REQUEST_CHANNEL,
  BB_DESKTOP_CLOSE_WINDOW_RESPONSE_CHANNEL,
  BB_DESKTOP_OPEN_NEW_TAB_CHANNEL,
  BB_DESKTOP_OPEN_SERVER_DAEMON_LOGS_CHANNEL,
  BB_DESKTOP_WINDOW_STATE_CHANGED_CHANNEL,
} from "../src/desktop-window-command-ipc.js";
const electronMock = vi.hoisted(() => {
  interface IpcRendererEvent {}

  interface SendCall {
    channel: string;
    payload: unknown;
  }

  type IpcRendererListener = (
    event: IpcRendererEvent,
    payload: unknown,
  ) => void;

  const desktopInfo: BbDesktopInfo = {
    lastCheckedAt: null,
    latestVersion: null,
    pendingVersion: null,
    platform: "macos",
    updateAvailable: false,
    updateDownloaded: false,
    version: "0.0.0-test",
  };
  const desktopWindowState: BbDesktopWindowState = {
    isFullScreen: false,
  };
  const invokeCalls: string[] = [];
  const listeners = new Map<string, IpcRendererListener>();
  const sendCalls: SendCall[] = [];
  let exposedApi: BbDesktopApi | null = null;
  let exposedName: string | null = null;
  let zoomFactor = 1;

  return {
    get exposedApi() {
      return exposedApi;
    },
    get exposedName() {
      return exposedName;
    },
    invokeCalls,
    listeners,
    sendCalls,
    reset(): void {
      exposedApi = null;
      exposedName = null;
      invokeCalls.length = 0;
      listeners.clear();
      sendCalls.length = 0;
      zoomFactor = 1;
    },
    setZoomFactor(nextZoomFactor: number): void {
      zoomFactor = nextZoomFactor;
    },
    contextBridge: {
      exposeInMainWorld(name: string, api: unknown): void {
        if (name === "bbDesktop") {
          exposedName = name;
          exposedApi = api as BbDesktopApi;
        }
      },
    },
    ipcRenderer: {
      invoke(channel: string): Promise<
        | BbDesktopInfo
        | BbDesktopWindowState
        | { importedCookies: number }
        | {
            sources: {
              family: string;
              label: string;
              profiles: { id: string; label: string }[];
            }[];
          }
        | {
            navigationEpoch: number;
            requestId: string;
            value: { kind: "load-state"; state: "load" };
          }
        | {
            navigationEpoch: number;
            trustedOrigin: string;
          }
      > {
        invokeCalls.push(channel);
        if (channel === "bb-desktop:get-window-state") {
          return Promise.resolve(desktopWindowState);
        }
        if (
          channel === BB_DESKTOP_BROWSER_EXPERIMENTAL_IMPORT_COOKIES_CHANNEL ||
          channel ===
            BB_DESKTOP_BROWSER_EXPERIMENTAL_IMPORT_COOKIES_FROM_BROWSER_CHANNEL
        ) {
          return Promise.resolve({ importedCookies: 3 });
        }
        if (
          channel ===
          BB_DESKTOP_BROWSER_EXPERIMENTAL_LIST_COOKIE_IMPORT_SOURCES_CHANNEL
        ) {
          return Promise.resolve({
            sources: [
              {
                family: "chrome",
                label: "Google Chrome",
                profiles: [{ id: "Default", label: "Default" }],
              },
            ],
          });
        }
        if (channel === BB_DESKTOP_BROWSER_EXPERIMENTAL_WAIT_EVENT_CHANNEL) {
          return Promise.resolve({
            navigationEpoch: 0,
            requestId: "wait-1",
            value: { kind: "load-state", state: "load" },
          });
        }
        if (
          channel ===
          BB_DESKTOP_BROWSER_EXPERIMENTAL_TRUST_LOCALHOST_CERTIFICATE_CHANNEL
        ) {
          return Promise.resolve({
            navigationEpoch: 0,
            trustedOrigin: "localhost",
          });
        }
        return Promise.resolve(desktopInfo);
      },
      on(channel: string, listener: IpcRendererListener): void {
        listeners.set(channel, listener);
      },
      send(channel: string, payload: unknown): void {
        sendCalls.push({ channel, payload });
      },
    },
    webFrame: {
      getZoomFactor(): number {
        return zoomFactor;
      },
    },
  };
});

vi.mock("electron", () => ({
  contextBridge: electronMock.contextBridge,
  ipcRenderer: electronMock.ipcRenderer,
  webFrame: electronMock.webFrame,
}));

interface EmitIpcPayloadArgs {
  channel: string;
  payload: unknown;
}

async function loadPreload(): Promise<BbDesktopApi> {
  electronMock.reset();
  vi.resetModules();
  process.env.BB_DESKTOP_VERSION = "0.0.0-test";
  await import("../src/preload.js");
  const api = electronMock.exposedApi;
  expect(electronMock.exposedName).toBe("bbDesktop");
  expect(api).not.toBeNull();
  if (api === null) {
    throw new Error("Expected preload to expose window.bbDesktop.");
  }
  return api;
}

function emitIpcPayload(args: EmitIpcPayloadArgs): void {
  const listener = electronMock.listeners.get(args.channel);
  expect(listener).toBeDefined();
  if (listener === undefined) {
    throw new Error(`Expected listener for ${args.channel}.`);
  }
  listener({}, args.payload);
}

describe("desktop preload browser API", () => {
  let api: BbDesktopApi;

  beforeEach(async () => {
    api = await loadPreload();
  }, 30_000);


  it("accepts a bridged wait signal without event listener methods", async () => {
    const waitOptions = {
      signal: { aborted: false },
    } as unknown as { signal: AbortSignal };

    await expect(
      api.browser.experimental_waitBrowserEvent?.(
        {
          tabId: "browser:a",
          expectedNavigationEpoch: 0,
          requestId: "wait-1",
          criteria: {
            kind: "load-state",
            document: "current",
            state: "load",
          },
        },
        waitOptions,
      ),
    ).resolves.toEqual({
      navigationEpoch: 0,
      requestId: "wait-1",
      value: { kind: "load-state", state: "load" },
    });
  });


  it("converts zoomed renderer bounds to native window coordinates", () => {
    electronMock.setZoomFactor(1.25);

    api.browser.attach({
      tabId: "browser:zoomed",
      url: "https://example.com/",
      bounds: { x: 800, y: 40, width: 400, height: 600 },
      visible: false,
    });
    api.browser.setBounds({
      tabId: "browser:zoomed",
      bounds: { x: 801, y: 41, width: 399, height: 599 },
    });

    expect(electronMock.sendCalls).toEqual([
      {
        channel: BB_DESKTOP_BROWSER_ATTACH_CHANNEL,
        payload: {
          tabId: "browser:zoomed",
          url: "https://example.com/",
          bounds: { x: 1000, y: 50, width: 500, height: 750 },
          visible: false,
        },
      },
      {
        channel: BB_DESKTOP_BROWSER_SET_BOUNDS_CHANNEL,
        payload: {
          tabId: "browser:zoomed",
          bounds: { x: 1001, y: 51, width: 499, height: 749 },
        },
      },
    ]);
  });

  it("validates browser event payloads before notifying renderer listeners", () => {
    const states: BbDesktopBrowserState[] = [];
    const openTabs: BbDesktopBrowserOpenTabRequest[] = [];
    const scopedOpenTabs: BbDesktopBrowserScopedOpenTabRequest[] = [];
    const focusedTabs: string[] = [];
    const snapshots: BbDesktopBrowserSnapshot[] = [];
    const findResults: BbDesktopBrowserFindResult[] = [];
    let closeWindowRequestCount = 0;
    let openNewTabCount = 0;
    const appCommands: AppCommandId[] = [];
    const windowStates: BbDesktopWindowState[] = [];
    const state: BbDesktopBrowserState = {
      tabId: "browser:a",
      url: "https://example.com/",
      title: "Example",
      isLoading: false,
      canGoBack: false,
      canGoForward: true,
      errorText: null,
    };
    const openTab: BbDesktopBrowserOpenTabRequest = {
      url: "https://example.com/popup",
    };
    const scopedOpenTab: BbDesktopBrowserScopedOpenTabRequest = {
      tabId: "browser:a",
      url: "https://example.com/scoped-popup",
    };
    const snapshot: BbDesktopBrowserSnapshot = {
      tabId: "browser:a",
      dataUrl: null,
    };
    const findResult: BbDesktopBrowserFindResult = {
      tabId: "browser:a",
      requestId: 3,
      activeMatchOrdinal: 1,
      matches: 4,
      finalUpdate: true,
    };

    api.browser.onState((nextState) => {
      states.push(nextState);
    });
    api.browser.onOpenTab((request) => {
      openTabs.push(request);
    });
    api.browser.onScopedOpenTab?.((request) => {
      scopedOpenTabs.push(request);
    });
    api.browser.onFocus?.((tabId) => {
      focusedTabs.push(tabId);
    });
    api.browser.onSnapshot?.((nextSnapshot) => {
      snapshots.push(nextSnapshot);
    });
    api.browser.onFindResult?.((result) => {
      findResults.push(result);
    });
    api.onOpenNewTab?.(() => {
      openNewTabCount += 1;
    });
    api.onAppCommand?.((command) => {
      appCommands.push(command);
    });
    api.onCloseWindowRequest?.(() => {
      closeWindowRequestCount += 1;
      return true;
    });
    api.onWindowStateChange?.((windowState) => {
      windowStates.push(windowState);
    });

    emitIpcPayload({
      channel: BB_DESKTOP_BROWSER_STATE_CHANNEL,
      payload: { ...state, extra: true },
    });
    emitIpcPayload({
      channel: BB_DESKTOP_BROWSER_OPEN_TAB_CHANNEL,
      payload: { url: "" },
    });
    emitIpcPayload({
      channel: BB_DESKTOP_BROWSER_SCOPED_OPEN_TAB_CHANNEL,
      payload: { tabId: "", url: "https://example.com/scoped-popup" },
    });
    emitIpcPayload({
      channel: BB_DESKTOP_BROWSER_FOCUSED_CHANNEL,
      payload: { tabId: "", extra: true },
    });
    emitIpcPayload({
      channel: BB_DESKTOP_BROWSER_SNAPSHOT_CHANNEL,
      payload: { tabId: "browser:a", dataUrl: 42 },
    });
    emitIpcPayload({
      channel: BB_DESKTOP_BROWSER_FIND_RESULT_CHANNEL,
      payload: { ...findResult, matches: -1 },
    });
    emitIpcPayload({
      channel: BB_DESKTOP_BROWSER_FIND_RESULT_CHANNEL,
      payload: { ...findResult, selectionArea: {} },
    });
    emitIpcPayload({
      channel: BB_DESKTOP_WINDOW_STATE_CHANGED_CHANNEL,
      payload: { isFullScreen: false, extra: true },
    });
    emitIpcPayload({
      channel: BB_DESKTOP_BROWSER_STATE_CHANNEL,
      payload: state,
    });
    emitIpcPayload({
      channel: BB_DESKTOP_BROWSER_OPEN_TAB_CHANNEL,
      payload: openTab,
    });
    emitIpcPayload({
      channel: BB_DESKTOP_BROWSER_SCOPED_OPEN_TAB_CHANNEL,
      payload: scopedOpenTab,
    });
    emitIpcPayload({
      channel: BB_DESKTOP_BROWSER_FOCUSED_CHANNEL,
      payload: { tabId: "browser:a" },
    });
    emitIpcPayload({
      channel: BB_DESKTOP_BROWSER_SNAPSHOT_CHANNEL,
      payload: snapshot,
    });
    emitIpcPayload({
      channel: BB_DESKTOP_BROWSER_FIND_RESULT_CHANNEL,
      payload: findResult,
    });
    emitIpcPayload({
      channel: BB_DESKTOP_WINDOW_STATE_CHANGED_CHANNEL,
      payload: { isFullScreen: true },
    });
    emitIpcPayload({
      channel: BB_DESKTOP_OPEN_NEW_TAB_CHANNEL,
      payload: null,
    });
    emitIpcPayload({
      channel: BB_DESKTOP_APP_COMMAND_CHANNEL,
      payload: "not-a-command",
    });
    emitIpcPayload({
      channel: BB_DESKTOP_APP_COMMAND_CHANNEL,
      payload: "thread.new",
    });
    emitIpcPayload({
      channel: BB_DESKTOP_CLOSE_WINDOW_REQUEST_CHANNEL,
      payload: null,
    });

    expect(states).toEqual([state]);
    expect(openTabs).toEqual([openTab]);
    expect(scopedOpenTabs).toEqual([scopedOpenTab]);
    expect(focusedTabs).toEqual(["browser:a"]);
    expect(snapshots).toEqual([snapshot]);
    expect(findResults).toEqual([findResult]);
    expect(windowStates).toEqual([{ isFullScreen: true }]);
    expect(closeWindowRequestCount).toBe(1);
    expect(openNewTabCount).toBe(1);
    expect(appCommands).toEqual(["thread.new"]);
    expect(electronMock.sendCalls).toContainEqual({
      channel: BB_DESKTOP_CLOSE_WINDOW_RESPONSE_CHANNEL,
      payload: true,
    });
  });

  it("routes the log viewer request to main and mirrors its availability", async () => {
    await api.openServerDaemonLogs?.();
    expect(electronMock.invokeCalls).toContain(
      BB_DESKTOP_OPEN_SERVER_DAEMON_LOGS_CHANNEL,
    );

    expect(api.serverDaemonLogsAvailable).toBeUndefined();
    emitIpcPayload({
      channel: BB_DESKTOP_INFO_CHANGED_CHANNEL,
      payload: {
        lastCheckedAt: null,
        latestVersion: null,
        pendingVersion: null,
        platform: "macos",
        serverDaemonLogsAvailable: true,
        updateAvailable: false,
        updateDownloaded: false,
        version: "0.0.0-test",
      },
    });
    expect(api.serverDaemonLogsAvailable).toBe(true);
  });

  it("answers unhandled close-window requests so main closes the window", () => {
    emitIpcPayload({
      channel: BB_DESKTOP_CLOSE_WINDOW_REQUEST_CHANNEL,
      payload: null,
    });

    expect(electronMock.sendCalls).toContainEqual({
      channel: BB_DESKTOP_CLOSE_WINDOW_RESPONSE_CHANNEL,
      payload: false,
    });
  });
});
