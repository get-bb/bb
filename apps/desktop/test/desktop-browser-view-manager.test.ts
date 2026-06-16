import type { WebContentsView } from "electron";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BbDesktopBrowserViewBounds } from "@bb/desktop-contract";
import {
  createDesktopBrowserViewManager,
  type DesktopBrowserViewManager,
  type DesktopBrowserHostContentBounds,
  type DesktopBrowserHostContentView,
  type DesktopBrowserHostWebContents,
  type DesktopBrowserHostWebContentsPayload,
  type DesktopBrowserHostWindow,
} from "../src/desktop-browser-view.js";

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

interface FakeWebContentsEventMap {
  "will-frame-navigate": FakeWillFrameNavigateListener;
  "will-navigate": FakeWillNavigateListener;
  "will-redirect": FakeWillRedirectListener;
  "did-start-loading": FakeVoidWebContentsListener;
  "did-stop-loading": FakeVoidWebContentsListener;
  "did-navigate": FakeDidNavigateListener;
  "did-navigate-in-page": FakeDidNavigateInPageListener;
  "did-start-navigation": FakeVoidWebContentsListener;
  "page-title-updated": FakeVoidWebContentsListener;
  "did-fail-load": FakeDidFailLoadListener;
}

type FakeResourceType =
  | "mainFrame"
  | "subFrame"
  | "stylesheet"
  | "script"
  | "image"
  | "font"
  | "object"
  | "xhr"
  | "ping"
  | "cspReport"
  | "media"
  | "webSocket"
  | "other";

interface FakeWebFrameMain {
  origin: string;
}

interface FakeOnBeforeRequestDetails {
  url: string;
  resourceType: FakeResourceType;
  webContentsId?: number;
  frame?: FakeWebFrameMain | null;
}

interface FakeWebRequestCallbackResponse {
  cancel: boolean;
}

type FakeOnBeforeRequestCallback = (
  response: FakeWebRequestCallbackResponse,
) => void;

type FakeOnBeforeRequestListener = (
  details: FakeOnBeforeRequestDetails,
  callback: FakeOnBeforeRequestCallback,
) => void;

interface FakeSessionEvent {
  preventDefault(): void;
}

type FakeSessionListener = (event: FakeSessionEvent) => void;

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
    public readonly goBackCalls: string[] = [];
    public readonly goForwardCalls: string[] = [];
    public historyEntries: Array<{ title: string; url: string }> = [];
    public readonly id: number;
    public readonly loadURLCalls: string[] = [];
    public readonly pendingCaptureResolvers: Array<
      (image: FakeNativeImage) => void
    > = [];
    private readonly listeners: FakeWebContentsListeners = {
      "will-frame-navigate": [],
      "will-navigate": [],
      "will-redirect": [],
      "did-start-loading": [],
      "did-stop-loading": [],
      "did-navigate": [],
      "did-navigate-in-page": [],
      "did-start-navigation": [],
      "page-title-updated": [],
      "did-fail-load": [],
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

    reload(): void {}

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
    public beforeRequestListener: FakeOnBeforeRequestListener | null = null;
    public readonly webRequest = {
      onBeforeRequest: (listener: FakeOnBeforeRequestListener | null): void => {
        this.beforeRequestListener = listener;
      },
    };

    on(eventName: "will-download", listener: FakeSessionListener): void {
      this.willDownloadListeners.push(listener);
    }

    setPermissionCheckHandler(): void {}

    setPermissionRequestHandler(): void {}
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

interface AttachBrowserTabArgs {
  hostWindow: FakeHostWindow;
  manager: DesktopBrowserViewManager;
  tabId: string;
  url: string;
}

interface BrowserRequestBlockedArgs {
  url: string;
  resourceType: FakeResourceType;
  frameOrigin?: string | null;
  webContentsId?: number;
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

function requireOnBeforeRequestListener(): FakeOnBeforeRequestListener {
  const fakeSession = electronMock.fakeSessions.at(-1);
  expect(fakeSession).toBeDefined();
  if (fakeSession === undefined) {
    throw new Error("Expected a browser session to be created.");
  }
  const listener = fakeSession.beforeRequestListener;
  expect(listener).not.toBeNull();
  if (listener === null) {
    throw new Error("Expected an onBeforeRequest listener to be registered.");
  }
  return listener;
}

function browserRequestBlocked(args: BrowserRequestBlockedArgs): boolean {
  const details: FakeOnBeforeRequestDetails = {
    url: args.url,
    resourceType: args.resourceType,
  };
  if (args.webContentsId !== undefined) {
    details.webContentsId = args.webContentsId;
  }
  if (args.frameOrigin !== undefined) {
    details.frame =
      args.frameOrigin === null ? null : { origin: args.frameOrigin };
  }

  const responses: FakeWebRequestCallbackResponse[] = [];
  requireOnBeforeRequestListener()(details, (nextResponse) => {
    responses.push(nextResponse);
  });
  const response = responses[0];
  if (response === undefined) {
    throw new Error("Expected onBeforeRequest to invoke its callback.");
  }
  return response.cancel;
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

describe("DesktopBrowserViewManager", () => {
  it("allows trusted loopback navigations through pending local origin state", () => {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 51,
    });

    attachBrowserTab({
      manager,
      hostWindow,
      tabId: "browser:a",
      url: "",
    });
    const view = requireFakeView(0);

    manager.navigate({
      hostWindow,
      request: {
        tabId: "browser:a",
        url: "http://localhost:5173/",
      },
    });

    expect(view.webContents.loadURLCalls).toEqual(["http://localhost:5173/"]);
    expect(
      browserRequestBlocked({
        url: "http://localhost:5173/",
        resourceType: "mainFrame",
        webContentsId: view.webContents.id,
      }),
    ).toBe(false);
  });

  it("clears pending local approval after a failed main-frame local load", () => {
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
      url: "http://localhost:5173/",
    });
    const view = requireFakeView(0);

    expect(
      browserRequestBlocked({
        url: "http://localhost:5173/",
        resourceType: "mainFrame",
        webContentsId: view.webContents.id,
      }),
    ).toBe(false);

    view.webContents.emitDidFailLoad({
      errorCode: -102,
      errorDescription: "Connection refused",
      isMainFrame: true,
      validatedURL: "http://localhost:5173/",
    });

    expect(
      browserRequestBlocked({
        url: "http://localhost:5173/",
        resourceType: "mainFrame",
        webContentsId: view.webContents.id,
      }),
    ).toBe(true);
  });

  it("clears pending local approval after an aborted main-frame local load", () => {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 62,
    });

    attachBrowserTab({
      manager,
      hostWindow,
      tabId: "browser:a",
      url: "https://example.com/",
    });
    const view = requireFakeView(0);
    view.webContents.emitDidNavigate("https://example.com/");

    manager.navigate({
      hostWindow,
      request: {
        tabId: "browser:a",
        url: "http://localhost:5173/",
      },
    });

    expect(
      browserRequestBlocked({
        url: "http://localhost:5173/",
        resourceType: "mainFrame",
        webContentsId: view.webContents.id,
      }),
    ).toBe(false);

    view.webContents.emitDidFailLoad({
      errorCode: -3,
      errorDescription: "Aborted",
      isMainFrame: true,
      validatedURL: "http://localhost:5173/",
    });

    expect(view.webContents.emitWillNavigate("http://localhost:5173/")).toBe(
      true,
    );
    expect(
      browserRequestBlocked({
        url: "http://localhost:5173/",
        resourceType: "mainFrame",
        webContentsId: view.webContents.id,
      }),
    ).toBe(true);
  });

  it("clears pending local approval when a local load is stopped", () => {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 63,
    });

    attachBrowserTab({
      manager,
      hostWindow,
      tabId: "browser:a",
      url: "https://example.com/",
    });
    const view = requireFakeView(0);
    view.webContents.emitDidNavigate("https://example.com/");

    manager.navigate({
      hostWindow,
      request: {
        tabId: "browser:a",
        url: "http://localhost:5173/",
      },
    });

    expect(
      browserRequestBlocked({
        url: "http://localhost:5173/",
        resourceType: "mainFrame",
        webContentsId: view.webContents.id,
      }),
    ).toBe(false);

    manager.stop({ hostWindow, tabId: "browser:a" });

    expect(
      browserRequestBlocked({
        url: "http://localhost:5173/",
        resourceType: "mainFrame",
        webContentsId: view.webContents.id,
      }),
    ).toBe(true);
  });

  it("allows trusted reloads of the current local main frame", () => {
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
      url: "http://localhost:5173/",
    });
    const view = requireFakeView(0);
    view.webContents.emitDidNavigate("http://localhost:5173/");

    expect(
      browserRequestBlocked({
        url: "http://localhost:5173/",
        resourceType: "mainFrame",
        webContentsId: view.webContents.id,
      }),
    ).toBe(true);

    manager.reload({ hostWindow, tabId: "browser:a" });

    expect(
      browserRequestBlocked({
        url: "http://localhost:5173/",
        resourceType: "mainFrame",
        webContentsId: view.webContents.id,
      }),
    ).toBe(false);
  });

  it("clears local approval after a local page commits to a public page", () => {
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
      url: "http://localhost:5173/",
    });
    const view = requireFakeView(0);
    view.webContents.emitDidNavigate("http://localhost:5173/");

    expect(
      view.webContents.emitWillFrameNavigate(
        "http://localhost:5173/dashboard",
        true,
        "http://localhost:5173",
      ),
    ).toBe(false);
    expect(
      browserRequestBlocked({
        url: "http://localhost:5173/dashboard",
        resourceType: "mainFrame",
        webContentsId: view.webContents.id,
      }),
    ).toBe(false);
    expect(
      browserRequestBlocked({
        url: "http://localhost:5173/app.js",
        resourceType: "script",
        webContentsId: view.webContents.id,
        frameOrigin: "http://localhost:5173",
      }),
    ).toBe(false);

    view.webContents.emitDidNavigate("https://example.com/");

    expect(
      browserRequestBlocked({
        url: "http://localhost:5173/app.js",
        resourceType: "script",
        webContentsId: view.webContents.id,
        frameOrigin: "http://localhost:5173",
      }),
    ).toBe(true);
  });

  it("blocks public-to-local redirects after public commit", () => {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 54,
    });

    attachBrowserTab({
      manager,
      hostWindow,
      tabId: "browser:a",
      url: "https://example.com/",
    });
    const view = requireFakeView(0);
    view.webContents.emitDidNavigate("https://example.com/");

    expect(
      view.webContents.emitWillRedirect("http://localhost:38886/", true),
    ).toBe(true);
    expect(
      browserRequestBlocked({
        url: "http://localhost:38886/",
        resourceType: "mainFrame",
        webContentsId: view.webContents.id,
      }),
    ).toBe(true);
  });

  it("does not silently regrant localhost access through back or forward history", () => {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 55,
    });

    attachBrowserTab({
      manager,
      hostWindow,
      tabId: "browser:a",
      url: "http://localhost:5173/",
    });
    const view = requireFakeView(0);
    view.webContents.emitDidNavigate("http://localhost:5173/");
    view.webContents.emitDidNavigate("https://example.com/");
    view.webContents.historyEntries = [
      { title: "Local", url: "http://localhost:5173/" },
      { title: "Public", url: "https://example.com/" },
    ];
    view.webContents.activeHistoryIndex = 1;
    view.webContents.canGoBackResult = true;

    manager.goBack({ hostWindow, tabId: "browser:a" });

    expect(view.webContents.goBackCalls).toEqual(["goBack"]);
    expect(view.webContents.emitWillNavigate("http://localhost:5173/")).toBe(
      true,
    );
    expect(
      browserRequestBlocked({
        url: "http://localhost:5173/",
        resourceType: "mainFrame",
        webContentsId: view.webContents.id,
      }),
    ).toBe(true);

    view.webContents.historyEntries = [
      { title: "Public", url: "https://example.com/" },
      { title: "Local", url: "http://localhost:5173/" },
    ];
    view.webContents.activeHistoryIndex = 0;
    view.webContents.canGoForwardResult = true;

    manager.goForward({ hostWindow, tabId: "browser:a" });

    expect(view.webContents.goForwardCalls).toEqual(["goForward"]);
    expect(view.webContents.emitWillNavigate("http://localhost:5173/")).toBe(
      true,
    );
    expect(
      browserRequestBlocked({
        url: "http://localhost:5173/",
        resourceType: "mainFrame",
        webContentsId: view.webContents.id,
      }),
    ).toBe(true);
  });

  it("allows same-origin local back and forward history", () => {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 64,
    });

    attachBrowserTab({
      manager,
      hostWindow,
      tabId: "browser:a",
      url: "http://localhost:5173/route-b",
    });
    const view = requireFakeView(0);
    view.webContents.emitDidNavigate("http://localhost:5173/route-b");
    view.webContents.historyEntries = [
      { title: "Route A", url: "http://localhost:5173/route-a" },
      { title: "Route B", url: "http://localhost:5173/route-b" },
    ];
    view.webContents.activeHistoryIndex = 1;
    view.webContents.canGoBackResult = true;

    manager.goBack({ hostWindow, tabId: "browser:a" });

    expect(view.webContents.goBackCalls).toEqual(["goBack"]);
    expect(
      view.webContents.emitWillNavigate("http://localhost:5173/route-a"),
    ).toBe(false);
    expect(
      browserRequestBlocked({
        url: "http://localhost:5173/route-a",
        resourceType: "mainFrame",
        webContentsId: view.webContents.id,
      }),
    ).toBe(false);

    view.webContents.emitDidNavigate("http://localhost:5173/route-a");
    view.webContents.activeHistoryIndex = 0;
    view.webContents.canGoForwardResult = true;

    manager.goForward({ hostWindow, tabId: "browser:a" });

    expect(view.webContents.goForwardCalls).toEqual(["goForward"]);
    expect(
      view.webContents.emitWillNavigate("http://localhost:5173/route-b"),
    ).toBe(false);
    expect(
      browserRequestBlocked({
        url: "http://localhost:5173/route-b",
        resourceType: "mainFrame",
        webContentsId: view.webContents.id,
      }),
    ).toBe(false);
  });

  it("allows same-origin local subresources and blocks cross-port loopback requests", () => {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 56,
    });

    attachBrowserTab({
      manager,
      hostWindow,
      tabId: "browser:a",
      url: "http://localhost:5173/",
    });
    const view = requireFakeView(0);
    view.webContents.emitDidNavigate("http://localhost:5173/");

    expect(
      browserRequestBlocked({
        url: "http://localhost:5173/app.js",
        resourceType: "script",
        webContentsId: view.webContents.id,
        frameOrigin: "http://localhost:5173",
      }),
    ).toBe(false);
    expect(
      browserRequestBlocked({
        url: "ws://localhost:5173/socket",
        resourceType: "webSocket",
        webContentsId: view.webContents.id,
        frameOrigin: "http://localhost:5173",
      }),
    ).toBe(false);
    expect(
      browserRequestBlocked({
        url: "http://localhost:38886/api",
        resourceType: "xhr",
        webContentsId: view.webContents.id,
        frameOrigin: "http://localhost:5173",
      }),
    ).toBe(true);
    expect(
      view.webContents.emitWillFrameNavigate(
        "http://localhost:38886/",
        true,
        "http://localhost:5173",
      ),
    ).toBe(true);
    expect(
      browserRequestBlocked({
        url: "http://localhost:5173/app.js",
        resourceType: "script",
        webContentsId: view.webContents.id,
        frameOrigin: "http://localhost:5173",
      }),
    ).toBe(false);
  });

  it("blocks localhost requests from public iframes inside a local page", () => {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 57,
    });

    attachBrowserTab({
      manager,
      hostWindow,
      tabId: "browser:a",
      url: "http://localhost:5173/",
    });
    const view = requireFakeView(0);
    view.webContents.emitDidNavigate("http://localhost:5173/");

    expect(
      view.webContents.emitWillFrameNavigate(
        "http://localhost:5173/dashboard",
        true,
        "https://example.com",
      ),
    ).toBe(true);
    expect(
      browserRequestBlocked({
        url: "http://localhost:5173/dashboard",
        resourceType: "mainFrame",
        webContentsId: view.webContents.id,
        frameOrigin: "http://localhost:5173",
      }),
    ).toBe(true);
    expect(
      browserRequestBlocked({
        url: "http://localhost:5173/app.js",
        resourceType: "script",
        webContentsId: view.webContents.id,
        frameOrigin: "http://localhost:5173",
      }),
    ).toBe(false);
    expect(
      browserRequestBlocked({
        url: "http://localhost:5173/api",
        resourceType: "xhr",
        webContentsId: view.webContents.id,
        frameOrigin: "https://example.com",
      }),
    ).toBe(true);
  });

  it("does not surface loopback popups as trusted browser tabs", () => {
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

    expect(view.webContents.emitWindowOpen("http://localhost:38886/")).toEqual({
      action: "deny",
    });
    expect(openTabPushesOf(hostWindow)).toEqual([]);
  });

  it("clears local attribution on release and destroy", () => {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 59,
    });

    attachBrowserTab({
      manager,
      hostWindow,
      tabId: "browser:a",
      url: "http://localhost:5173/",
    });
    attachBrowserTab({
      manager,
      hostWindow,
      tabId: "browser:b",
      url: "http://localhost:3000/",
    });
    const releasedView = requireFakeView(0);
    const destroyedView = requireFakeView(1);
    releasedView.webContents.emitDidNavigate("http://localhost:5173/");
    destroyedView.webContents.emitDidNavigate("http://localhost:3000/");

    manager.releaseWindow(hostWindow.webContents.id);

    expect(releasedView.webContents.destroyed).toBe(true);
    expect(destroyedView.webContents.destroyed).toBe(true);
    expect(
      browserRequestBlocked({
        url: "http://localhost:5173/",
        resourceType: "mainFrame",
        webContentsId: releasedView.webContents.id,
      }),
    ).toBe(true);

    const secondHostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 60,
    });
    attachBrowserTab({
      manager,
      hostWindow: secondHostWindow,
      tabId: "browser:c",
      url: "http://localhost:5173/",
    });
    const destroyAllView = requireFakeView(2);
    destroyAllView.webContents.emitDidNavigate("http://localhost:5173/");

    manager.destroyAll();

    expect(destroyAllView.webContents.destroyed).toBe(true);
    expect(
      browserRequestBlocked({
        url: "http://localhost:5173/",
        resourceType: "mainFrame",
        webContentsId: destroyAllView.webContents.id,
      }),
    ).toBe(true);
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
});
