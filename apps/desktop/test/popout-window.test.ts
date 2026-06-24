import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserWindowConstructorOptions } from "electron";
import { createPopoutWindowManager } from "../src/popout-window.js";
import {
  BB_DESKTOP_POPOUT_SET_MOUSE_EVENTS_IGNORED_CHANNEL,
  BB_DESKTOP_POPOUT_THREAD_CHANGED_CHANNEL,
} from "../src/popout-ipc.js";
import {
  shouldHandlePopoutToggleSender,
  shouldHandlePopoutWindowSender,
} from "../src/popout-ipc-authorization.js";
import {
  POPOUT_WINDOW_HEIGHT,
  POPOUT_WINDOW_WIDTH,
} from "@bb/desktop-contract";

const electronMock = vi.hoisted(() => {
  interface Bounds {
    height: number;
    width: number;
    x: number;
    y: number;
  }

  interface Point {
    x: number;
    y: number;
  }

  interface Display {
    workArea: Bounds;
  }

  type Listener = () => void;

  const primaryDisplay: Display = {
    workArea: { height: 900, width: 1440, x: 0, y: 0 },
  };
  const secondaryDisplay: Display = {
    workArea: { height: 900, width: 1440, x: 1440, y: 0 },
  };

  function containsPoint(display: Display, point: Point): boolean {
    const workArea = display.workArea;
    return (
      point.x >= workArea.x &&
      point.x < workArea.x + workArea.width &&
      point.y >= workArea.y &&
      point.y < workArea.y + workArea.height
    );
  }

  function getBoundsCenter(bounds: Bounds): Point {
    return {
      x: bounds.x + Math.round(bounds.width / 2),
      y: bounds.y + Math.round(bounds.height / 2),
    };
  }

  class FakeWebContents {
    public readonly sentMessages: Array<{ channel: string; payload: unknown }> =
      [];
    private readonly listeners = new Map<string, Listener[]>();

    on(channel: string, listener: Listener): void {
      const listeners = this.listeners.get(channel) ?? [];
      listeners.push(listener);
      this.listeners.set(channel, listeners);
    }

    send(channel: string, payload: unknown): void {
      this.sentMessages.push({ channel, payload });
    }

    setWindowOpenHandler(): void {}

    emit(channel: string): void {
      for (const listener of this.listeners.get(channel) ?? []) {
        listener();
      }
    }
  }

  class FakeBrowserWindow {
    public readonly options: BrowserWindowConstructorOptions;
    public readonly webContents = new FakeWebContents();
    public destroyed = false;
    public focused = false;
    public ignoreMouseEventsCalls: Array<{
      ignore: boolean;
      options: { forward: boolean } | undefined;
    }> = [];
    public loadUrlCalls: string[] = [];
    public setBoundsCalls: Bounds[] = [];
    public shown = false;
    public visible = false;
    public visibleOnAllWorkspaces = false;
    private bounds: Bounds;
    private resolveLoad: (() => void) | null = null;
    private rejectLoad: ((error: Error) => void) | null = null;
    private readonly listeners = new Map<string, Listener[]>();

    constructor(options: BrowserWindowConstructorOptions) {
      this.options = options;
      this.bounds = {
        height: options.height ?? 0,
        width: options.width ?? 0,
        x: options.x ?? 0,
        y: options.y ?? 0,
      };
      createdWindows.push(this);
    }

    destroy(): void {
      this.destroyed = true;
      this.visible = false;
      this.emit("closed");
    }

    focus(): void {
      this.focused = true;
    }

    getBounds(): Bounds {
      return this.bounds;
    }

    hide(): void {
      this.visible = false;
    }

    isDestroyed(): boolean {
      return this.destroyed;
    }

    isVisible(): boolean {
      return this.visible;
    }

    loadURL(url: string): Promise<void> {
      this.loadUrlCalls.push(url);
      return new Promise((resolve, reject) => {
        this.resolveLoad = resolve;
        this.rejectLoad = reject;
      });
    }

    on(channel: string, listener: Listener): void {
      const listeners = this.listeners.get(channel) ?? [];
      listeners.push(listener);
      this.listeners.set(channel, listeners);
    }

    setBounds(bounds: Bounds): void {
      this.bounds = bounds;
      this.setBoundsCalls.push(bounds);
    }

    setIgnoreMouseEvents(
      ignore: boolean,
      options?: { forward: boolean },
    ): void {
      this.ignoreMouseEventsCalls.push({ ignore, options });
    }

    setVisibleOnAllWorkspaces(): void {
      this.visibleOnAllWorkspaces = true;
    }

    show(): void {
      this.shown = true;
      this.visible = true;
    }

    rejectLoaded(error: Error): void {
      this.rejectLoad?.(error);
    }

    emitDidFinishLoad(): void {
      this.webContents.emit("did-finish-load");
    }

    emitReadyToShow(): void {
      this.emit("ready-to-show");
    }

    resolveLoadUrl(): void {
      this.resolveLoad?.();
    }

    private emit(channel: string): void {
      for (const listener of this.listeners.get(channel) ?? []) {
        listener();
      }
    }
  }

  const createdWindows: FakeBrowserWindow[] = [];
  let cursorPoint: Point = { x: 100, y: 100 };

  return {
    createdWindows,
    BrowserWindow: FakeBrowserWindow,
    screen: {
      getCursorScreenPoint() {
        return cursorPoint;
      },
      getDisplayNearestPoint(point: Point) {
        return containsPoint(secondaryDisplay, point)
          ? secondaryDisplay
          : primaryDisplay;
      },
      getDisplayMatching(bounds: Bounds) {
        const center = getBoundsCenter(bounds);
        return containsPoint(secondaryDisplay, center)
          ? secondaryDisplay
          : primaryDisplay;
      },
    },
    reset(): void {
      createdWindows.length = 0;
      cursorPoint = { x: 100, y: 100 };
    },
    setCursorPoint(point: Point): void {
      cursorPoint = point;
    },
  };
});

vi.mock("electron", () => ({
  BrowserWindow: electronMock.BrowserWindow,
  screen: electronMock.screen,
}));

beforeEach(() => {
  electronMock.reset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createPopoutWindowManager", () => {
  it("warms the popout window hidden without showing or focusing it", () => {
    const manager = createPopoutWindowManager({
      appUrl: "http://127.0.0.1:38886",
      preloadPath: "/tmp/preload.cjs",
      openExternalUrl() {},
      openInMainHandler: async () => true,
    });

    manager.warm();

    const browserWindow = electronMock.createdWindows[0];
    expect(electronMock.createdWindows).toHaveLength(1);
    expect(browserWindow?.options).not.toHaveProperty("type");
    expect(browserWindow?.options.paintWhenInitiallyHidden).toBe(true);
    expect(browserWindow?.options.webPreferences).toMatchObject({
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false,
      preload: "/tmp/preload.cjs",
      sandbox: true,
    });
    expect(browserWindow?.options.show).toBe(false);
    expect(browserWindow?.loadUrlCalls).toEqual([
      "http://127.0.0.1:38886/popout",
    ]);
    expect(browserWindow?.shown).toBe(false);
    expect(browserWindow?.focused).toBe(false);
    expect(browserWindow?.isVisible()).toBe(false);
    expect(browserWindow?.webContents.sentMessages).toEqual([]);
  });

  it("shows a warmed popout without loading the renderer again", async () => {
    const manager = createPopoutWindowManager({
      appUrl: "http://127.0.0.1:38886",
      preloadPath: "/tmp/preload.cjs",
      openExternalUrl() {},
      openInMainHandler: async () => true,
    });

    manager.warm();
    const browserWindow = electronMock.createdWindows[0];
    browserWindow?.emitDidFinishLoad();
    browserWindow?.resolveLoadUrl();
    browserWindow?.emitReadyToShow();
    await manager.toggle();

    expect(electronMock.createdWindows).toHaveLength(1);
    expect(browserWindow?.loadUrlCalls).toEqual([
      "http://127.0.0.1:38886/popout",
    ]);
    expect(browserWindow?.shown).toBe(true);
    expect(browserWindow?.focused).toBe(true);
  });

  it("shows a selected thread after load even if ready-to-show does not fire", async () => {
    const manager = createPopoutWindowManager({
      appUrl: "http://127.0.0.1:38886",
      preloadPath: "/tmp/preload.cjs",
      openExternalUrl() {},
      openInMainHandler: async () => true,
    });

    manager.warm();
    const showPromise = manager.setThread({
      projectId: "proj_a",
      threadId: "thr_a",
    });
    const browserWindow = electronMock.createdWindows[0];
    browserWindow?.emitDidFinishLoad();
    browserWindow?.resolveLoadUrl();
    await showPromise;

    expect(browserWindow?.shown).toBe(true);
    expect(browserWindow?.focused).toBe(true);
    expect(browserWindow?.webContents.sentMessages).toContainEqual({
      channel: BB_DESKTOP_POPOUT_THREAD_CHANGED_CHANNEL,
      payload: { projectId: "proj_a", threadId: "thr_a" },
    });
  });

  it("destroys a warmed popout when the manager is destroyed", () => {
    const manager = createPopoutWindowManager({
      appUrl: "http://127.0.0.1:38886",
      preloadPath: "/tmp/preload.cjs",
      openExternalUrl() {},
      openInMainHandler: async () => true,
    });

    manager.warm();
    const browserWindow = electronMock.createdWindows[0];
    manager.destroy();

    expect(browserWindow?.destroyed).toBe(true);
    expect(manager.getCurrentThread()).toBeNull();
  });

  it("waits for load before first show and replays the current thread", async () => {
    const manager = createPopoutWindowManager({
      appUrl: "http://127.0.0.1:38886",
      preloadPath: "/tmp/preload.cjs",
      openExternalUrl() {},
      openInMainHandler: async () => true,
    });

    const showPromise = manager.setThread({
      projectId: "proj_a",
      threadId: "thr_a",
    });
    const browserWindow = electronMock.createdWindows[0];
    expect(browserWindow?.shown).toBe(false);
    browserWindow?.emitDidFinishLoad();
    browserWindow?.resolveLoadUrl();
    browserWindow?.emitReadyToShow();
    await showPromise;

    expect(browserWindow?.shown).toBe(true);
    expect(browserWindow?.options).toMatchObject({
      alwaysOnTop: true,
      backgroundColor: "#00000000",
      frame: false,
      hasShadow: false,
      height: POPOUT_WINDOW_HEIGHT,
      paintWhenInitiallyHidden: true,
      resizable: false,
      skipTaskbar: true,
      transparent: true,
      width: POPOUT_WINDOW_WIDTH,
    });
    expect(browserWindow?.options).not.toHaveProperty("type");
    expect(browserWindow?.options.webPreferences).toMatchObject({
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false,
      preload: "/tmp/preload.cjs",
      sandbox: true,
    });
    expect(browserWindow?.options).not.toHaveProperty("vibrancy");
    expect(browserWindow?.ignoreMouseEventsCalls).toEqual([]);
    expect(browserWindow?.webContents.sentMessages).toContainEqual({
      channel: BB_DESKTOP_POPOUT_THREAD_CHANGED_CHANNEL,
      payload: { projectId: "proj_a", threadId: "thr_a" },
    });
    expect(manager.getCurrentThread()).toEqual({
      projectId: "proj_a",
      threadId: "thr_a",
    });
  });

  it("does not replay an unchanged thread on popout re-summon", async () => {
    const manager = createPopoutWindowManager({
      appUrl: "http://127.0.0.1:38886",
      preloadPath: "/tmp/preload.cjs",
      openExternalUrl() {},
      openInMainHandler: async () => true,
    });
    manager.setCurrentThread({ projectId: "proj_a", threadId: "thr_a" });

    manager.warm();
    const browserWindow = electronMock.createdWindows[0];
    browserWindow?.emitDidFinishLoad();
    browserWindow?.resolveLoadUrl();
    browserWindow?.emitReadyToShow();
    await manager.toggle();
    await manager.toggle();
    await manager.toggle();

    expect(browserWindow?.webContents.sentMessages).toEqual([
      {
        channel: BB_DESKTOP_POPOUT_THREAD_CHANGED_CHANNEL,
        payload: { projectId: "proj_a", threadId: "thr_a" },
      },
    ]);
  });

  it("sends a thread change when setThread adopts a different thread", async () => {
    const manager = createPopoutWindowManager({
      appUrl: "http://127.0.0.1:38886",
      preloadPath: "/tmp/preload.cjs",
      openExternalUrl() {},
      openInMainHandler: async () => true,
    });
    manager.setCurrentThread({ projectId: "proj_a", threadId: "thr_a" });

    manager.warm();
    const browserWindow = electronMock.createdWindows[0];
    browserWindow?.emitDidFinishLoad();
    browserWindow?.resolveLoadUrl();
    browserWindow?.emitReadyToShow();
    await manager.toggle();
    await manager.setThread({ projectId: "proj_a", threadId: "thr_b" });

    expect(browserWindow?.webContents.sentMessages).toEqual([
      {
        channel: BB_DESKTOP_POPOUT_THREAD_CHANGED_CHANNEL,
        payload: { projectId: "proj_a", threadId: "thr_a" },
      },
      {
        channel: BB_DESKTOP_POPOUT_THREAD_CHANGED_CHANNEL,
        payload: { projectId: "proj_a", threadId: "thr_b" },
      },
    ]);
  });

  it("keeps same-display re-summons in place and repositions across displays", async () => {
    const manager = createPopoutWindowManager({
      appUrl: "http://127.0.0.1:38886",
      preloadPath: "/tmp/preload.cjs",
      openExternalUrl() {},
      openInMainHandler: async () => true,
    });

    manager.warm();
    const browserWindow = electronMock.createdWindows[0];
    browserWindow?.emitDidFinishLoad();
    browserWindow?.resolveLoadUrl();
    browserWindow?.emitReadyToShow();
    await manager.toggle();
    expect(browserWindow?.setBoundsCalls).toHaveLength(1);

    await manager.toggle();
    await manager.toggle();
    expect(browserWindow?.setBoundsCalls).toHaveLength(1);

    await manager.toggle();
    electronMock.setCursorPoint({ x: 1500, y: 100 });
    await manager.toggle();

    expect(browserWindow?.setBoundsCalls).toHaveLength(2);
    expect(browserWindow?.getBounds().x).toBeGreaterThanOrEqual(1440);
  });

  it("forwards popout mouse passthrough changes to Electron", async () => {
    const manager = createPopoutWindowManager({
      appUrl: "http://127.0.0.1:38886",
      preloadPath: "/tmp/preload.cjs",
      openExternalUrl() {},
      openInMainHandler: async () => true,
    });
    const showPromise = manager.toggle();
    const browserWindow = electronMock.createdWindows[0];
    browserWindow?.emitDidFinishLoad();
    browserWindow?.resolveLoadUrl();
    browserWindow?.emitReadyToShow();
    await showPromise;

    manager.setMouseEventsIgnored({ ignore: true });
    manager.setMouseEventsIgnored({ ignore: false });

    expect(browserWindow?.ignoreMouseEventsCalls).toEqual([
      { ignore: true, options: { forward: true } },
      { ignore: false, options: { forward: true } },
    ]);
  });

  it("gates the mouse passthrough channel to the popout webContents", () => {
    expect(BB_DESKTOP_POPOUT_SET_MOUSE_EVENTS_IGNORED_CHANNEL).toBe(
      "bb-desktop:popout:set-mouse-events-ignored",
    );
    expect(shouldHandlePopoutWindowSender(true)).toBe(true);
    expect(shouldHandlePopoutWindowSender(false)).toBe(false);
  });

  it("hides only after open-in-main succeeds", async () => {
    const manager = createPopoutWindowManager({
      appUrl: "http://127.0.0.1:38886",
      preloadPath: "/tmp/preload.cjs",
      openExternalUrl() {},
      openInMainHandler: async () => false,
    });
    const showPromise = manager.toggle();
    const browserWindow = electronMock.createdWindows[0];
    browserWindow?.emitDidFinishLoad();
    browserWindow?.resolveLoadUrl();
    browserWindow?.emitReadyToShow();
    await showPromise;

    manager.openInMain({ projectId: "proj_a", threadId: "thr_a" });
    await Promise.resolve();
    expect(browserWindow?.isVisible()).toBe(true);
  });

  it("logs open-in-main failures without hiding the popout", async () => {
    const stderrWrite = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    const manager = createPopoutWindowManager({
      appUrl: "http://127.0.0.1:38886",
      preloadPath: "/tmp/preload.cjs",
      openExternalUrl() {},
      openInMainHandler: async () => {
        throw new Error("main window failed");
      },
    });
    const showPromise = manager.toggle();
    const browserWindow = electronMock.createdWindows[0];
    browserWindow?.emitDidFinishLoad();
    browserWindow?.resolveLoadUrl();
    browserWindow?.emitReadyToShow();
    await showPromise;

    manager.openInMain({ projectId: "proj_a", threadId: "thr_a" });
    await Promise.resolve();
    await Promise.resolve();

    expect(browserWindow?.isVisible()).toBe(true);
    expect(stderrWrite).toHaveBeenCalledWith(
      "Could not open popout thread in main window: main window failed\n",
    );
  });

  it("accepts a toggle from its own webContents and hides the visible popout", async () => {
    const manager = createPopoutWindowManager({
      appUrl: "http://127.0.0.1:38886",
      preloadPath: "/tmp/preload.cjs",
      openExternalUrl() {},
      openInMainHandler: async () => true,
    });
    const showPromise = manager.toggle();
    const browserWindow = electronMock.createdWindows[0];
    browserWindow?.emitDidFinishLoad();
    browserWindow?.resolveLoadUrl();
    browserWindow?.emitReadyToShow();
    await showPromise;

    const shouldHandleToggle = shouldHandlePopoutToggleSender({
      isApplicationWindowSender: false,
      isPopoutWindowSender: true,
    });
    if (shouldHandleToggle) {
      await manager.toggle();
    }

    expect(shouldHandleToggle).toBe(true);
    expect(browserWindow?.isVisible()).toBe(false);
  });

  it("destroys a warm window after load failure", async () => {
    const manager = createPopoutWindowManager({
      appUrl: "http://127.0.0.1:38886",
      preloadPath: "/tmp/preload.cjs",
      openExternalUrl() {},
      openInMainHandler: async () => true,
    });
    const showPromise = manager.toggle();
    const browserWindow = electronMock.createdWindows[0];
    browserWindow?.rejectLoaded(new Error("ERR_CONNECTION_REFUSED"));
    await expect(showPromise).rejects.toThrow("ERR_CONNECTION_REFUSED");

    expect(browserWindow?.destroyed).toBe(true);
    const secondShowPromise = manager.toggle();
    electronMock.createdWindows[1]?.emitDidFinishLoad();
    electronMock.createdWindows[1]?.resolveLoadUrl();
    electronMock.createdWindows[1]?.emitReadyToShow();
    await expect(secondShowPromise).resolves.toBeUndefined();
    expect(electronMock.createdWindows).toHaveLength(2);
  });
});
