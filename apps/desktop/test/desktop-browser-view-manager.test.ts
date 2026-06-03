import type { WebContentsView } from "electron";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BbDesktopBrowserViewBounds } from "@bb/server-contract";
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

const electronMock = vi.hoisted(() => {
  class FakeWebContents {
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

    setWindowOpenHandler(_handler: FakeWindowOpenHandler): void {}

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
            onBeforeRequest() {},
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
  electronMock.fakeViews.length = 0;
});

describe("DesktopBrowserViewManager", () => {
  it("reprojects visible view bounds from the cached layout descriptor on host resize", () => {
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
        layout: { left: 100, top: 50, rightInset: 100, bottomInset: 50 },
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

    hostWindow.contentBounds = { width: 80, height: 40 };
    manager.syncVisibleBoundsForWindow(hostWindow);

    expect(view.boundsCalls[1]).toEqual({
      x: 80,
      y: 40,
      width: 0,
      height: 0,
    });

    hostWindow.contentBounds = { width: 900, height: 640 };
    manager.syncVisibleBoundsForWindow(hostWindow);

    expect(view.boundsCalls[2]).toEqual({
      x: 100,
      y: 50,
      width: 700,
      height: 540,
    });
  });

  it("does not resize hidden views from the native host resize path", () => {
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
        layout: { left: 100, top: 50, rightInset: 100, bottomInset: 50 },
        visible: false,
      },
    });

    const view = electronMock.fakeViews[0];
    expect(view).toBeDefined();
    if (view === undefined) {
      throw new Error("Expected the browser view to be created.");
    }

    hostWindow.contentBounds = { width: 900, height: 640 };
    manager.syncVisibleBoundsForWindow(hostWindow);

    expect(view.boundsCalls).toHaveLength(1);
  });
});
