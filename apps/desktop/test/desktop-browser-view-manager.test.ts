import type { RenderProcessGoneDetails, WebContentsView } from "electron";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BbDesktopBrowserViewBounds } from "@bb/desktop-contract";
import {
  createDesktopBrowserViewManager as createProductionDesktopBrowserViewManager,
  isAllowedBrowserPermission,
  type CreateDesktopBrowserViewManagerArgs,
  type DesktopBrowserViewManager,
  type DesktopBrowserHostContentBounds,
  type DesktopBrowserHostContentView,
  type DesktopBrowserHostWebContents,
  type DesktopBrowserHostWebContentsPayload,
  type DesktopBrowserHostWindow,
} from "../src/desktop-browser-view.js";

function createDesktopBrowserViewManager(
  args: Partial<CreateDesktopBrowserViewManagerArgs> = {},
): DesktopBrowserViewManager {
  return createProductionDesktopBrowserViewManager({
    dispatchAppCommand: () => undefined,
    focusHostWebContents: () => undefined,
    resolveAppCommand: () => null,
    ...args,
  });
}

interface FakePreventableEvent {
  defaultPrevented: boolean;
  preventDefault(): void;
}

interface FakeWebContentsEvent {}

interface FakeNavigationEvent extends FakePreventableEvent {
  initiator?: FakeWebFrameMain | null;
  isMainFrame: boolean;
  url: string;
}

type FakeVoidWebContentsListener = () => void;

type FakeWillFrameNavigateListener = (event: FakeNavigationEvent) => void;

type FakeWillNavigateListener = (
  event: FakeNavigationEvent,
  url: string,
) => void;

type FakeWillRedirectListener = (
  event: FakeNavigationEvent,
  url: string,
  isInPlace: boolean,
  isMainFrame: boolean,
) => void;

type FakeDidNavigateListener = (
  event: FakeWebContentsEvent,
  url: string,
) => void;

type FakeDidNavigateInPageListener = (
  event: FakeWebContentsEvent,
  url: string,
  isMainFrame: boolean,
) => void;

type FakeDidFailLoadListener = (
  event: FakeWebContentsEvent,
  errorCode: number,
  errorDescription: string,
  validatedURL: string,
  isMainFrame: boolean,
) => void;

interface FakeContextMenuParams {
  editFlags: {
    canCopy: boolean;
    canCut: boolean;
    canPaste: boolean;
    canRedo: boolean;
    canSelectAll: boolean;
    canUndo: boolean;
  };
}

type FakeContextMenuListener = (
  event: FakeWebContentsEvent,
  params: FakeContextMenuParams,
) => void;

interface FakeInput {
  alt: boolean;
  control: boolean;
  isAutoRepeat: boolean;
  isComposing: boolean;
  key: string;
  meta: boolean;
  shift: boolean;
  type: string;
}

type FakeBeforeInputListener = (
  event: FakePreventableEvent,
  input: FakeInput,
) => void;

type FakeRenderProcessGoneDetails = Pick<
  RenderProcessGoneDetails,
  "exitCode" | "reason"
>;

type FakeRenderProcessGoneListener = (
  event: FakeWebContentsEvent,
  details: FakeRenderProcessGoneDetails,
) => void;

interface FakeFoundInPageResult {
  activeMatchOrdinal: number;
  finalUpdate: boolean;
  matches: number;
  requestId: number;
  selectionArea: { height: number; width: number; x: number; y: number };
}

type FakeFoundInPageListener = (
  event: FakeWebContentsEvent,
  result: FakeFoundInPageResult,
) => void;

interface FakeFindInPageCall {
  options: { findNext: boolean; forward: boolean };
  text: string;
}

interface FakeWebContentsEventMap {
  "before-input-event": FakeBeforeInputListener;
  "will-frame-navigate": FakeWillFrameNavigateListener;
  "will-navigate": FakeWillNavigateListener;
  "will-redirect": FakeWillRedirectListener;
  "did-start-loading": FakeVoidWebContentsListener;
  "did-stop-loading": FakeVoidWebContentsListener;
  "did-finish-load": FakeVoidWebContentsListener;
  "did-navigate": FakeDidNavigateListener;
  "did-navigate-in-page": FakeDidNavigateInPageListener;
  "did-start-navigation": FakeVoidWebContentsListener;
  "page-title-updated": FakeVoidWebContentsListener;
  "did-fail-load": FakeDidFailLoadListener;
  "context-menu": FakeContextMenuListener;
  "render-process-gone": FakeRenderProcessGoneListener;
  "found-in-page": FakeFoundInPageListener;
}

interface FakeWebFrameMain {
  origin: string;
}

interface FakeSessionEvent {
  preventDefault(): void;
}

type FakeSessionListener = (event: FakeSessionEvent) => void;

type FakePermissionRequestHandler = (
  webContents: unknown,
  permission: string,
  callback: (granted: boolean) => void,
) => void;

type FakePermissionCheckHandler = (
  webContents: unknown,
  permission: string,
) => boolean;

interface FakeWindowOpenDetails {
  url: string;
}

interface FakeWindowOpenDecision {
  action: "deny";
}

type FakeWindowOpenHandler = (
  details: FakeWindowOpenDetails,
) => FakeWindowOpenDecision;

const electronMock = vi.hoisted(() => {
  interface FakeNativeImage {
    isEmpty(): boolean;
    toJPEG(quality: number): Buffer;
  }

  interface FakeDidFailLoadArgs {
    errorCode: number;
    errorDescription: string;
    isMainFrame: boolean;
    validatedURL: string;
  }

  type FakeWebContentsListeners = {
    [TEventName in keyof FakeWebContentsEventMap]: Array<
      FakeWebContentsEventMap[TEventName]
    >;
  };

  class FakePreventableEventImpl implements FakePreventableEvent {
    public defaultPrevented = false;

    preventDefault(): void {
      this.defaultPrevented = true;
    }
  }

  class FakeNavigationEventImpl
    extends FakePreventableEventImpl
    implements FakeNavigationEvent
  {
    public readonly initiator?: FakeWebFrameMain | null;
    public readonly isMainFrame: boolean;
    public readonly url: string;

    constructor(args: {
      initiatorOrigin?: string | null;
      isMainFrame: boolean;
      url: string;
    }) {
      super();
      this.initiator =
        args.initiatorOrigin === undefined
          ? undefined
          : args.initiatorOrigin === null
            ? null
            : { origin: args.initiatorOrigin };
      this.isMainFrame = args.isMainFrame;
      this.url = args.url;
    }
  }

  const fakeWebContentsEvent: FakeWebContentsEvent = {};

  const fakeCapturedImage: FakeNativeImage = {
    isEmpty: () => false,
    toJPEG: () => Buffer.from("jpeg-bytes"),
  };

  class FakeWebContents {
    public activeHistoryIndex = 0;
    public canGoBackResult = false;
    public canGoForwardResult = false;
    public destroyed = false;
    public focusCalls = 0;
    public readonly goBackCalls: string[] = [];
    public readonly goForwardCalls: string[] = [];
    public historyEntries: Array<{ title: string; url: string }> = [];
    public readonly id: number;
    public readonly loadURLCalls: string[] = [];
    public readonly findInPageCalls: FakeFindInPageCall[] = [];
    public readonly stopFindInPageCalls: string[] = [];
    public reloadCalls = 0;
    public readonly pendingCaptureResolvers: Array<
      (image: FakeNativeImage) => void
    > = [];
    private readonly listeners: FakeWebContentsListeners = {
      "before-input-event": [],
      "will-frame-navigate": [],
      "will-navigate": [],
      "will-redirect": [],
      "did-start-loading": [],
      "did-stop-loading": [],
      "did-finish-load": [],
      "did-navigate": [],
      "did-navigate-in-page": [],
      "did-start-navigation": [],
      "page-title-updated": [],
      "did-fail-load": [],
      "context-menu": [],
      "render-process-gone": [],
      "found-in-page": [],
    };
    private title = "";
    private url = "";
    private windowOpenHandler: FakeWindowOpenHandler | null = null;

    constructor(id: number) {
      this.id = id;
    }

    public readonly navigationHistory = {
      canGoBack: (): boolean => this.canGoBackResult,
      canGoForward: (): boolean => this.canGoForwardResult,
      getActiveIndex: (): number => this.activeHistoryIndex,
      getEntryAtIndex: (index: number): { title: string; url: string } | null =>
        this.historyEntries[index] ?? null,
      goBack: (): void => {
        this.goBackCalls.push("goBack");
      },
      goForward: (): void => {
        this.goForwardCalls.push("goForward");
      },
    };

    capturePage(): Promise<FakeNativeImage> {
      return new Promise((resolve) => {
        this.pendingCaptureResolvers.push(resolve);
      });
    }

    close(): void {
      this.destroyed = true;
    }

    focus(): void {
      this.focusCalls += 1;
    }

    findInPage(
      text: string,
      options: { findNext: boolean; forward: boolean },
    ): number {
      this.findInPageCalls.push({ text, options });
      return this.findInPageCalls.length;
    }

    stopFindInPage(action: string): void {
      this.stopFindInPageCalls.push(action);
    }

    emitFoundInPage(result: FakeFoundInPageResult): void {
      for (const listener of this.listeners["found-in-page"]) {
        listener(fakeWebContentsEvent, result);
      }
    }

    getTitle(): string {
      return this.title;
    }

    getURL(): string {
      return this.url;
    }

    isDestroyed(): boolean {
      return this.destroyed;
    }

    isLoadingMainFrame(): boolean {
      return false;
    }

    loadURL(url: string): Promise<void> {
      this.url = url;
      this.loadURLCalls.push(url);
      return Promise.resolve();
    }

    on<TEventName extends keyof FakeWebContentsEventMap>(
      eventName: TEventName,
      listener: FakeWebContentsEventMap[TEventName],
    ): void {
      this.listeners[eventName].push(listener);
    }

    reload(): void {
      this.reloadCalls += 1;
    }

    setWindowOpenHandler(handler: FakeWindowOpenHandler): void {
      this.windowOpenHandler = handler;
    }

    stop(): void {}

    emitDidFailLoad(args: FakeDidFailLoadArgs): void {
      for (const listener of this.listeners["did-fail-load"]) {
        listener(
          fakeWebContentsEvent,
          args.errorCode,
          args.errorDescription,
          args.validatedURL,
          args.isMainFrame,
        );
      }
    }

    emitRenderProcessGone(details: FakeRenderProcessGoneDetails): void {
      for (const listener of this.listeners["render-process-gone"]) {
        listener(fakeWebContentsEvent, details);
      }
    }

    emitDidFinishLoad(): void {
      for (const listener of this.listeners["did-finish-load"]) {
        listener();
      }
    }

    emitBeforeInput(
      input: Partial<FakeInput> & Pick<FakeInput, "key">,
    ): boolean {
      const event = new FakePreventableEventImpl();
      const resolvedInput: FakeInput = {
        alt: false,
        control: false,
        isAutoRepeat: false,
        isComposing: false,
        meta: false,
        shift: false,
        type: "keyDown",
        ...input,
      };
      for (const listener of this.listeners["before-input-event"]) {
        listener(event, resolvedInput);
      }
      return event.defaultPrevented;
    }

    emitDidNavigate(url: string): void {
      this.url = url;
      for (const listener of this.listeners["did-navigate"]) {
        listener(fakeWebContentsEvent, url);
      }
    }

    emitWillFrameNavigate(
      url: string,
      isMainFrame: boolean,
      initiatorOrigin?: string | null,
    ): boolean {
      const event = new FakeNavigationEventImpl({
        initiatorOrigin,
        isMainFrame,
        url,
      });
      for (const listener of this.listeners["will-frame-navigate"]) {
        listener(event);
      }
      return event.defaultPrevented;
    }

    emitWillNavigate(url: string, initiatorOrigin?: string | null): boolean {
      const event = new FakeNavigationEventImpl({
        initiatorOrigin,
        isMainFrame: true,
        url,
      });
      for (const listener of this.listeners["will-navigate"]) {
        listener(event, url);
      }
      return event.defaultPrevented;
    }

    emitWillRedirect(
      url: string,
      isMainFrame: boolean,
      initiatorOrigin?: string | null,
    ): boolean {
      const event = new FakeNavigationEventImpl({
        initiatorOrigin,
        isMainFrame,
        url,
      });
      for (const listener of this.listeners["will-redirect"]) {
        listener(event, url, false, isMainFrame);
      }
      return event.defaultPrevented;
    }

    emitWindowOpen(url: string): FakeWindowOpenDecision {
      if (this.windowOpenHandler === null) {
        throw new Error("Expected a window open handler to be registered.");
      }
      return this.windowOpenHandler({ url });
    }
  }

  let nextWebContentsId = 1;

  class FakeWebContentsView {
    public readonly boundsCalls: BbDesktopBrowserViewBounds[] = [];
    public readonly webContents: FakeWebContents;
    public visible = false;

    constructor() {
      this.webContents = new FakeWebContents(nextWebContentsId);
      nextWebContentsId += 1;
    }

    setBounds(bounds: BbDesktopBrowserViewBounds): void {
      this.boundsCalls.push(bounds);
    }

    setVisible(visible: boolean): void {
      this.visible = visible;
    }
  }

  class FakeSession {
    public readonly willDownloadListeners: FakeSessionListener[] = [];
    public permissionCheckHandler: FakePermissionCheckHandler | null = null;
    public permissionRequestHandler: FakePermissionRequestHandler | null = null;
    on(eventName: "will-download", listener: FakeSessionListener): void {
      this.willDownloadListeners.push(listener);
    }

    setPermissionCheckHandler(handler: FakePermissionCheckHandler): void {
      this.permissionCheckHandler = handler;
    }

    setPermissionRequestHandler(handler: FakePermissionRequestHandler): void {
      this.permissionRequestHandler = handler;
    }
  }

  const fakeSessions: FakeSession[] = [];
  const fakeViews: FakeWebContentsView[] = [];

  return {
    fakeCapturedImage,
    fakeSessions,
    fakeViews,
    FakeWebContentsView: class extends FakeWebContentsView {
      constructor() {
        super();
        fakeViews.push(this);
      }
    },
    session: {
      fromPartition() {
        const fakeSession = new FakeSession();
        fakeSessions.push(fakeSession);
        return fakeSession;
      },
    },
  };
});

vi.mock("electron", () => ({
  WebContentsView: electronMock.FakeWebContentsView,
  session: electronMock.session,
}));

interface FakeHostWindowArgs {
  contentBounds: DesktopBrowserHostContentBounds;
  webContentsId: number;
}

class FakeHostWebContents implements DesktopBrowserHostWebContents {
  public destroyed = false;
  public readonly sentPayloads: DesktopBrowserHostWebContentsPayload[] = [];
  public readonly id: number;

  constructor(id: number) {
    this.id = id;
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  send(_channel: string, payload: DesktopBrowserHostWebContentsPayload): void {
    this.sentPayloads.push(payload);
  }
}

class FakeContentView implements DesktopBrowserHostContentView {
  public readonly addedViews: WebContentsView[] = [];
  public readonly removedViews: WebContentsView[] = [];

  addChildView(view: WebContentsView): void {
    this.addedViews.push(view);
  }

  removeChildView(view: WebContentsView): void {
    this.removedViews.push(view);
  }
}

class FakeHostWindow implements DesktopBrowserHostWindow {
  public contentBounds: DesktopBrowserHostContentBounds;
  public destroyed = false;
  public readonly contentView = new FakeContentView();
  public readonly webContents: FakeHostWebContents;

  constructor({ contentBounds, webContentsId }: FakeHostWindowArgs) {
    this.contentBounds = contentBounds;
    this.webContents = new FakeHostWebContents(webContentsId);
  }

  getContentBounds(): DesktopBrowserHostContentBounds {
    return this.contentBounds;
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }
}

beforeEach(() => {
  vi.useRealTimers();
  electronMock.fakeSessions.length = 0;
  electronMock.fakeViews.length = 0;
});

/**
 * Resolve every pending capturePage() on the view and let the snapshot
 * pipeline (push the bitmap, then hide the view) drain.
 */
async function settlePendingCaptures(
  view: (typeof electronMock.fakeViews)[number],
): Promise<void> {
  for (const resolve of view.webContents.pendingCaptureResolvers.splice(0)) {
    resolve(electronMock.fakeCapturedImage);
  }
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function snapshotPushesOf(
  hostWindow: FakeHostWindow,
): Array<{ tabId: string; dataUrl: string | null }> {
  const pushes: Array<{ tabId: string; dataUrl: string | null }> = [];
  for (const payload of hostWindow.webContents.sentPayloads) {
    if ("dataUrl" in payload) {
      pushes.push(payload);
    }
  }
  return pushes;
}

function findResultPushesOf(
  hostWindow: FakeHostWindow,
): Array<{ tabId: string; requestId: number }> {
  const pushes: Array<{ tabId: string; requestId: number }> = [];
  for (const payload of hostWindow.webContents.sentPayloads) {
    if ("requestId" in payload) {
      pushes.push(payload);
    }
  }
  return pushes;
}

interface AttachBrowserTabArgs {
  hostWindow: FakeHostWindow;
  manager: DesktopBrowserViewManager;
  tabId: string;
  url: string;
}

function attachBrowserTab(args: AttachBrowserTabArgs): void {
  args.manager.attach({
    hostWindow: args.hostWindow,
    request: {
      tabId: args.tabId,
      url: args.url,
      bounds: { x: 100, y: 50, width: 500, height: 350 },
      visible: true,
    },
  });
}

function requireFakeView(
  index: number,
): (typeof electronMock.fakeViews)[number] {
  const view = electronMock.fakeViews[index];
  expect(view).toBeDefined();
  if (view === undefined) {
    throw new Error("Expected the browser view to be created.");
  }
  return view;
}

function createRendererRecoveryFixture(webContentsId: number) {
  const manager = createDesktopBrowserViewManager({
    partition: "persist:test",
  });
  const hostWindow = new FakeHostWindow({
    contentBounds: { width: 700, height: 450 },
    webContentsId,
  });
  attachBrowserTab({
    manager,
    hostWindow,
    tabId: "browser:a",
    url: "https://example.com/original",
  });
  return { manager, hostWindow, view: requireFakeView(0) };
}

function openTabPushesOf(hostWindow: FakeHostWindow): string[] {
  const pushes: string[] = [];
  for (const payload of hostWindow.webContents.sentPayloads) {
    if ("url" in payload && !("tabId" in payload)) {
      pushes.push(payload.url);
    }
  }
  return pushes;
}

function scopedOpenTabPushesOf(
  hostWindow: FakeHostWindow,
): Array<{ tabId: string; url: string }> {
  const pushes: Array<{ tabId: string; url: string }> = [];
  for (const payload of hostWindow.webContents.sentPayloads) {
    if ("url" in payload && "tabId" in payload && !("title" in payload)) {
      pushes.push(payload);
    }
  }
  return pushes;
}

describe("DesktopBrowserViewManager", () => {
  it("forwards resolved browser shortcuts and suppresses the untrusted page", () => {
    const dispatchAppCommand = vi.fn();
    const focusHostWebContents = vi.fn();
    const resolveAppCommand = vi.fn(
      (input: { key: string; metaKey: boolean }) =>
        input.key === "l" && input.metaKey
          ? ("browser.focusLocation" as const)
          : null,
    );
    const manager = createDesktopBrowserViewManager({
      dispatchAppCommand,
      focusHostWebContents,
      partition: "persist:test",
      resolveAppCommand,
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 50,
    });

    attachBrowserTab({
      manager,
      hostWindow,
      tabId: "browser:a",
      url: "https://example.com",
    });
    const webContents = requireFakeView(0).webContents;

    expect(webContents.emitBeforeInput({ key: "l", meta: true })).toBe(true);
    expect(focusHostWebContents).toHaveBeenCalledWith(50);
    expect(dispatchAppCommand).toHaveBeenCalledWith({
      command: "browser.focusLocation",
      hostWebContentsId: 50,
    });
    expect(
      webContents.emitBeforeInput({
        isAutoRepeat: true,
        key: "l",
        meta: true,
      }),
    ).toBe(false);
    expect(dispatchAppCommand).toHaveBeenCalledTimes(1);
  });

  it("takes host focus for the find command so the find bar can receive typing", () => {
    const dispatchAppCommand = vi.fn();
    const focusHostWebContents = vi.fn();
    const manager = createDesktopBrowserViewManager({
      dispatchAppCommand,
      focusHostWebContents,
      partition: "persist:test",
      resolveAppCommand: (input) =>
        input.key === "f" && input.metaKey ? "browser.find" : null,
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 51,
    });

    attachBrowserTab({
      manager,
      hostWindow,
      tabId: "browser:a",
      url: "https://example.com",
    });
    const webContents = requireFakeView(0).webContents;

    expect(webContents.emitBeforeInput({ key: "f", meta: true })).toBe(true);
    expect(focusHostWebContents).toHaveBeenCalledWith(51);
    expect(dispatchAppCommand).toHaveBeenCalledWith({
      command: "browser.find",
      hostWebContentsId: 51,
    });
  });

  it("drives webContents find-in-page and relays results to the host renderer", () => {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 52,
    });
    attachBrowserTab({
      manager,
      hostWindow,
      tabId: "browser:a",
      url: "https://example.com",
    });
    const webContents = requireFakeView(0).webContents;

    manager.findInPage({
      hostWindow,
      request: {
        tabId: "browser:a",
        text: "needle",
        forward: true,
        newSession: true,
      },
    });
    manager.findInPage({
      hostWindow,
      request: {
        tabId: "browser:a",
        text: "needle",
        forward: false,
        newSession: false,
      },
    });
    // Unknown tab: no view, nothing to drive.
    manager.findInPage({
      hostWindow,
      request: {
        tabId: "browser:missing",
        text: "needle",
        forward: true,
        newSession: true,
      },
    });
    manager.stopFindInPage({
      hostWindow,
      request: { tabId: "browser:a", action: "clearSelection" },
    });

    // Electron's `findNext` carries the "start a new session" meaning.
    expect(webContents.findInPageCalls).toEqual([
      { text: "needle", options: { forward: true, findNext: true } },
      { text: "needle", options: { forward: false, findNext: false } },
    ]);
    expect(webContents.stopFindInPageCalls).toEqual(["clearSelection"]);

    webContents.emitFoundInPage({
      requestId: 7,
      activeMatchOrdinal: 2,
      matches: 9,
      finalUpdate: true,
      selectionArea: { x: 0, y: 0, width: 10, height: 10 },
    });
    // The session was stopped, so even a result for the latest request id is
    // stale and must not revive a cleared count.
    expect(findResultPushesOf(hostWindow)).toEqual([]);
  });

  it("relays only results of the latest find request and none after stop", () => {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 53,
    });
    attachBrowserTab({
      manager,
      hostWindow,
      tabId: "browser:a",
      url: "https://example.com",
    });
    const webContents = requireFakeView(0).webContents;
    const findRequest = {
      tabId: "browser:a",
      text: "needle",
      forward: true,
      newSession: true,
    };
    const resultArea = { x: 0, y: 0, width: 10, height: 10 };

    // Fake findInPage returns 1, 2, 3, … as request ids.
    manager.findInPage({ hostWindow, request: findRequest });
    manager.findInPage({
      hostWindow,
      request: { ...findRequest, text: "nee" },
    });
    // Late result for the first (superseded) request: dropped.
    webContents.emitFoundInPage({
      requestId: 1,
      activeMatchOrdinal: 1,
      matches: 3,
      finalUpdate: true,
      selectionArea: resultArea,
    });
    webContents.emitFoundInPage({
      requestId: 2,
      activeMatchOrdinal: 1,
      matches: 12,
      finalUpdate: false,
      selectionArea: resultArea,
    });
    // The relay carries the tab id and drops the selection rect, which the
    // renderer cannot use (the native view overlays its DOM).
    expect(findResultPushesOf(hostWindow)).toEqual([
      {
        tabId: "browser:a",
        requestId: 2,
        activeMatchOrdinal: 1,
        matches: 12,
        finalUpdate: false,
      },
    ]);

    manager.stopFindInPage({
      hostWindow,
      request: { tabId: "browser:a", action: "clearSelection" },
    });
    webContents.emitFoundInPage({
      requestId: 2,
      activeMatchOrdinal: 1,
      matches: 12,
      finalUpdate: true,
      selectionArea: resultArea,
    });
    expect(findResultPushesOf(hostWindow)).toHaveLength(1);
  });

  it("surfaces a loopback popup as an in-panel tab, never a native window", () => {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 58,
    });

    attachBrowserTab({
      manager,
      hostWindow,
      tabId: "browser:a",
      url: "http://localhost:5173/",
    });
    const view = requireFakeView(0);

    // The native popup is always denied; an allowed http(s) URL becomes a tab.
    // A local dev app opening its own admin page on another port is ordinary.
    expect(view.webContents.emitWindowOpen("http://localhost:38886/")).toEqual({
      action: "deny",
    });
    expect(openTabPushesOf(hostWindow)).toEqual(["http://localhost:38886/"]);
    expect(scopedOpenTabPushesOf(hostWindow)).toEqual([
      { tabId: "browser:a", url: "http://localhost:38886/" },
    ]);
  });

  it("surfaces public popups with their source browser tab id", () => {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 61,
    });

    attachBrowserTab({
      manager,
      hostWindow,
      tabId: "browser:a",
      url: "https://example.com/",
    });
    const view = requireFakeView(0);

    expect(view.webContents.emitWindowOpen("https://example.com/docs")).toEqual(
      {
        action: "deny",
      },
    );
    expect(openTabPushesOf(hostWindow)).toEqual(["https://example.com/docs"]);
    expect(scopedOpenTabPushesOf(hostWindow)).toEqual([
      {
        tabId: "browser:a",
        url: "https://example.com/docs",
      },
    ]);
  });

  it("snapshots then hides visible views on resize, revealing them clamped to the shrunken window", async () => {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 41,
    });

    manager.attach({
      hostWindow,
      request: {
        tabId: "browser:a",
        url: "",
        bounds: { x: 100, y: 50, width: 500, height: 350 },
        visible: true,
      },
    });

    const view = electronMock.fakeViews[0];
    expect(view).toBeDefined();
    if (view === undefined) {
      throw new Error("Expected the browser view to be created.");
    }
    expect(view.boundsCalls[0]).toEqual({
      x: 100,
      y: 50,
      width: 500,
      height: 350,
    });
    expect(view.visible).toBe(true);

    // Mid-drag the chrome and the native view cannot stay glued; the view is
    // captured (so the renderer can paint a stand-in) and then hidden for the
    // burst instead of tracking anything.
    manager.beginWindowResize(hostWindow);
    await settlePendingCaptures(view);
    expect(view.visible).toBe(false);
    expect(snapshotPushesOf(hostWindow)).toEqual([
      {
        tabId: "browser:a",
        dataUrl: `data:image/jpeg;base64,${Buffer.from("jpeg-bytes").toString("base64")}`,
      },
    ]);

    // The reveal applies bounds before visibility, intersected with the live
    // window so a shrunken window never shows a spilling view; the null push
    // then clears the renderer's stand-in.
    hostWindow.contentBounds = { width: 400, height: 300 };
    manager.endWindowResize(hostWindow);

    expect(view.boundsCalls[1]).toEqual({
      x: 100,
      y: 50,
      width: 300,
      height: 250,
    });
    expect(view.visible).toBe(true);
    expect(snapshotPushesOf(hostWindow).at(-1)).toEqual({
      tabId: "browser:a",
      dataUrl: null,
    });

    // The clamp is non-destructive: growing back re-applies the full
    // renderer-desired rect, not the clamped remnant.
    manager.beginWindowResize(hostWindow);
    await settlePendingCaptures(view);
    hostWindow.contentBounds = { width: 700, height: 450 };
    manager.endWindowResize(hostWindow);

    expect(view.boundsCalls[2]).toEqual({
      x: 100,
      y: 50,
      width: 500,
      height: 350,
    });
    expect(view.visible).toBe(true);
  });

  it("drops a capture that resolves after the resize burst already ended", async () => {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 46,
    });

    manager.attach({
      hostWindow,
      request: {
        tabId: "browser:a",
        url: "",
        bounds: { x: 100, y: 50, width: 500, height: 350 },
        visible: true,
      },
    });

    const view = electronMock.fakeViews[0];
    expect(view).toBeDefined();
    if (view === undefined) {
      throw new Error("Expected the browser view to be created.");
    }

    // A tap-resize can end the burst before the capture resolves. The live
    // view is visible again by then; a late bitmap push would linger under it
    // into the next burst.
    manager.beginWindowResize(hostWindow);
    manager.endWindowResize(hostWindow);
    await settlePendingCaptures(view);

    const bitmapPushes = snapshotPushesOf(hostWindow).filter(
      (push) => push.dataUrl !== null,
    );
    expect(bitmapPushes).toHaveLength(0);
    expect(view.visible).toBe(true);
  });

  it("never grows a view past its renderer-desired rect on a native window grow", async () => {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 43,
    });

    manager.attach({
      hostWindow,
      request: {
        tabId: "browser:a",
        url: "",
        bounds: { x: 100, y: 50, width: 500, height: 350 },
        visible: true,
      },
    });

    const view = electronMock.fakeViews[0];
    expect(view).toBeDefined();
    if (view === undefined) {
      throw new Error("Expected the browser view to be created.");
    }

    // Extrapolating the view to the new window size would visibly break it
    // out of its panel; it must hold the renderer-measured rect until the
    // renderer pushes a fresh one.
    manager.beginWindowResize(hostWindow);
    await settlePendingCaptures(view);
    hostWindow.contentBounds = { width: 900, height: 640 };
    manager.endWindowResize(hostWindow);

    expect(view.boundsCalls[1]).toEqual({
      x: 100,
      y: 50,
      width: 500,
      height: 350,
    });
  });

  it("applies renderer pushes that land mid-resize on the reveal", async () => {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 44,
    });

    manager.attach({
      hostWindow,
      request: {
        tabId: "browser:a",
        url: "",
        bounds: { x: 100, y: 50, width: 500, height: 350 },
        visible: true,
      },
    });

    const view = electronMock.fakeViews[0];
    expect(view).toBeDefined();
    if (view === undefined) {
      throw new Error("Expected the browser view to be created.");
    }

    manager.beginWindowResize(hostWindow);
    await settlePendingCaptures(view);
    hostWindow.contentBounds = { width: 500, height: 300 };
    manager.setBounds({
      hostWindow,
      request: {
        tabId: "browser:a",
        bounds: { x: 200, y: 90, width: 400, height: 300 },
      },
    });
    manager.endWindowResize(hostWindow);

    // The reveal intersects the latest renderer rect (not the attach-time one)
    // with the live window.
    expect(view.boundsCalls.at(-1)).toEqual({
      x: 200,
      y: 90,
      width: 300,
      height: 210,
    });
    expect(view.visible).toBe(true);
  });

  it("defers renderer visibility changes made during a resize burst to the reveal", () => {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 45,
    });

    manager.attach({
      hostWindow,
      request: {
        tabId: "browser:a",
        url: "",
        bounds: { x: 100, y: 50, width: 500, height: 350 },
        visible: false,
      },
    });

    const view = electronMock.fakeViews[0];
    expect(view).toBeDefined();
    if (view === undefined) {
      throw new Error("Expected the browser view to be created.");
    }

    manager.beginWindowResize(hostWindow);
    // A tab switch mid-drag declares the view visible; it must stay hidden
    // until the resize settles.
    manager.setVisible({
      hostWindow,
      request: { tabId: "browser:a", visible: true },
    });
    expect(view.visible).toBe(false);

    manager.endWindowResize(hostWindow);
    expect(view.visible).toBe(true);
  });

  it("keeps hidden views hidden and untouched across a resize burst", () => {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 42,
    });

    manager.attach({
      hostWindow,
      request: {
        tabId: "browser:a",
        url: "",
        bounds: { x: 100, y: 50, width: 500, height: 350 },
        visible: false,
      },
    });

    const view = electronMock.fakeViews[0];
    expect(view).toBeDefined();
    if (view === undefined) {
      throw new Error("Expected the browser view to be created.");
    }

    manager.beginWindowResize(hostWindow);
    hostWindow.contentBounds = { width: 400, height: 300 };
    manager.endWindowResize(hostWindow);

    expect(view.boundsCalls).toHaveLength(1);
    expect(view.visible).toBe(false);
  });

  it("focuses a freshly-attached active tab so Cmd+C targets its webContents", () => {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 70,
    });

    manager.attach({
      hostWindow,
      request: {
        tabId: "browser:a",
        url: "",
        bounds: { x: 100, y: 50, width: 500, height: 350 },
        visible: true,
      },
    });

    const view = requireFakeView(0);
    expect(view.webContents.focusCalls).toBe(1);
  });

  it("defers hidden memory-eviction recovery until the panel shows the current page", () => {
    vi.useFakeTimers();
    const { hostWindow, manager, view } = createRendererRecoveryFixture(75);
    view.webContents.emitDidNavigate("https://example.com/current");
    manager.setVisible({
      hostWindow,
      request: { tabId: "browser:a", visible: false },
    });

    view.webContents.emitRenderProcessGone({
      exitCode: 0,
      reason: "memory-eviction",
    });

    expect(view.webContents.reloadCalls).toBe(0);
    expect(view.visible).toBe(false);

    manager.setVisible({
      hostWindow,
      request: { tabId: "browser:a", visible: true },
    });
    expect(view.visible).toBe(false);
    vi.runOnlyPendingTimers();

    expect(view.webContents.reloadCalls).toBe(1);
    expect(view.webContents.getURL()).toBe("https://example.com/current");
    expect(electronMock.fakeViews).toHaveLength(1);
    expect(view.visible).toBe(true);
  });

  it("stops automatic recovery after two repeated renderer crashes", () => {
    vi.useFakeTimers();
    const { hostWindow, view } = createRendererRecoveryFixture(76);

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      view.webContents.emitRenderProcessGone({
        exitCode: 1,
        reason: "crashed",
      });
      expect(view.visible).toBe(false);
      vi.runOnlyPendingTimers();
      expect(view.webContents.reloadCalls).toBe(attempt);
      expect(view.visible).toBe(true);
    }

    view.webContents.emitRenderProcessGone({
      exitCode: 1,
      reason: "crashed",
    });
    vi.runOnlyPendingTimers();

    expect(view.webContents.reloadCalls).toBe(2);
    expect(view.visible).toBe(false);
    expect(hostWindow.webContents.sentPayloads.at(-1)).toMatchObject({
      tabId: "browser:a",
      errorText: "The page renderer stopped repeatedly",
    });
  });

  it.each(["launch-failed", "integrity-failure"] as const)(
    "does not automatically retry a %s renderer failure",
    (reason) => {
      vi.useFakeTimers();
      const { hostWindow, view } = createRendererRecoveryFixture(77);

      view.webContents.emitRenderProcessGone({ exitCode: 1, reason });
      vi.runOnlyPendingTimers();

      expect(view.webContents.reloadCalls).toBe(0);
      expect(view.visible).toBe(false);
      expect(hostWindow.webContents.sentPayloads.at(-1)).toMatchObject({
        tabId: "browser:a",
        errorText: "The page renderer could not start",
      });
    },
  );

  it("resets the renderer recovery limit after a page finishes loading", () => {
    vi.useFakeTimers();
    const { view } = createRendererRecoveryFixture(78);

    view.webContents.emitRenderProcessGone({
      exitCode: 1,
      reason: "crashed",
    });
    vi.runOnlyPendingTimers();
    view.webContents.emitDidFinishLoad();
    view.webContents.emitRenderProcessGone({
      exitCode: 1,
      reason: "crashed",
    });
    vi.runOnlyPendingTimers();

    expect(view.webContents.reloadCalls).toBe(2);
    expect(view.visible).toBe(true);
  });

  it("does not focus a freshly-attached inactive tab", () => {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 71,
    });

    manager.attach({
      hostWindow,
      request: {
        tabId: "browser:a",
        url: "",
        bounds: { x: 100, y: 50, width: 500, height: 350 },
        visible: false,
      },
    });

    const view = requireFakeView(0);
    expect(view.webContents.focusCalls).toBe(0);
  });

  it("focuses on a real hidden → visible setVisible transition only once", () => {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 72,
    });

    manager.attach({
      hostWindow,
      request: {
        tabId: "browser:a",
        url: "",
        bounds: { x: 100, y: 50, width: 500, height: 350 },
        visible: false,
      },
    });

    const view = requireFakeView(0);
    expect(view.webContents.focusCalls).toBe(0);

    manager.setVisible({
      hostWindow,
      request: { tabId: "browser:a", visible: true },
    });
    expect(view.webContents.focusCalls).toBe(1);

    // A redundant re-show must not yank focus back from the address bar.
    manager.setVisible({
      hostWindow,
      request: { tabId: "browser:a", visible: true },
    });
    expect(view.webContents.focusCalls).toBe(1);
  });

  it("re-focuses after a hide → show cycle", () => {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 73,
    });

    manager.attach({
      hostWindow,
      request: {
        tabId: "browser:a",
        url: "",
        bounds: { x: 100, y: 50, width: 500, height: 350 },
        visible: true,
      },
    });

    const view = requireFakeView(0);
    expect(view.webContents.focusCalls).toBe(1);

    manager.setVisible({
      hostWindow,
      request: { tabId: "browser:a", visible: false },
    });
    expect(view.webContents.focusCalls).toBe(1);

    manager.setVisible({
      hostWindow,
      request: { tabId: "browser:a", visible: true },
    });
    expect(view.webContents.focusCalls).toBe(2);
  });

  it("allows clipboard-sanitized-write but denies clipboard-read and device permissions", () => {
    // Write-only clipboard lets in-page copy buttons work; read and every
    // device/capability permission stay denied.
    expect(isAllowedBrowserPermission("clipboard-sanitized-write")).toBe(true);
    expect(isAllowedBrowserPermission("clipboard-read")).toBe(false);
    expect(isAllowedBrowserPermission("media")).toBe(false);
    expect(isAllowedBrowserPermission("notifications")).toBe(false);
    expect(isAllowedBrowserPermission("geolocation")).toBe(false);

    // The same decision flows through the handlers the session registers.
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 74,
    });
    attachBrowserTab({
      manager,
      hostWindow,
      tabId: "browser:a",
      url: "https://example.com/",
    });

    const fakeSession = electronMock.fakeSessions.at(-1);
    expect(fakeSession).toBeDefined();
    if (fakeSession === undefined) {
      throw new Error("Expected a browser session to be created.");
    }
    const checkHandler = fakeSession.permissionCheckHandler;
    const requestHandler = fakeSession.permissionRequestHandler;
    expect(checkHandler).not.toBeNull();
    expect(requestHandler).not.toBeNull();
    if (checkHandler === null || requestHandler === null) {
      throw new Error("Expected permission handlers to be registered.");
    }

    expect(checkHandler(null, "clipboard-sanitized-write")).toBe(true);
    expect(checkHandler(null, "clipboard-read")).toBe(false);
    expect(checkHandler(null, "media")).toBe(false);

    const requestGrants: boolean[] = [];
    requestHandler(null, "clipboard-sanitized-write", (granted) => {
      requestGrants.push(granted);
    });
    requestHandler(null, "clipboard-read", (granted) => {
      requestGrants.push(granted);
    });
    requestHandler(null, "media", (granted) => {
      requestGrants.push(granted);
    });
    expect(requestGrants).toEqual([true, false, false]);
  });
});
