import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BrowserWindowConstructorOptions } from "electron";
import { afterEach, describe, expect, it } from "vitest";
import {
  createDesktopWindowFactory,
  type DesktopBrowserWindow,
  type DesktopBrowserWindowCreator,
  type DesktopWindowOpenHandler,
  type DesktopWindowOpenDevToolsOptions,
  type DesktopWindowWebContents,
} from "../src/desktop-window-factory.js";
import { readPersistedWindowStateEntries } from "../src/window-state.js";
import type { WindowBounds, WindowStateKey } from "../src/types.js";

interface TempDir {
  path: string;
}

interface FakeDesktopWindowArgs {
  options: BrowserWindowConstructorOptions;
}

const tempDirs: TempDir[] = [];

async function createTempDir(): Promise<TempDir> {
  const path = await mkdtemp(join(tmpdir(), "bb-desktop-window-factory-"));
  const tempDir = { path };
  tempDirs.push(tempDir);
  return tempDir;
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const tempDir = tempDirs.pop();
    if (tempDir !== undefined) {
      await rm(tempDir.path, { force: true, recursive: true });
    }
  }
});

class FakeDesktopWindowWebContents implements DesktopWindowWebContents {
  public devToolsOpenCount = 0;
  public windowOpenHandler: DesktopWindowOpenHandler | null = null;

  openDevTools(options: DesktopWindowOpenDevToolsOptions): void {
    if (options.mode === "detach") {
      this.devToolsOpenCount += 1;
    }
  }

  setWindowOpenHandler(handler: DesktopWindowOpenHandler): void {
    this.windowOpenHandler = handler;
  }
}

class FakeDesktopWindow implements DesktopBrowserWindow {
  public readonly loadedUrls: string[] = [];
  public readonly options: BrowserWindowConstructorOptions;
  public readonly webContents = new FakeDesktopWindowWebContents();
  public focused = false;
  public fullScreen = false;
  public maximized = false;
  public minimized = false;
  public shown = false;
  private destroyed = false;
  private readonly bounds: WindowBounds;
  private readonly closedListeners: Array<() => void> = [];
  private readyToShowListener: (() => void) | null = null;

  constructor(args: FakeDesktopWindowArgs) {
    this.options = args.options;
    this.bounds = {
      height: args.options.height ?? 0,
      width: args.options.width ?? 0,
      x: args.options.x ?? 0,
      y: args.options.y ?? 0,
    };
  }

  emitClosed(): void {
    this.destroyed = true;
    for (const listener of this.closedListeners) {
      listener();
    }
  }

  emitReadyToShow(): void {
    this.readyToShowListener?.();
  }

  focus(): void {
    this.focused = true;
  }

  getBounds(): WindowBounds {
    return this.bounds;
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  isFullScreen(): boolean {
    return this.fullScreen;
  }

  isMaximized(): boolean {
    return this.maximized;
  }

  isMinimized(): boolean {
    return this.minimized;
  }

  async loadURL(url: string): Promise<void> {
    this.loadedUrls.push(url);
  }

  maximize(): void {
    this.maximized = true;
  }

  on(eventName: "close" | "closed", listener: () => void): void {
    if (eventName === "closed") {
      this.closedListeners.push(listener);
    }
  }

  once(eventName: "ready-to-show", listener: () => void): void {
    if (eventName === "ready-to-show") {
      this.readyToShowListener = listener;
    }
  }

  restore(): void {
    this.minimized = false;
  }

  setFullScreen(isFullScreen: boolean): void {
    this.fullScreen = isFullScreen;
  }

  show(): void {
    this.shown = true;
  }
}

describe("desktop window factory", () => {
  it("creates distinct windows against the existing runtime URL", async () => {
    const tempDir = await createTempDir();
    const createdWindows: FakeDesktopWindow[] = [];
    const generatedStateKeys: WindowStateKey[] = ["window-second"];
    let runtimeSupervisorInvocations = 0;
    const browserWindowCreator: DesktopBrowserWindowCreator = {
      create(options) {
        const browserWindow = new FakeDesktopWindow({ options });
        createdWindows.push(browserWindow);
        return browserWindow;
      },
    };
    const factory = createDesktopWindowFactory({
      browserWindowCreator,
      createWindowStateKey() {
        return generatedStateKeys.shift() ?? "window-fallback";
      },
      displayWorkAreas: [
        {
          height: 900,
          width: 1440,
          x: 0,
          y: 0,
        },
      ],
      icon: undefined,
      isQuitting() {
        return false;
      },
      openExternalUrl() {},
      preloadPath: "/tmp/preload.cjs",
      userDataPath: tempDir.path,
    });

    runtimeSupervisorInvocations += 1;
    const firstWindow = await factory.createWindow({
      initialUrl: "http://127.0.0.1:38886",
      stateKey: null,
    });
    const secondWindow = await factory.createWindow({
      initialUrl: "http://127.0.0.1:38886",
      stateKey: null,
    });

    expect(firstWindow).not.toBe(secondWindow);
    expect(createdWindows).toHaveLength(2);
    expect(createdWindows[0]?.options.frame).toBe(false);
    expect(createdWindows[0]?.options.titleBarStyle).toBe("hiddenInset");
    expect(createdWindows[0]?.options.trafficLightPosition).toEqual({
      x: 12,
      y: 18,
    });
    expect(createdWindows[0]?.loadedUrls).toEqual(["http://127.0.0.1:38886"]);
    expect(createdWindows[1]?.loadedUrls).toEqual(["http://127.0.0.1:38886"]);
    expect(runtimeSupervisorInvocations).toBe(1);

    await factory.persistOpenWindows();
    await expect(
      readPersistedWindowStateEntries({ userDataPath: tempDir.path }),
    ).resolves.toEqual([
      {
        bounds: {
          height: 900,
          width: 1280,
          x: 80,
          y: 80,
        },
        isFullScreen: false,
        isMaximized: false,
        stateKey: "main",
      },
      {
        bounds: {
          height: 900,
          width: 1280,
          x: 80,
          y: 80,
        },
        isFullScreen: false,
        isMaximized: false,
        stateKey: "window-second",
      },
    ]);
  });

  it("allocates distinct state keys for concurrent implicit windows", async () => {
    const tempDir = await createTempDir();
    const createdWindows: FakeDesktopWindow[] = [];
    const generatedStateKeys: WindowStateKey[] = ["window-concurrent"];
    const browserWindowCreator: DesktopBrowserWindowCreator = {
      create(options) {
        const browserWindow = new FakeDesktopWindow({ options });
        createdWindows.push(browserWindow);
        return browserWindow;
      },
    };
    const factory = createDesktopWindowFactory({
      browserWindowCreator,
      createWindowStateKey() {
        return generatedStateKeys.shift() ?? "window-fallback";
      },
      displayWorkAreas: [
        {
          height: 900,
          width: 1440,
          x: 0,
          y: 0,
        },
      ],
      icon: undefined,
      isQuitting() {
        return false;
      },
      openExternalUrl() {},
      preloadPath: "/tmp/preload.cjs",
      userDataPath: tempDir.path,
    });

    const [firstWindow, secondWindow] = await Promise.all([
      factory.createWindow({
        initialUrl: "http://127.0.0.1:38886",
        stateKey: null,
      }),
      factory.createWindow({
        initialUrl: "http://127.0.0.1:38886",
        stateKey: null,
      }),
    ]);

    expect(firstWindow).not.toBe(secondWindow);
    expect(createdWindows).toHaveLength(2);

    await factory.persistOpenWindows();
    const persistedEntries = await readPersistedWindowStateEntries({
      userDataPath: tempDir.path,
    });
    const stateKeys = persistedEntries.map((entry) => entry.stateKey);

    expect(new Set(stateKeys)).toEqual(new Set(["main", "window-concurrent"]));
    expect(new Set(stateKeys).size).toBe(2);
  });
});
