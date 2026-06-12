import { describe, expect, it, vi, beforeEach } from "vitest";
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

const electronMock = vi.hoisted(() => {
  interface Bounds {
    height: number;
    width: number;
    x: number;
    y: number;
  }

  type Listener = () => void;

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

    loadURL(): Promise<void> {
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

    resolveLoaded(): void {
      this.resolveLoad?.();
    }

    rejectLoaded(error: Error): void {
      this.rejectLoad?.(error);
    }

    private emit(channel: string): void {
      for (const listener of this.listeners.get(channel) ?? []) {
        listener();
      }
    }
  }

  const createdWindows: FakeBrowserWindow[] = [];

  return {
    createdWindows,
    BrowserWindow: FakeBrowserWindow,
    screen: {
      getCursorScreenPoint() {
        return { x: 100, y: 100 };
      },
      getDisplayNearestPoint() {
        return { workArea: { height: 900, width: 1440, x: 0, y: 0 } };
      },
      getDisplayMatching() {
        return { workArea: { height: 900, width: 1440, x: 0, y: 0 } };
      },
    },
    reset(): void {
      createdWindows.length = 0;
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

describe("createPopoutWindowManager", () => {
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
    browserWindow?.resolveLoaded();
    await showPromise;

    expect(browserWindow?.shown).toBe(true);
    expect(browserWindow?.options).toMatchObject({
      alwaysOnTop: true,
      backgroundColor: "#00000000",
      frame: false,
      hasShadow: false,
      height: 620,
      resizable: false,
      skipTaskbar: true,
      transparent: true,
      width: 480,
    });
    expect(browserWindow?.options).not.toHaveProperty("vibrancy");
    expect(browserWindow?.ignoreMouseEventsCalls).toContainEqual({
      ignore: false,
      options: undefined,
    });
    expect(browserWindow?.webContents.sentMessages).toContainEqual({
      channel: BB_DESKTOP_POPOUT_THREAD_CHANGED_CHANNEL,
      payload: { projectId: "proj_a", threadId: "thr_a" },
    });
    expect(manager.getCurrentThread()).toEqual({
      projectId: "proj_a",
      threadId: "thr_a",
    });
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
    browserWindow?.resolveLoaded();
    await showPromise;

    manager.setMouseEventsIgnored({ ignore: true });
    manager.setMouseEventsIgnored({ ignore: false });

    expect(browserWindow?.ignoreMouseEventsCalls).toEqual([
      { ignore: false, options: undefined },
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
    browserWindow?.resolveLoaded();
    await showPromise;

    manager.openInMain({ projectId: "proj_a", threadId: "thr_a" });
    await Promise.resolve();
    expect(browserWindow?.isVisible()).toBe(true);
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
    browserWindow?.resolveLoaded();
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
    electronMock.createdWindows[1]?.resolveLoaded();
    await expect(secondShowPromise).resolves.toBeUndefined();
    expect(electronMock.createdWindows).toHaveLength(2);
  });
});
