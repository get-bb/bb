import type { WebContentsView } from "electron";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BB_DESKTOP_FIND_BAR_ACTIVATE_CHANNEL } from "../src/find-bar-ipc.js";
import {
  createDesktopFindViewManager,
  type FindViewBounds,
  type FindViewHostContentView,
  type FindViewHostWindow,
} from "../src/desktop-find-view.js";
import {
  FIND_BAR_VIEW_HEIGHT,
  FIND_BAR_VIEW_WIDTH,
} from "../src/find-bar-view.js";

const electronMock = vi.hoisted(() => {
  interface FakeIpcEvent {
    sender: { id: number };
  }
  type FakeIpcListener = (event: FakeIpcEvent, payload: unknown) => void;
  const listeners = new Map<string, FakeIpcListener>();

  class FakeWebContentsView {
    public bounds: FindViewBounds | null = null;
    public visible: boolean | null = null;
    public destroyed = false;
    public focusCount = 0;
    public readonly sendCalls: { channel: string; payload?: unknown }[] = [];
    public readonly webContents;

    constructor() {
      this.webContents = {
        id: 42,
        focus: () => {
          this.focusCount += 1;
        },
        isDestroyed: () => this.destroyed,
        send: (channel: string, payload?: unknown) => {
          this.sendCalls.push({ channel, payload });
        },
        loadURL: async () => {},
        close: () => {
          this.destroyed = true;
        },
      };
    }

    setBackgroundColor(): void {}

    setBounds(bounds: FindViewBounds): void {
      this.bounds = bounds;
    }

    setVisible(visible: boolean): void {
      this.visible = visible;
    }
  }

  const createdViews: FakeWebContentsView[] = [];

  return {
    createdViews,
    listeners,
    WebContentsView: class extends FakeWebContentsView {
      constructor() {
        super();
        createdViews.push(this);
      }
    },
    ipcMain: {
      on(channel: string, listener: FakeIpcListener): void {
        listeners.set(channel, listener);
      },
    },
  };
});

vi.mock("electron", () => ({
  ipcMain: electronMock.ipcMain,
  WebContentsView: electronMock.WebContentsView,
}));

class FakeContentView implements FindViewHostContentView {
  public readonly views: object[] = [];

  addChildView(view: WebContentsView): void {
    this.views.push(view);
  }

  removeChildView(view: WebContentsView): void {
    const index = this.views.indexOf(view);
    if (index >= 0) this.views.splice(index, 1);
  }
}

class FakeHostWindow implements FindViewHostWindow {
  private destroyed = false;
  private readonly liveContentView = new FakeContentView();
  private readonly liveWebContents = {
    id: 7,
    focus: () => {},
    isDestroyed: () => this.destroyed,
    findInPage: () => 1,
    stopFindInPage: () => {},
    on: () => {},
  };

  get contentView(): FakeContentView {
    this.assertAlive();
    return this.liveContentView;
  }

  get webContents() {
    this.assertAlive();
    return this.liveWebContents;
  }

  destroy(): void {
    this.destroyed = true;
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  getContentBounds(): FindViewBounds {
    this.assertAlive();
    return { x: 0, y: 0, width: 1200, height: 800 };
  }

  private assertAlive(): void {
    if (this.destroyed) {
      throw new TypeError("Object has been destroyed");
    }
  }
}

describe("createDesktopFindViewManager", () => {
  beforeEach(() => {
    electronMock.listeners.clear();
    electronMock.createdViews.length = 0;
  });

  it("opens the find bar clear of the window chrome the renderer reported", () => {
    const host = new FakeHostWindow();
    const manager = createDesktopFindViewManager({
      preloadPath: "/tmp/find-bar-preload.cjs",
    });

    manager.open(host, { topOffset: 48 });

    const view = electronMock.createdViews.at(-1);
    expect(view?.bounds).toEqual({
      x: 1200 - FIND_BAR_VIEW_WIDTH,
      y: 48,
      width: FIND_BAR_VIEW_WIDTH,
      height: FIND_BAR_VIEW_HEIGHT,
    });
    expect(host.contentView.views).toEqual([view]);
    expect(view?.visible).toBe(true);
    expect(view?.focusCount).toBe(1);
    expect(view?.sendCalls).toEqual([
      { channel: BB_DESKTOP_FIND_BAR_ACTIVATE_CHANNEL, payload: undefined },
    ]);
  });

  it("releases a window after Electron has destroyed it", () => {
    const host = new FakeHostWindow();
    const manager = createDesktopFindViewManager({
      preloadPath: "/tmp/find-bar-preload.cjs",
    });
    manager.open(host, { topOffset: 48 });
    const view = electronMock.createdViews.at(-1);

    host.destroy();

    expect(() => manager.releaseWindow(7)).not.toThrow();
    expect(view?.destroyed).toBe(true);

    const nextHost = new FakeHostWindow();
    manager.open(nextHost, { topOffset: 48 });
    expect(electronMock.createdViews).toHaveLength(2);
    expect(nextHost.contentView.views).toEqual([
      electronMock.createdViews.at(-1),
    ]);
  });
});
