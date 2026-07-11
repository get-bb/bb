import type { BrowserWindow } from "electron";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDesktopServerViewCache } from "../src/desktop-server-view-cache.js";

const electronMock = vi.hoisted(() => {
  let nextWebContentsId = 100;

  class FakeWebContents {
    public closed = false;
    public focused = false;
    public readonly id = nextWebContentsId++;
    public readonly loadedUrls: string[] = [];
    public reloadCount = 0;
    public reloadIgnoringCacheCount = 0;
    public readonly session = {
      setSpellCheckerEnabled: vi.fn(),
    };
    public zoomFactor = 0;

    close(): void {
      this.closed = true;
    }

    focus(): void {
      this.focused = true;
    }

    getURL(): string {
      return this.loadedUrls.at(-1) ?? "";
    }

    isDestroyed(): boolean {
      return this.closed;
    }

    loadURL(url: string): Promise<void> {
      this.loadedUrls.push(url);
      return Promise.resolve();
    }

    openDevTools(): void {}
    reload(): void {
      this.reloadCount += 1;
    }
    reloadIgnoringCache(): void {
      this.reloadIgnoringCacheCount += 1;
    }
    send(): void {}
    setWindowOpenHandler(): void {}
    setZoomFactor(factor: number): void {
      this.zoomFactor = factor;
    }
  }

  class FakeWebContentsView {
    public readonly bounds: Array<{
      height: number;
      width: number;
      x: number;
      y: number;
    }> = [];
    public readonly webContents = new FakeWebContents();
    public readonly visibility: boolean[] = [];

    setBounds(bounds: {
      height: number;
      width: number;
      x: number;
      y: number;
    }): void {
      this.bounds.push(bounds);
    }

    setVisible(visible: boolean): void {
      this.visibility.push(visible);
    }
  }

  return {
    FakeWebContents,
    FakeWebContentsView,
    reset() {
      nextWebContentsId = 100;
    },
    views: [] as FakeWebContentsView[],
  };
});

vi.mock("electron", () => ({
  WebContentsView: class extends electronMock.FakeWebContentsView {
    constructor() {
      super();
      electronMock.views.push(this);
    }
  },
}));

class FakeHostWindow {
  public readonly contentView = {
    addChildView: vi.fn(),
    removeChildView: vi.fn(),
  };
  public readonly id: number;
  public readonly webContents = new electronMock.FakeWebContents();
  private contentBounds = { height: 700, width: 1000 };
  private destroyed = false;
  private readonly listeners = new Map<string, Array<() => void>>();

  constructor(id: number) {
    this.id = id;
  }

  emit(eventName: string): void {
    for (const listener of this.listeners.get(eventName) ?? []) {
      listener();
    }
  }

  getContentBounds(): { height: number; width: number } {
    return this.contentBounds;
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  on(eventName: string, listener: () => void): void {
    const listeners = this.listeners.get(eventName) ?? [];
    listeners.push(listener);
    this.listeners.set(eventName, listeners);
  }

  once(eventName: string, listener: () => void): void {
    this.on(eventName, listener);
  }

  resize(width: number, height: number): void {
    this.contentBounds = { height, width };
    this.emit("resize");
  }
}

function asBrowserWindow(hostWindow: FakeHostWindow): BrowserWindow {
  return hostWindow as unknown as BrowserWindow;
}

beforeEach(() => {
  electronMock.reset();
  electronMock.views.length = 0;
});

describe("DesktopServerViewCache", () => {
  it("loads each server renderer once and restores it on later switches", async () => {
    const created = vi.fn();
    const destroyed = vi.fn();
    const hostWindow = new FakeHostWindow(1);
    const browserWindow = asBrowserWindow(hostWindow);
    const cache = createDesktopServerViewCache({
      onRendererCreated: created,
      onRendererDestroyed: destroyed,
      openExternalUrl: vi.fn(),
      preloadPath: "/tmp/preload.cjs",
    });
    cache.registerWindow({
      hostWindow: browserWindow,
      primaryServerId: "local",
    });

    const firstRemote = await cache.activate({
      hostWindow: browserWindow,
      serverId: "remote",
      url: "https://remote.example.test/",
    });
    await electronMock.views[0]?.webContents.loadURL(
      "https://remote.example.test/thread/thr_123",
    );
    await cache.activate({
      hostWindow: browserWindow,
      serverId: "local",
      url: "http://127.0.0.1:38886/",
    });
    const restoredRemote = await cache.activate({
      hostWindow: browserWindow,
      serverId: "remote",
      url: "https://remote.example.test/",
    });
    cache.reload(browserWindow, false);
    cache.reload(browserWindow, true);

    expect(electronMock.views).toHaveLength(1);
    expect(electronMock.views[0]?.webContents.loadedUrls).toEqual([
      "https://remote.example.test/",
      "https://remote.example.test/thread/thr_123",
    ]);
    expect(electronMock.views[0]?.webContents.getURL()).toBe(
      "https://remote.example.test/thread/thr_123",
    );
    expect(electronMock.views[0]?.webContents.reloadCount).toBe(1);
    expect(electronMock.views[0]?.webContents.reloadIgnoringCacheCount).toBe(1);
    expect(restoredRemote.rendererWebContentsId).toBe(
      firstRemote.rendererWebContentsId,
    );
    expect(electronMock.views[0]?.visibility).toEqual([
      false,
      true,
      false,
      true,
    ]);
    expect(created).toHaveBeenCalledTimes(1);
    expect(destroyed).not.toHaveBeenCalled();
  });

  it("keeps cached views sized to the host and disposes removed servers", async () => {
    const destroyed = vi.fn();
    const hostWindow = new FakeHostWindow(2);
    const browserWindow = asBrowserWindow(hostWindow);
    const cache = createDesktopServerViewCache({
      onRendererCreated: vi.fn(),
      onRendererDestroyed: destroyed,
      openExternalUrl: vi.fn(),
      preloadPath: "/tmp/preload.cjs",
    });
    cache.registerWindow({
      hostWindow: browserWindow,
      primaryServerId: "local",
    });
    const activation = await cache.activate({
      hostWindow: browserWindow,
      serverId: "remote",
      url: "https://remote.example.test/",
    });

    hostWindow.resize(820, 540);
    cache.removeServer("remote");

    expect(electronMock.views[0]?.bounds).toEqual([
      { height: 700, width: 1000, x: 0, y: 0 },
      { height: 540, width: 820, x: 0, y: 0 },
    ]);
    expect(electronMock.views[0]?.webContents.closed).toBe(true);
    expect(destroyed).toHaveBeenCalledWith({
      hostWindow: browserWindow,
      serverId: "remote",
      webContentsId: activation.rendererWebContentsId,
    });
    expect(cache.getActiveWebContents(browserWindow)).toBe(
      hostWindow.webContents,
    );
  });
});
