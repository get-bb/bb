import type { WebContentsView } from "electron";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  BbDesktopBrowserOpenTabRequest,
  BbDesktopBrowserViewBounds,
} from "@bb/server-contract";
import {
  createDesktopBrowserViewManager,
  type DesktopBrowserHostContentBounds,
  type DesktopBrowserHostContentView,
  type DesktopBrowserHostWebContents,
  type DesktopBrowserHostWebContentsPayload,
  type DesktopBrowserHostWindow,
} from "../src/desktop-browser-view.js";

type FakeWebContentsListener = (...args: never[]) => void;

interface FakeWindowOpenDetails {
  url: string;
}

interface FakeWindowOpenDecision {
  action: "deny";
}

type FakeWindowOpenHandler = (
  details: FakeWindowOpenDetails,
) => FakeWindowOpenDecision;

interface FakeBeforeRequestDetails {
  url: string;
  webContentsId?: number;
}

interface FakeBeforeRequestDecision {
  cancel: boolean;
}

interface FakeBeforeRequestDecisionHolder {
  value: FakeBeforeRequestDecision | null;
}

type FakeBeforeRequestCallback = (
  decision: FakeBeforeRequestDecision,
) => void;

type FakeBeforeRequestHandler = (
  details: FakeBeforeRequestDetails,
  callback: FakeBeforeRequestCallback,
) => void;

const electronMock = vi.hoisted(() => {
  interface FakeNativeImage {
    isEmpty(): boolean;
    toJPEG(quality: number): Buffer;
  }

  const fakeCapturedImage: FakeNativeImage = {
    isEmpty: () => false,
    toJPEG: () => Buffer.from("jpeg-bytes"),
  };
  const beforeRequestHandlers: FakeBeforeRequestHandler[] = [];
  let nextWebContentsId = 1;

  class FakeWebContents {
    public readonly id = nextWebContentsId++;
    public readonly pendingCaptureResolvers: Array<
      (image: FakeNativeImage) => void
    > = [];
    public windowOpenHandler: FakeWindowOpenHandler | null = null;

    public readonly navigationHistory = {
      canGoBack() {
        return false;
      },
      canGoForward() {
        return false;
      },
      goBack() {},
      goForward() {},
    };

    capturePage(): Promise<FakeNativeImage> {
      return new Promise((resolve) => {
        this.pendingCaptureResolvers.push(resolve);
      });
    }

    close(): void {}

    getTitle(): string {
      return "";
    }

    getURL(): string {
      return "";
    }

    isDestroyed(): boolean {
      return false;
    }

    isLoadingMainFrame(): boolean {
      return false;
    }

    loadURL(_url: string): Promise<void> {
      return Promise.resolve();
    }

    on(_eventName: string, _listener: FakeWebContentsListener): void {}

    reload(): void {}

    setWindowOpenHandler(handler: FakeWindowOpenHandler): void {
      this.windowOpenHandler = handler;
    }

    stop(): void {}
  }

  class FakeWebContentsView {
    public readonly boundsCalls: BbDesktopBrowserViewBounds[] = [];
    public readonly webContents = new FakeWebContents();
    public visible = false;

    setBounds(bounds: BbDesktopBrowserViewBounds): void {
      this.boundsCalls.push(bounds);
    }

    setVisible(visible: boolean): void {
      this.visible = visible;
    }
  }

  const fakeViews: FakeWebContentsView[] = [];

  return {
    beforeRequestHandlers,
    fakeCapturedImage,
    fakeViews,
    FakeWebContentsView: class extends FakeWebContentsView {
      constructor() {
        super();
        fakeViews.push(this);
      }
    },
    session: {
      fromPartition() {
        return {
          on() {},
          setPermissionCheckHandler() {},
          setPermissionRequestHandler() {},
          webRequest: {
            onBeforeRequest(handler: FakeBeforeRequestHandler) {
              beforeRequestHandlers.push(handler);
            },
          },
        };
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
  electronMock.beforeRequestHandlers.length = 0;
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

function openTabPushesOf(
  hostWindow: FakeHostWindow,
): BbDesktopBrowserOpenTabRequest[] {
  const pushes: BbDesktopBrowserOpenTabRequest[] = [];
  for (const payload of hostWindow.webContents.sentPayloads) {
    if ("url" in payload && !("tabId" in payload)) {
      pushes.push(payload);
    }
  }
  return pushes;
}

function runBeforeRequest(details: FakeBeforeRequestDetails): boolean {
  const handler = electronMock.beforeRequestHandlers.at(-1);
  expect(handler).toBeDefined();
  if (handler === undefined) {
    throw new Error("Expected a webRequest handler to be registered.");
  }
  const decision: FakeBeforeRequestDecisionHolder = { value: null };
  handler(details, (nextDecision) => {
    decision.value = nextDecision;
  });
  expect(decision.value).not.toBeNull();
  if (decision.value === null) {
    throw new Error("Expected the webRequest handler to return a decision.");
  }
  return decision.value.cancel;
}

function getWindowOpenHandler(
  view: (typeof electronMock.fakeViews)[number],
): FakeWindowOpenHandler {
  const handler = view.webContents.windowOpenHandler;
  expect(handler).not.toBeNull();
  if (handler === null) {
    throw new Error("Expected the window.open handler to be registered.");
  }
  return handler;
}

describe("DesktopBrowserViewManager", () => {
  it("snapshots then hides visible views on resize, revealing them clamped to the shrunken window", async () => {
    const manager = createDesktopBrowserViewManager({ partition: "persist:test" });
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
    const manager = createDesktopBrowserViewManager({ partition: "persist:test" });
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
    const manager = createDesktopBrowserViewManager({ partition: "persist:test" });
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
    const manager = createDesktopBrowserViewManager({ partition: "persist:test" });
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
    const manager = createDesktopBrowserViewManager({ partition: "persist:test" });
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
    const manager = createDesktopBrowserViewManager({ partition: "persist:test" });
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

  it("allows localhost requests through the session firewall", () => {
    const manager = createDesktopBrowserViewManager({ partition: "persist:test" });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 47,
    });

    manager.attach({
      hostWindow,
      request: {
        tabId: "browser:a",
        url: "https://example.com",
        bounds: { x: 100, y: 50, width: 500, height: 350 },
        visible: true,
      },
    });

    const view = electronMock.fakeViews[0];
    expect(view).toBeDefined();
    if (view === undefined) {
      throw new Error("Expected the browser view to be created.");
    }

    expect(
      runBeforeRequest({
        url: "http://localhost:3000/",
        webContentsId: view.webContents.id,
      }),
    ).toBe(false);
    expect(
      runBeforeRequest({
        url: "ws://127.0.0.1:3000/socket",
        webContentsId: view.webContents.id,
      }),
    ).toBe(false);
    expect(
      runBeforeRequest({
        url: "http://192.168.1.1/",
        webContentsId: view.webContents.id,
      }),
    ).toBe(true);
    expect(runBeforeRequest({ url: "http://localhost:3000/" })).toBe(false);
  });

  it("allows localhost popup tabs", () => {
    const manager = createDesktopBrowserViewManager({ partition: "persist:test" });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 48,
    });

    manager.attach({
      hostWindow,
      request: {
        tabId: "browser:a",
        url: "https://example.com",
        bounds: { x: 100, y: 50, width: 500, height: 350 },
        visible: true,
      },
    });

    const view = electronMock.fakeViews[0];
    expect(view).toBeDefined();
    if (view === undefined) {
      throw new Error("Expected the browser view to be created.");
    }
    const handler = getWindowOpenHandler(view);

    expect(handler({ url: "http://localhost:3000/" })).toEqual({
      action: "deny",
    });
    expect(openTabPushesOf(hostWindow)).toEqual([
      { url: "http://localhost:3000/" },
    ]);
  });
});
