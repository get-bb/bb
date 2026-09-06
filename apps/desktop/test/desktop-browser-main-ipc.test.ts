import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  BB_DESKTOP_BROWSER_MAX_URL_LENGTH,
  type BbDesktopBrowserAttachRequest,
  type BbDesktopBrowserFindInPageRequest,
  type BbDesktopBrowserNavigateRequest,
  type BbDesktopBrowserSetBoundsRequest,
  type BbDesktopBrowserSetVisibleRequest,
  type BbDesktopBrowserStopFindInPageRequest,
} from "@bb/desktop-contract";
import {
  BB_DESKTOP_BROWSER_ATTACH_CHANNEL,
  BB_DESKTOP_BROWSER_DETACH_CHANNEL,
  BB_DESKTOP_BROWSER_FOCUS_CHANNEL,
  BB_DESKTOP_BROWSER_FIND_IN_PAGE_CHANNEL,
  BB_DESKTOP_BROWSER_EXPERIMENTAL_CANCEL_PAGE_SCRIPT_CHANNEL,
  BB_DESKTOP_BROWSER_EXPERIMENTAL_CANCEL_CAPTURE_CHANNEL,
  BB_DESKTOP_BROWSER_EXPERIMENTAL_CAPTURE_PAGE_CHANNEL,
  BB_DESKTOP_BROWSER_EXPERIMENTAL_IMPORT_COOKIES_CHANNEL,
  BB_DESKTOP_BROWSER_EXPERIMENTAL_IMPORT_COOKIES_FROM_BROWSER_CHANNEL,
  BB_DESKTOP_BROWSER_EXPERIMENTAL_CLEAR_IMPORTED_COOKIES_CHANNEL,
  BB_DESKTOP_BROWSER_EXPERIMENTAL_LIST_COOKIE_IMPORT_SOURCES_CHANNEL,
  BB_DESKTOP_BROWSER_EXPERIMENTAL_READ_CAPTURE_CHUNK_CHANNEL,
  BB_DESKTOP_BROWSER_EXPERIMENTAL_RELEASE_CAPTURE_CHANNEL,
  BB_DESKTOP_BROWSER_EXPERIMENTAL_TRUST_LOCALHOST_CERTIFICATE_CHANNEL,
  BB_DESKTOP_BROWSER_EXPERIMENTAL_RUN_PAGE_SCRIPT_CHANNEL,
  BB_DESKTOP_BROWSER_GO_BACK_CHANNEL,
  BB_DESKTOP_BROWSER_GO_FORWARD_CHANNEL,
  BB_DESKTOP_BROWSER_NAVIGATE_CHANNEL,
  BB_DESKTOP_BROWSER_RELOAD_CHANNEL,
  BB_DESKTOP_BROWSER_SET_BOUNDS_CHANNEL,
  BB_DESKTOP_BROWSER_SET_VISIBLE_CHANNEL,
  BB_DESKTOP_BROWSER_SET_VISIBLE_WITHOUT_FOCUS_CHANNEL,
  BB_DESKTOP_BROWSER_STOP_CHANNEL,
  BB_DESKTOP_BROWSER_STOP_FIND_IN_PAGE_CHANNEL,
} from "../src/desktop-browser-ipc.js";
import { registerDesktopBrowserIpc } from "../src/desktop-browser-main-ipc.js";
import type { DesktopBrowserViewManager } from "../src/desktop-browser-view.js";

const electronMock = vi.hoisted(() => {
  interface FakeWebContents {
    id: number;
  }

  interface FakeBrowserWindow {
    label: string;
  }

  interface FakeIpcEvent {
    sender: FakeWebContents;
  }

  type FakeIpcListener = (event: FakeIpcEvent, payload: unknown) => void;
  type FakeIpcHandler = (
    event: FakeIpcEvent,
    payload: unknown,
  ) => Promise<unknown>;

  const listeners = new Map<string, FakeIpcListener>();
  const handlers = new Map<string, FakeIpcHandler>();
  const windowsBySender = new Map<FakeWebContents, FakeBrowserWindow>();

  return {
    listeners,
    handlers,
    windowsBySender,
    BrowserWindow: {
      fromWebContents(sender: FakeWebContents): FakeBrowserWindow | null {
        return windowsBySender.get(sender) ?? null;
      },
    },
    ipcMain: {
      handle(channel: string, handler: FakeIpcHandler): void {
        handlers.set(channel, handler);
      },
      on(channel: string, listener: FakeIpcListener): void {
        listeners.set(channel, listener);
      },
    },
  };
});

vi.mock("electron", () => ({
  BrowserWindow: electronMock.BrowserWindow,
  ipcMain: electronMock.ipcMain,
}));

type AttachCall = Parameters<DesktopBrowserViewManager["attach"]>[0];
type CloseCall = Parameters<DesktopBrowserViewManager["close"]>[0];
type DetachCall = Parameters<DesktopBrowserViewManager["detach"]>[0];
type FindInPageCall = Parameters<DesktopBrowserViewManager["findInPage"]>[0];
type StopFindInPageCall = Parameters<
  DesktopBrowserViewManager["stopFindInPage"]
>[0];
type NavigateCall = Parameters<DesktopBrowserViewManager["navigate"]>[0];
type SetBoundsCall = Parameters<DesktopBrowserViewManager["setBounds"]>[0];
type SetVisibleCall = Parameters<DesktopBrowserViewManager["setVisible"]>[0];
type TabCommandCall = Parameters<DesktopBrowserViewManager["reload"]>[0];
type WindowResizeCall = Parameters<
  DesktopBrowserViewManager["beginWindowResize"]
>[0];
type PageScriptCall = Parameters<DesktopBrowserViewManager["runPageScript"]>[0];
type PointerInputCall = Parameters<
  DesktopBrowserViewManager["sendPointerInput"]
>[0];
type ListFramesCall = Parameters<DesktopBrowserViewManager["listFrames"]>[0];
type TrustedInputCall = Parameters<
  DesktopBrowserViewManager["sendTrustedInput"]
>[0];
type WaitBrowserEventCall = Parameters<
  DesktopBrowserViewManager["waitForBrowserEvent"]
>[0];
type CancelBrowserEventCall = Parameters<
  DesktopBrowserViewManager["cancelBrowserEvent"]
>[0];
type CancelPageScriptCall = Parameters<
  DesktopBrowserViewManager["cancelPageScript"]
>[0];
type CapturePageCall = Parameters<DesktopBrowserViewManager["capturePage"]>[0];
type SetViewportProfileCall = Parameters<
  DesktopBrowserViewManager["setViewportProfile"]
>[0];
type ImportCookiesCall = Parameters<
  DesktopBrowserViewManager["importCookies"]
>[0];
type ListCookieImportSourcesCall = Parameters<
  DesktopBrowserViewManager["listCookieImportSources"]
>[0];
type ImportCookiesFromBrowserCall = Parameters<
  DesktopBrowserViewManager["importCookiesFromBrowser"]
>[0];
type ClearViewportProfileCall = Parameters<
  DesktopBrowserViewManager["clearViewportProfile"]
>[0];
type ClearImportedCookiesCall = Parameters<
  DesktopBrowserViewManager["clearImportedCookies"]
>[0];

interface FakeWebContents {
  id: number;
}

interface FakeBrowserWindow {
  label: string;
}

interface FakeRenderer {
  hostWindow: FakeBrowserWindow;
  sender: FakeWebContents;
}

interface SendBrowserIpcArgs {
  channel: string;
  payload: unknown;
  sender: FakeWebContents;
}

class RecordingDesktopBrowserViewManager implements DesktopBrowserViewManager {
  public readonly attachCalls: AttachCall[] = [];
  public readonly closeCalls: CloseCall[] = [];
  public readonly beginWindowResizeCalls: WindowResizeCall[] = [];
  public readonly destroyAllCalls: string[] = [];
  public readonly detachCalls: DetachCall[] = [];
  public readonly endWindowResizeCalls: WindowResizeCall[] = [];
  public readonly focusCalls: TabCommandCall[] = [];
  public readonly findInPageCalls: FindInPageCall[] = [];
  public readonly stopFindInPageCalls: StopFindInPageCall[] = [];
  public readonly goBackCalls: TabCommandCall[] = [];
  public readonly goForwardCalls: TabCommandCall[] = [];
  public readonly navigateCalls: NavigateCall[] = [];
  public readonly releaseWindowCalls: number[] = [];
  public readonly reloadCalls: TabCommandCall[] = [];
  public readonly trustLocalhostCertificateCalls: Array<{
    hostWindow: unknown;
    request: { tabId: string; expectedNavigationEpoch: number };
  }> = [];
  public readonly setBoundsCalls: SetBoundsCall[] = [];
  public readonly setVisibleCalls: SetVisibleCall[] = [];
  public readonly setVisibleWithoutFocusCalls: SetVisibleCall[] = [];
  public readonly stopCalls: TabCommandCall[] = [];
  public readonly pageScriptCalls: PageScriptCall[] = [];
  public readonly pointerInputCalls: PointerInputCall[] = [];
  public readonly setViewportProfileCalls: SetViewportProfileCall[] = [];
  public readonly clearViewportProfileCalls: ClearViewportProfileCall[] = [];
  public readonly cancelPageScriptCalls: CancelPageScriptCall[] = [];
  public readonly cancelTrustedInputCalls: Array<{
    hostWindow: unknown;
    tabId: string;
    requestId: string;
  }> = [];
  public readonly cancelPointerInputCalls: Array<{
    hostWindow: unknown;
    tabId: string;
    requestId: string;
  }> = [];
  public readonly cancelCaptureCalls: Array<{
    hostWindow: unknown;
    tabId: string;
    requestId: string;
  }> = [];
  public readonly capturePageCalls: CapturePageCall[] = [];
  public readonly readCaptureChunkCalls: Array<{
    hostWindow: unknown;
    request: { captureId: string; offset: number; length: number };
  }> = [];
  public readonly releaseCaptureCalls: Array<{
    hostWindow: unknown;
    request: { captureId: string };
  }> = [];
  public readonly importCookiesCalls: ImportCookiesCall[] = [];
  public readonly listCookieImportSourcesCalls: ListCookieImportSourcesCall[] =
    [];
  public readonly importCookiesFromBrowserCalls: ImportCookiesFromBrowserCall[] =
    [];
  public readonly clearImportedCookiesCalls: ClearImportedCookiesCall[] = [];

  attach(args: AttachCall): void {
    this.attachCalls.push(args);
  }

  beginWindowResize(hostWindow: WindowResizeCall): void {
    this.beginWindowResizeCalls.push(hostWindow);
  }

  prepareWindowReload(): void {}

  destroyAll(): void {
    this.destroyAllCalls.push("destroyAll");
  }

  detach(args: DetachCall): void {
    this.detachCalls.push(args);
  }

  close(args: CloseCall) {
    this.closeCalls.push(args);
    return { navigationEpoch: args.request.expectedNavigationEpoch };
  }
  async runAutomation(
    args: Parameters<DesktopBrowserViewManager["runAutomation"]>[0],
  ) {
    return {
      navigationEpoch: args.request.expectedNavigationEpoch,
      value: { ok: true },
    };
  }
  async importCookies(args: ImportCookiesCall) {
    this.importCookiesCalls.push(args);
    return { importedCookies: args.request.cookies.length };
  }
  listCookieImportSources(args: ListCookieImportSourcesCall) {
    this.listCookieImportSourcesCalls.push(args);
    return {
      sources: [
        {
          family: "chrome",
          label: "Google Chrome",
          profiles: [{ id: "Default", label: "Default" }],
        },
      ],
    };
  }

  async importCookiesFromBrowser(args: ImportCookiesFromBrowserCall) {
    this.importCookiesFromBrowserCalls.push(args);
    return { importedCookies: 3 };
  }

  async clearImportedCookies(args: ClearImportedCookiesCall) {
    this.clearImportedCookiesCalls.push(args);
  }

  endWindowResize(hostWindow: WindowResizeCall): void {
    this.endWindowResizeCalls.push(hostWindow);
  }

  focus(args: TabCommandCall): void {
    this.focusCalls.push(args);
  }

  findInPage(args: FindInPageCall): void {
    this.findInPageCalls.push(args);
  }

  stopFindInPage(args: StopFindInPageCall): void {
    this.stopFindInPageCalls.push(args);
  }

  goBack(args: TabCommandCall): void {
    this.goBackCalls.push(args);
  }

  goForward(args: TabCommandCall): void {
    this.goForwardCalls.push(args);
  }

  navigate(args: NavigateCall): void {
    this.navigateCalls.push(args);
  }

  releaseWindow(hostWebContentsId: number): void {
    this.releaseWindowCalls.push(hostWebContentsId);
  }

  reload(args: TabCommandCall): void {
    this.reloadCalls.push(args);
  }
  async trustLocalhostCertificate(args: {
    hostWindow: unknown;
    request: { tabId: string; expectedNavigationEpoch: number };
  }) {
    this.trustLocalhostCertificateCalls.push(args);
    return { navigationEpoch: 0, trustedOrigin: "localhost" };
  }

  setBounds(args: SetBoundsCall): void {
    this.setBoundsCalls.push(args);
  }

  setVisible(args: SetVisibleCall): void {
    this.setVisibleCalls.push(args);
  }

  setVisibleWithoutFocus(args: SetVisibleCall): void {
    this.setVisibleWithoutFocusCalls.push(args);
  }

  stop(args: TabCommandCall): void {
    this.stopCalls.push(args);
  }

  runPageScript(args: PageScriptCall) {
    this.pageScriptCalls.push(args);
    return Promise.resolve({
      requestId: args.request.requestId,
      navigationEpoch: 0,
      value: { ok: true },
    });
  }

  cancelPageScript(args: CancelPageScriptCall): void {
    this.cancelPageScriptCalls.push(args);
  }
  cancelTrustedInput(args: {
    hostWindow: unknown;
    tabId: string;
    requestId: string;
  }): void {
    this.cancelTrustedInputCalls.push(args);
  }

  cancelPointerInput(args: {
    hostWindow: unknown;
    tabId: string;
    requestId: string;
  }): void {
    this.cancelPointerInputCalls.push(args);
  }

  sendPointerInput(args: PointerInputCall) {
    this.pointerInputCalls.push(args);
    return Promise.resolve({
      navigationEpoch: args.request.expectedNavigationEpoch,
      dispatched: args.request.events.length,
    });
  }

  listFrames(args: ListFramesCall) {
    return Promise.resolve({
      navigationEpoch: args.request.expectedNavigationEpoch,
      frames: [],
    });
  }

  sendTrustedInput(args: TrustedInputCall) {
    return Promise.resolve({
      navigationEpoch: args.request.expectedNavigationEpoch,
      dispatched: 1,
    });
  }

  waitForBrowserEvent(args: WaitBrowserEventCall) {
    return Promise.reject(
      new Error(`Unexpected browser event wait: ${args.request.requestId}`),
    );
  }

  cancelBrowserEvent(_args: CancelBrowserEventCall): void {}

  setViewportProfile(args: SetViewportProfileCall) {
    this.setViewportProfileCalls.push(args);
    return {
      navigationEpoch: args.request.expectedNavigationEpoch,
      generation: 1,
      profile: args.request.profile,
    };
  }

  clearViewportProfile(args: ClearViewportProfileCall): void {
    this.clearViewportProfileCalls.push(args);
  }

  cancelCapture(args: {
    hostWindow: unknown;
    tabId: string;
    requestId: string;
  }): void {
    this.cancelCaptureCalls.push(args);
  }
  capturePage(args: CapturePageCall) {
    this.capturePageCalls.push(args);
    return Promise.resolve({
      navigationEpoch: 0,
      captureId: "cap-1",
      format: "png" as const,
      pixelSize: { width: 800, height: 600 },
      byteLength: 4,
    });
  }

  readCaptureChunk(args: {
    hostWindow: unknown;
    request: { captureId: string; offset: number; length: number };
  }) {
    this.readCaptureChunkCalls.push(args);
    return Promise.resolve({
      captureId: args.request.captureId,
      offset: args.request.offset,
      base64: "cG5n",
      eof: true,
    });
  }

  releaseCapture(args: {
    hostWindow: unknown;
    request: { captureId: string };
  }): void {
    this.releaseCaptureCalls.push(args);
  }
}

let nextWebContentsId = 1;

beforeEach(() => {
  electronMock.listeners.clear();
  electronMock.handlers.clear();
  electronMock.windowsBySender.clear();
  nextWebContentsId = 1;
});

function createTrustedRenderer(label: string): FakeRenderer {
  const sender = { id: nextWebContentsId };
  nextWebContentsId += 1;
  const hostWindow = { label };
  electronMock.windowsBySender.set(sender, hostWindow);
  return { hostWindow, sender };
}

function createUntrustedSender(): FakeWebContents {
  const sender = { id: nextWebContentsId };
  nextWebContentsId += 1;
  return sender;
}

function sendBrowserIpc(args: SendBrowserIpcArgs): void {
  const listener = electronMock.listeners.get(args.channel);
  if (listener === undefined) {
    throw new Error(`Expected listener for ${args.channel}.`);
  }
  listener({ sender: args.sender }, args.payload);
}

async function invokeBrowserIpc(args: SendBrowserIpcArgs): Promise<unknown> {
  const handler = electronMock.handlers.get(args.channel);
  if (handler === undefined) {
    throw new Error(`Expected handler for ${args.channel}.`);
  }
  return handler({ sender: args.sender }, args.payload);
}

function oversizedBrowserUrl(): string {
  return `https://example.com/${"a".repeat(BB_DESKTOP_BROWSER_MAX_URL_LENGTH)}`;
}

describe("registerDesktopBrowserIpc", () => {
  it("dispatches valid browser commands only from BrowserWindow-owned senders", () => {
    const manager = new RecordingDesktopBrowserViewManager();
    registerDesktopBrowserIpc(manager);
    const renderer = createTrustedRenderer("main-window");
    const untrustedSender = createUntrustedSender();
    const attachRequest: BbDesktopBrowserAttachRequest = {
      tabId: "browser:a",
      url: "http://localhost:5173/",
      bounds: { x: 0, y: 0, width: 800, height: 600 },
      visible: true,
    };
    const navigateRequest: BbDesktopBrowserNavigateRequest = {
      tabId: "browser:a",
      url: "https://example.com/",
    };

    sendBrowserIpc({
      channel: BB_DESKTOP_BROWSER_ATTACH_CHANNEL,
      payload: attachRequest,
      sender: renderer.sender,
    });
    sendBrowserIpc({
      channel: BB_DESKTOP_BROWSER_ATTACH_CHANNEL,
      payload: attachRequest,
      sender: untrustedSender,
    });
    sendBrowserIpc({
      channel: BB_DESKTOP_BROWSER_NAVIGATE_CHANNEL,
      payload: navigateRequest,
      sender: renderer.sender,
    });
    sendBrowserIpc({
      channel: BB_DESKTOP_BROWSER_RELOAD_CHANNEL,
      payload: { tabId: "browser:a" },
      sender: renderer.sender,
    });
    void invokeBrowserIpc({
      channel:
        BB_DESKTOP_BROWSER_EXPERIMENTAL_TRUST_LOCALHOST_CERTIFICATE_CHANNEL,
      payload: { tabId: "browser:a", expectedNavigationEpoch: 0 },
      sender: renderer.sender,
    });
    sendBrowserIpc({
      channel: BB_DESKTOP_BROWSER_FOCUS_CHANNEL,
      payload: { tabId: "browser:a" },
      sender: renderer.sender,
    });

    expect(manager.attachCalls).toHaveLength(1);
    expect(manager.attachCalls[0]?.hostWindow).toBe(renderer.hostWindow);
    expect(manager.attachCalls[0]?.request).toEqual(attachRequest);
    expect(manager.navigateCalls).toHaveLength(1);
    expect(manager.navigateCalls[0]?.hostWindow).toBe(renderer.hostWindow);
    expect(manager.navigateCalls[0]?.request).toEqual(navigateRequest);
    expect(manager.reloadCalls).toEqual([
      { hostWindow: renderer.hostWindow, tabId: "browser:a" },
    ]);
    expect(manager.trustLocalhostCertificateCalls).toEqual([
      {
        hostWindow: renderer.hostWindow,
        request: { tabId: "browser:a", expectedNavigationEpoch: 0 },
      },
    ]);
    expect(manager.focusCalls).toEqual([
      { hostWindow: renderer.hostWindow, tabId: "browser:a" },
    ]);
  });

  it("dispatches validated find-in-page requests and rejects malformed ones", () => {
    const manager = new RecordingDesktopBrowserViewManager();
    registerDesktopBrowserIpc(manager);
    const renderer = createTrustedRenderer("main-window");
    const untrustedSender = createUntrustedSender();
    const findRequest: BbDesktopBrowserFindInPageRequest = {
      tabId: "browser:a",
      text: "WebContents",
      forward: true,
      newSession: true,
    };
    const stopRequest: BbDesktopBrowserStopFindInPageRequest = {
      tabId: "browser:a",
      action: "clearSelection",
    };

    for (const payload of [
      { ...findRequest, text: "" },
      { ...findRequest, text: "a".repeat(1025) },
      { ...findRequest, forward: "yes" },
      { ...findRequest, extra: true },
      { tabId: "browser:a", text: "x" },
    ]) {
      sendBrowserIpc({
        channel: BB_DESKTOP_BROWSER_FIND_IN_PAGE_CHANNEL,
        payload,
        sender: renderer.sender,
      });
    }
    sendBrowserIpc({
      channel: BB_DESKTOP_BROWSER_FIND_IN_PAGE_CHANNEL,
      payload: findRequest,
      sender: untrustedSender,
    });
    sendBrowserIpc({
      channel: BB_DESKTOP_BROWSER_FIND_IN_PAGE_CHANNEL,
      payload: findRequest,
      sender: renderer.sender,
    });
    sendBrowserIpc({
      channel: BB_DESKTOP_BROWSER_STOP_FIND_IN_PAGE_CHANNEL,
      payload: { tabId: "browser:a", action: "explode" },
      sender: renderer.sender,
    });
    sendBrowserIpc({
      channel: BB_DESKTOP_BROWSER_STOP_FIND_IN_PAGE_CHANNEL,
      payload: stopRequest,
      sender: renderer.sender,
    });

    expect(manager.findInPageCalls).toEqual([
      { hostWindow: renderer.hostWindow, request: findRequest },
    ]);
    expect(manager.stopFindInPageCalls).toEqual([
      { hostWindow: renderer.hostWindow, request: stopRequest },
    ]);
  });

  it("rejects malformed attach and navigate payloads before manager dispatch", () => {
    const manager = new RecordingDesktopBrowserViewManager();
    registerDesktopBrowserIpc(manager);
    const renderer = createTrustedRenderer("main-window");
    const validAttachRequest: BbDesktopBrowserAttachRequest = {
      tabId: "browser:a",
      url: "",
      bounds: { x: 0, y: 0, width: 800, height: 600 },
      visible: false,
    };

    for (const payload of [
      { ...validAttachRequest, extra: true },
      { ...validAttachRequest, tabId: "" },
      { ...validAttachRequest, url: oversizedBrowserUrl() },
      { ...validAttachRequest, bounds: { x: 0, y: 0, width: -1, height: 600 } },
    ]) {
      sendBrowserIpc({
        channel: BB_DESKTOP_BROWSER_ATTACH_CHANNEL,
        payload,
        sender: renderer.sender,
      });
    }

    for (const payload of [
      { tabId: "browser:a", url: "" },
      { tabId: "browser:a", url: oversizedBrowserUrl() },
      { tabId: "browser:a", url: "https://example.com/", extra: true },
    ]) {
      sendBrowserIpc({
        channel: BB_DESKTOP_BROWSER_NAVIGATE_CHANNEL,
        payload,
        sender: renderer.sender,
      });
    }

    expect(manager.attachCalls).toEqual([]);
    expect(manager.navigateCalls).toEqual([]);
  });

  it("rejects malformed bounds, visibility, and tab-command payloads", async () => {
    const manager = new RecordingDesktopBrowserViewManager();
    registerDesktopBrowserIpc(manager);
    const renderer = createTrustedRenderer("main-window");
    const boundsRequest: BbDesktopBrowserSetBoundsRequest = {
      tabId: "browser:a",
      bounds: { x: 0, y: 0, width: 800, height: 600 },
    };
    const visibleRequest: BbDesktopBrowserSetVisibleRequest = {
      tabId: "browser:a",
      visible: true,
    };

    sendBrowserIpc({
      channel: BB_DESKTOP_BROWSER_SET_BOUNDS_CHANNEL,
      payload: {
        ...boundsRequest,
        bounds: { x: 0.5, y: 0, width: 1, height: 1 },
      },
      sender: renderer.sender,
    });
    sendBrowserIpc({
      channel: BB_DESKTOP_BROWSER_SET_BOUNDS_CHANNEL,
      payload: boundsRequest,
      sender: renderer.sender,
    });
    sendBrowserIpc({
      channel: BB_DESKTOP_BROWSER_SET_VISIBLE_CHANNEL,
      payload: { tabId: "browser:a", visible: "yes" },
      sender: renderer.sender,
    });
    sendBrowserIpc({
      channel: BB_DESKTOP_BROWSER_SET_VISIBLE_WITHOUT_FOCUS_CHANNEL,
      payload: visibleRequest,
      sender: renderer.sender,
    });
    sendBrowserIpc({
      channel: BB_DESKTOP_BROWSER_SET_VISIBLE_CHANNEL,
      payload: visibleRequest,
      sender: renderer.sender,
    });

    for (const channel of [
      BB_DESKTOP_BROWSER_DETACH_CHANNEL,
      BB_DESKTOP_BROWSER_FOCUS_CHANNEL,
      BB_DESKTOP_BROWSER_GO_BACK_CHANNEL,
      BB_DESKTOP_BROWSER_GO_FORWARD_CHANNEL,
      BB_DESKTOP_BROWSER_RELOAD_CHANNEL,
      BB_DESKTOP_BROWSER_STOP_CHANNEL,
    ]) {
      sendBrowserIpc({
        channel,
        payload: { tabId: "", extra: true },
        sender: renderer.sender,
      });
    }

    await expect(
      invokeBrowserIpc({
        channel:
          BB_DESKTOP_BROWSER_EXPERIMENTAL_TRUST_LOCALHOST_CERTIFICATE_CHANNEL,
        payload: { tabId: "", extra: true },
        sender: renderer.sender,
      }),
    ).rejects.toBeTruthy();
    sendBrowserIpc({
      channel: BB_DESKTOP_BROWSER_DETACH_CHANNEL,
      payload: { tabId: "browser:a" },
      sender: renderer.sender,
    });
    sendBrowserIpc({
      channel: BB_DESKTOP_BROWSER_GO_BACK_CHANNEL,
      payload: { tabId: "browser:a" },
      sender: renderer.sender,
    });
    sendBrowserIpc({
      channel: BB_DESKTOP_BROWSER_GO_FORWARD_CHANNEL,
      payload: { tabId: "browser:a" },
      sender: renderer.sender,
    });
    sendBrowserIpc({
      channel: BB_DESKTOP_BROWSER_STOP_CHANNEL,
      payload: { tabId: "browser:a" },
      sender: renderer.sender,
    });

    expect(manager.setBoundsCalls).toEqual([
      { hostWindow: renderer.hostWindow, request: boundsRequest },
    ]);
    expect(manager.setVisibleCalls).toEqual([
      { hostWindow: renderer.hostWindow, request: visibleRequest },
    ]);
    expect(manager.setVisibleWithoutFocusCalls).toEqual([
      { hostWindow: renderer.hostWindow, request: visibleRequest },
    ]);
    expect(manager.detachCalls).toEqual([
      { hostWindow: renderer.hostWindow, tabId: "browser:a" },
    ]);
    expect(manager.goBackCalls).toEqual([
      { hostWindow: renderer.hostWindow, tabId: "browser:a" },
    ]);
    expect(manager.goForwardCalls).toEqual([
      { hostWindow: renderer.hostWindow, tabId: "browser:a" },
    ]);
    expect(manager.stopCalls).toEqual([
      { hostWindow: renderer.hostWindow, tabId: "browser:a" },
    ]);
  });

  it("binds page-script run and cancellation to the IPC sender's window", async () => {
    const manager = new RecordingDesktopBrowserViewManager();
    registerDesktopBrowserIpc(manager);
    const renderer = createTrustedRenderer("main-window");
    const request = {
      tabId: "browser:a",
      requestId: "req_1",
      expectedNavigationEpoch: 0,
      source: "({ input }) => input",
      input: { intent: "inspect" },
      timeoutMs: 1_000,
    };

    await expect(
      invokeBrowserIpc({
        channel: BB_DESKTOP_BROWSER_EXPERIMENTAL_RUN_PAGE_SCRIPT_CHANNEL,
        payload: request,
        sender: renderer.sender,
      }),
    ).resolves.toEqual({
      requestId: "req_1",
      navigationEpoch: 0,
      value: { ok: true },
    });
    sendBrowserIpc({
      channel: BB_DESKTOP_BROWSER_EXPERIMENTAL_CANCEL_PAGE_SCRIPT_CHANNEL,
      payload: { tabId: "browser:a", requestId: "req_1" },
      sender: renderer.sender,
    });

    expect(manager.pageScriptCalls).toEqual([
      { hostWindow: renderer.hostWindow, request },
    ]);
    expect(manager.cancelPageScriptCalls).toEqual([
      {
        hostWindow: renderer.hostWindow,
        tabId: "browser:a",
        requestId: "req_1",
      },
    ]);
  });

  it("binds cookie import to the IPC sender's Browser tab", async () => {
    const manager = new RecordingDesktopBrowserViewManager();
    registerDesktopBrowserIpc(manager);
    const renderer = createTrustedRenderer("main-window");
    const request = {
      tabId: "browser:a",
      cookies: [
        {
          name: "session",
          value: "secret",
          domain: ".example.com",
          path: "/",
          secure: true,
          httpOnly: true,
          sameSite: "lax",
          expirationDate: null,
        },
      ],
    };

    await expect(
      invokeBrowserIpc({
        channel: BB_DESKTOP_BROWSER_EXPERIMENTAL_IMPORT_COOKIES_CHANNEL,
        payload: request,
        sender: renderer.sender,
      }),
    ).resolves.toEqual({ importedCookies: 1 });
    expect(manager.importCookiesCalls).toEqual([
      { hostWindow: renderer.hostWindow, request },
    ]);
  });

  it("binds native browser import source selection to the IPC sender's Browser tab", async () => {
    const manager = new RecordingDesktopBrowserViewManager();
    registerDesktopBrowserIpc(manager);
    const renderer = createTrustedRenderer("main-window");
    const listRequest = { tabId: "browser:a" };
    const importRequest = {
      family: "chrome",
      profileId: "Default",
      tabId: "browser:a",
    };

    await expect(
      invokeBrowserIpc({
        channel:
          BB_DESKTOP_BROWSER_EXPERIMENTAL_LIST_COOKIE_IMPORT_SOURCES_CHANNEL,
        payload: listRequest,
        sender: renderer.sender,
      }),
    ).resolves.toEqual({
      sources: [
        {
          family: "chrome",
          label: "Google Chrome",
          profiles: [{ id: "Default", label: "Default" }],
        },
      ],
    });
    await expect(
      invokeBrowserIpc({
        channel:
          BB_DESKTOP_BROWSER_EXPERIMENTAL_IMPORT_COOKIES_FROM_BROWSER_CHANNEL,
        payload: importRequest,
        sender: renderer.sender,
      }),
    ).resolves.toEqual({ importedCookies: 3 });
    await invokeBrowserIpc({
      channel: BB_DESKTOP_BROWSER_EXPERIMENTAL_CLEAR_IMPORTED_COOKIES_CHANNEL,
      payload: listRequest,
      sender: renderer.sender,
    });

    expect(manager.listCookieImportSourcesCalls).toEqual([
      { hostWindow: renderer.hostWindow, request: listRequest },
    ]);
    expect(manager.importCookiesFromBrowserCalls).toEqual([
      { hostWindow: renderer.hostWindow, request: importRequest },
    ]);
    expect(manager.clearImportedCookiesCalls).toEqual([
      { hostWindow: renderer.hostWindow, tabId: "browser:a" },
    ]);
  });

  it("rejects malformed capture requests and renderers without an owned window", async () => {
    const manager = new RecordingDesktopBrowserViewManager();
    registerDesktopBrowserIpc(manager);
    const renderer = createTrustedRenderer("main-window");
    const untrustedSender = createUntrustedSender();

    await expect(
      invokeBrowserIpc({
        channel: BB_DESKTOP_BROWSER_EXPERIMENTAL_CAPTURE_PAGE_CHANNEL,
        payload: { tabId: "browser:a", format: "webp" },
        sender: renderer.sender,
      }),
    ).rejects.toMatchObject({ name: "ZodError" });
    await expect(
      invokeBrowserIpc({
        channel: BB_DESKTOP_BROWSER_EXPERIMENTAL_READ_CAPTURE_CHUNK_CHANNEL,
        payload: { captureId: "cap-1", tabId: "browser:a", offset: 0 },
        sender: renderer.sender,
      }),
    ).rejects.toMatchObject({ name: "ZodError" });
    await expect(
      invokeBrowserIpc({
        channel: BB_DESKTOP_BROWSER_EXPERIMENTAL_RELEASE_CAPTURE_CHANNEL,
        payload: { captureId: "cap-1", tabId: "browser:a", extra: true },
        sender: renderer.sender,
      }),
    ).rejects.toMatchObject({ name: "ZodError" });
    await expect(
      invokeBrowserIpc({
        channel: BB_DESKTOP_BROWSER_EXPERIMENTAL_CAPTURE_PAGE_CHANNEL,
        payload: { tabId: "browser:a", format: "png", quality: 85 },
        sender: untrustedSender,
      }),
    ).rejects.toBeInstanceOf(Error);
    await expect(
      invokeBrowserIpc({
        channel: BB_DESKTOP_BROWSER_EXPERIMENTAL_RELEASE_CAPTURE_CHANNEL,
        payload: { captureId: "cap-1", tabId: "browser:a" },
        sender: untrustedSender,
      }),
    ).rejects.toBeInstanceOf(Error);
    expect(manager.capturePageCalls).toEqual([]);
    expect(manager.readCaptureChunkCalls).toEqual([]);
    expect(manager.releaseCaptureCalls).toEqual([]);
  });
  it("forwards capture cancellation only from the owning Browser renderer", () => {
    const manager = new RecordingDesktopBrowserViewManager();
    registerDesktopBrowserIpc(manager);
    const renderer = createTrustedRenderer("main-window");

    sendBrowserIpc({
      channel: BB_DESKTOP_BROWSER_EXPERIMENTAL_CANCEL_CAPTURE_CHANNEL,
      payload: { tabId: "browser:a", requestId: "capture-1" },
      sender: renderer.sender,
    });
    sendBrowserIpc({
      channel: BB_DESKTOP_BROWSER_EXPERIMENTAL_CANCEL_CAPTURE_CHANNEL,
      payload: { tabId: "browser:a" },
      sender: renderer.sender,
    });

    expect(manager.cancelCaptureCalls).toEqual([
      {
        hostWindow: renderer.hostWindow,
        tabId: "browser:a",
        requestId: "capture-1",
      },
    ]);
  });
});
