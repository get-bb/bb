import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BrowserWindowConstructorOptions } from "electron";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MACOS_TRAFFIC_LIGHT_INSET_PX,
  MACOS_TRAFFIC_LIGHT_TOP_INSET_PX,
} from "@bb/desktop-contract";
import {
  createDesktopWindowFactory,
  type DesktopBrowserWindow,
  type DesktopBrowserWindowCreator,
  type DesktopWindowOpenHandler,
  type DesktopWindowOpenDevToolsOptions,
  type DesktopWindowWebContents,
} from "../src/desktop-window-factory.js";
import type { DesktopContextMenuWebContents } from "../src/desktop-context-menu.js";
import { BB_DESKTOP_ZOOM_CHANGED_CHANNEL } from "../src/desktop-update-ipc.js";
import { readPersistedWindowStateFile } from "../src/window-state.js";
import {
  MIN_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
  type WindowBounds,
  type WindowStateKey,
} from "../src/types.js";

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
  public id: number;
  public readonly addedDictionaryWords: string[] = [];
  public readonly spellCheckerEnabledValues: boolean[] = [];
  public readonly session: DesktopContextMenuWebContents["session"] = {
    addWordToSpellCheckerDictionary: (word) => {
      this.addedDictionaryWords.push(word);
      return true;
    },
    setSpellCheckerEnabled: (enabled) => {
      this.spellCheckerEnabledValues.push(enabled);
    },
  };
  public readonly contextMenuListeners: Parameters<
    DesktopContextMenuWebContents["on"]
  >[1][] = [];
  public readonly replacedMisspellings: string[] = [];
  public windowOpenHandler: DesktopWindowOpenHandler | null = null;
  public readonly zoomFactors: number[] = [];
  public readonly domReadyListeners: Array<() => void> = [];
  public readonly themeColorListeners: Array<
    (event: Event, color: string | null) => void
  > = [];
  public readonly ipcListeners = new Map<string, () => void>();
  public zoomFactor = 1;

  constructor(id: number) {
    this.id = id;
  }

  public readonly ipc = {
    on: (channel: string, listener: () => void) => {
      this.ipcListeners.set(channel, listener);
    },
  };

  openDevTools(options: DesktopWindowOpenDevToolsOptions): void {
    if (options.mode === "detach") {
      this.devToolsOpenCount += 1;
    }
  }

  on(eventName: "dom-ready", listener: () => void): void;
  on(...args: Parameters<DesktopContextMenuWebContents["on"]>): void;
  on(
    eventName: "did-change-theme-color",
    listener: (event: Event, color: string | null) => void,
  ): void;
  on(
    ...args:
      | ["dom-ready", () => void]
      | Parameters<DesktopContextMenuWebContents["on"]>
      | ["did-change-theme-color", (event: Event, color: string | null) => void]
  ): void {
    const [eventName, listener] = args;
    if (eventName === "context-menu") {
      this.contextMenuListeners.push(listener);
    } else if (eventName === "dom-ready") {
      this.domReadyListeners.push(listener);
    } else {
      this.themeColorListeners.push(listener);
    }
  }

  copyImageAt(): void {}

  downloadURL(): void {}

  replaceMisspelling(text: string): void {
    this.replacedMisspellings.push(text);
  }

  setWindowOpenHandler(handler: DesktopWindowOpenHandler): void {
    this.windowOpenHandler = handler;
  }

  getZoomFactor(): number {
    return this.zoomFactor;
  }

  setZoomFactor(factor: number): void {
    this.zoomFactor = factor;
    this.zoomFactors.push(factor);
  }
}

class FakeDesktopWindow implements DesktopBrowserWindow {
  public readonly id: number;
  public readonly loadedUrls: string[] = [];
  public readonly options: BrowserWindowConstructorOptions;
  public readonly webContents: FakeDesktopWindowWebContents;
  public backgroundColor: string;
  public windowButtonPositions: Array<{ x: number; y: number }> = [];
  public fullScreen = false;
  public maximized = false;
  public minimized = false;
  public shown = false;
  private destroyed = false;
  public bounds: WindowBounds;
  public normalBounds: WindowBounds | null = null;
  private readonly listeners = new Map<string, Array<() => void>>();
  private readonly closedListeners: Array<() => void> = [];
  private readyToShowListener: (() => void) | null = null;

  constructor(args: FakeDesktopWindowArgs) {
    this.options = args.options;
    this.backgroundColor = args.options.backgroundColor ?? "#ffffff";
    this.id = FakeDesktopWindow.nextWindowId;
    FakeDesktopWindow.nextWindowId += 1;
    this.webContents = new FakeDesktopWindowWebContents(
      FakeDesktopWindow.nextWebContentsId,
    );
    FakeDesktopWindow.nextWebContentsId += 1;
    this.bounds = {
      height: args.options.height ?? 0,
      width: args.options.width ?? 0,
      x: args.options.x ?? 0,
      y: args.options.y ?? 0,
    };
  }

  private static nextWindowId = 1;
  private static nextWebContentsId = 1;

  emit(event: string): void {
    for (const listener of this.listeners.get(event) ?? []) listener();
  }

  emitClosed(): void {
    this.emit("close");
    this.destroyed = true;
    for (const listener of this.closedListeners) {
      listener();
    }
  }

  emitReadyToShow(): void {
    this.readyToShowListener?.();
  }

  focus(): void {}

  getNormalBounds(): WindowBounds {
    return this.normalBounds ?? this.bounds;
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
    this.webContents.setZoomFactor(1);
    for (const listener of this.webContents.domReadyListeners) listener();
  }

  maximize(): void {
    this.maximized = true;
  }

  on(
    eventName:
      | "close"
      | "closed"
      | "enter-full-screen"
      | "leave-full-screen"
      | "move"
      | "resize"
      | "maximize"
      | "unmaximize",
    listener: () => void,
  ): void {
    const listeners = this.listeners.get(eventName) ?? [];
    listeners.push(listener);
    this.listeners.set(eventName, listeners);
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

  setBackgroundColor(color: string): void {
    this.backgroundColor = color;
  }

  setWindowButtonPosition(position: { x: number; y: number }): void {
    this.windowButtonPositions.push(position);
  }

  setFullScreen(isFullScreen: boolean): void {
    this.fullScreen = isFullScreen;
  }

  show(): void {
    this.shown = true;
  }
}

interface FactoryHarness {
  createdWindows: FakeDesktopWindow[];
  factory: ReturnType<typeof createDesktopWindowFactory>;
  userDataPath: string;
}

async function createFactoryHarness(
  overrides: Partial<Parameters<typeof createDesktopWindowFactory>[0]> = {},
): Promise<FactoryHarness> {
  const tempDir = await createTempDir();
  const createdWindows: FakeDesktopWindow[] = [];
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
      return "window-fallback";
    },
    displayWorkAreas: [{ height: 900, width: 1440, x: 0, y: 0 }],
    icon: undefined,
    isMac: true,
    isLinuxTransparent: false,
    isLinuxFrameless: false,
    shouldUseDarkColors() {
      return true;
    },
    isQuitting() {
      return false;
    },
    openExternalUrl() {},
    onWindowCreated() {},
    preloadPath: "/tmp/preload.cjs",
    userDataPath: tempDir.path,
    ...overrides,
  });
  return {
    createdWindows,
    factory,
    userDataPath: overrides.userDataPath ?? tempDir.path,
  };
}

describe("desktop window factory", () => {
  it("starts every saved page before any finishes and returns saved order", async () => {
    const original = await createFactoryHarness();
    for (const stateKey of ["primary", "window-second", "window-third"]) {
      const browserWindow = await original.factory.createWindow({
        initialUrl: null,
        stateKey,
      });
      if (!(browserWindow instanceof FakeDesktopWindow))
        throw new Error("Expected a fake window");
      browserWindow.bounds.x = original.createdWindows.length * 100;
    }
    await original.factory.persistOpenWindows();
    const releases: Array<() => void> = [];
    const loads = Array.from(
      { length: 3 },
      () => new Promise<void>((resolve) => releases.push(resolve)),
    );
    const started: DesktopBrowserWindow[] = [];
    const completed: DesktopBrowserWindow[] = [];
    let releaseAll = false;
    const restarted = await createFactoryHarness({
      userDataPath: original.userDataPath,
      onWindowCreated(browserWindow) {
        const load = loads[started.length];
        browserWindow.loadURL = async () => {
          started.push(browserWindow);
          if (!releaseAll) await load;
          completed.push(browserWindow);
        };
      },
    });
    const restoring = restarted.factory.restoreSavedWindows({
      initialUrl: "http://127.0.0.1:41234",
    });
    try {
      await vi.waitFor(() => expect(started).toHaveLength(3));
      expect(completed).toHaveLength(0);
      releases[2]?.();
      await vi.waitFor(() => expect(completed).toEqual([started[2]]));
      releases[1]?.();
      releases[0]?.();
      expect(
        (await restoring).map((window) => window.getNormalBounds()),
      ).toEqual(
        original.createdWindows.map((window) => window.getNormalBounds()),
      );
    } finally {
      releaseAll = true;
      for (const release of releases) release();
      await restoring;
    }
  });

  it.each([
    [0.5, 4],
    [1.5, 26],
    [2, 37],
  ])("updates macOS traffic lights at zoom %s", async (zoomFactor, y) => {
    const { createdWindows, factory } = await createFactoryHarness({
      isMac: true,
    });
    await factory.createWindow({ initialUrl: null, stateKey: null });
    const window = createdWindows[0];
    if (!window) throw new Error("Expected a window");
    window.webContents.zoomFactor = zoomFactor;
    window.webContents.ipcListeners.get(BB_DESKTOP_ZOOM_CHANGED_CHANNEL)?.();
    expect(window.windowButtonPositions).toEqual([
      { x: MACOS_TRAFFIC_LIGHT_INSET_PX, y },
    ]);
  });

  it("hands each window over before its first page loads, so the page's IPC is accepted", async () => {
    const loadedWhenCreated: string[][] = [];
    const { factory } = await createFactoryHarness({
      onWindowCreated(browserWindow) {
        if (!(browserWindow instanceof FakeDesktopWindow))
          throw new Error("Expected a fake window");
        loadedWhenCreated.push([...browserWindow.loadedUrls]);
      },
    });
    await factory.createWindow({
      initialUrl: "http://127.0.0.1:38886",
      stateKey: null,
    });
    expect(loadedWhenCreated).toEqual([[]]);
  });

  it("does not register the zoom event for non-Mac windows", async () => {
    const { createdWindows, factory } = await createFactoryHarness({
      isMac: false,
    });
    await factory.createWindow({ initialUrl: null, stateKey: null });
    const window = createdWindows[0];
    if (!window) throw new Error("Expected a window");
    expect(
      window.webContents.ipcListeners.has(BB_DESKTOP_ZOOM_CHANGED_CHANNEL),
    ).toBe(false);
  });

  it("restores the last closed window on Dock reopen and after quitting without windows", async () => {
    const { factory, createdWindows, userDataPath } =
      await createFactoryHarness();
    await factory.createWindow({ initialUrl: null, stateKey: null });
    const window = createdWindows[0]!;
    const bounds = { x: 140, y: 120, width: 1000, height: 700 };
    window.bounds = bounds;
    window.emitClosed();
    await factory.persistOpenWindows();
    await factory.createWindow({ initialUrl: null, stateKey: null });
    expect(createdWindows[1]?.getBounds()).toEqual(bounds);
    expect(
      (await readPersistedWindowStateFile({ userDataPath })).windows,
    ).toHaveLength(1);
  });

  it("saves move and resize events without quitting, including simultaneous windows", async () => {
    const { factory, createdWindows, userDataPath } =
      await createFactoryHarness();
    await factory.createWindow({ initialUrl: null, stateKey: null });
    await factory.createWindow({ initialUrl: null, stateKey: null });
    const first = createdWindows[0]!;
    const second = createdWindows[1]!;
    first.bounds = { x: 150, y: 100, width: 1000, height: 700 };
    second.bounds = { x: 250, y: 150, width: 1100, height: 750 };
    first.emit("move");
    second.emit("resize");
    await expect
      .poll(async () =>
        (await readPersistedWindowStateFile({ userDataPath })).windows.map(
          (entry) => entry.bounds,
        ),
      )
      .toEqual([first.bounds, second.bounds]);
    first.emitClosed();
    await factory.persistOpenWindows();
    expect(
      (await readPersistedWindowStateFile({ userDataPath })).windows.map(
        (entry) => entry.stateKey,
      ),
    ).toEqual(["window-fallback"]);
    second.emitClosed();
    await factory.persistOpenWindows();
    await factory.createWindow({ initialUrl: null, stateKey: null });
    expect(createdWindows[2]?.getBounds()).toEqual(second.bounds);
  });

  it.each(["maximize", "enter-full-screen"])(
    "saves normal bounds during %s so restoring and unmaximizing preserves size",
    async (event) => {
      const { factory, createdWindows } = await createFactoryHarness();
      await factory.createWindow({ initialUrl: null, stateKey: null });
      const window = createdWindows[0]!;
      window.normalBounds = { x: 130, y: 90, width: 1000, height: 700 };
      window.bounds = { x: 0, y: 0, width: 1440, height: 900 };
      window.maximized = event === "maximize";
      window.fullScreen = event === "enter-full-screen";
      await factory.persistOpenWindows();
      window.emitClosed();
      await factory.createWindow({ initialUrl: null, stateKey: null });
      expect(createdWindows[1]?.getBounds()).toEqual(window.normalBounds);
      expect(createdWindows[1]?.isMaximized()).toBe(window.maximized);
      expect(createdWindows[1]?.isFullScreen()).toBe(window.fullScreen);
    },
  );

  it("shares one zoom across windows, new windows, navigation and restart", async () => {
    const { factory, createdWindows, userDataPath } =
      await createFactoryHarness();
    await factory.createWindow({
      initialUrl: "https://one.example",
      stateKey: null,
    });
    for (let step = 0; step < 4; step++)
      factory.zoom(createdWindows[0]!.webContents.id, "in");
    await expect
      .poll(
        async () =>
          (await readPersistedWindowStateFile({ userDataPath })).zoomFactor,
      )
      .toBe(1.4);
    await factory.createWindow({
      initialUrl: "https://one.example",
      stateKey: null,
    });
    factory.zoom(createdWindows[1]!.webContents.id, "in");
    await factory.loadUrl({ url: "https://two.example" });
    expect(
      createdWindows.map((window) => window.webContents.getZoomFactor()),
    ).toEqual([1.5, 1.5]);
    await factory.persistOpenWindows();
    const restarted = await createFactoryHarness({ userDataPath });
    await restarted.factory.restoreSavedWindows({
      initialUrl: "https://one.example",
    });
    expect(
      restarted.createdWindows.map((window) =>
        window.webContents.getZoomFactor(),
      ),
    ).toEqual([1.5, 1.5]);
  });

  it("freezes saved geometry during quit teardown", async () => {
    let quitting = false;
    const { factory, createdWindows, userDataPath } =
      await createFactoryHarness({ isQuitting: () => quitting });
    await factory.createWindow({ initialUrl: null, stateKey: null });
    const window = createdWindows[0]!;
    const bounds = { x: 120, y: 100, width: 1100, height: 750 };
    window.bounds = bounds;
    window.emit("resize");
    quitting = true;
    await factory.persistOpenWindows();
    window.bounds = { x: 0, y: 0, width: 500, height: 600 };
    window.emit("unmaximize");
    window.emitClosed();
    await factory.persistOpenWindows();
    expect(
      (await readPersistedWindowStateFile({ userDataPath })).windows[0]?.bounds,
    ).toEqual(bounds);
  });

  it.each([true, false])(
    "matches each window's page color without resetting on missing metadata (dark: %s)",
    async (dark) => {
      const { createdWindows, factory } = await createFactoryHarness({
        shouldUseDarkColors: () => dark,
      });
      await factory.createWindow({ initialUrl: null, stateKey: null });
      await factory.createWindow({ initialUrl: null, stateKey: null });
      const [first, second] = createdWindows;
      if (!first || !second) throw new Error("Expected two windows");
      expect(first.backgroundColor).toBe(dark ? "#151515" : "#ffffff");
      for (const color of ["#151515", "#ffffff", "#29344a", null]) {
        for (const listener of first.webContents.themeColorListeners) {
          listener(new Event("did-change-theme-color"), color);
        }
        expect(first.backgroundColor).toBe(color ?? "#29344a");
        expect(second.backgroundColor).toBe(dark ? "#151515" : "#ffffff");
      }
    },
  );

  it("preserves transparent Linux backgrounds when the page supplies an opaque theme color", async () => {
    const { createdWindows, factory } = await createFactoryHarness({
      isMac: false,
      isLinuxTransparent: true,
    });
    await factory.createWindow({ initialUrl: null, stateKey: null });
    const window = createdWindows[0];
    if (!window) throw new Error("Expected a window");
    for (const listener of window.webContents.themeColorListeners) {
      listener(new Event("did-change-theme-color"), "#29344a");
    }
    expect(window.backgroundColor).toBe("#00000000");
  });

  it("creates distinct windows that load the same URL", async () => {
    const generatedStateKeys: WindowStateKey[] = ["window-second"];
    const { createdWindows, factory, userDataPath } =
      await createFactoryHarness({
        createWindowStateKey() {
          return generatedStateKeys.shift() ?? "window-fallback";
        },
      });

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
    expect(createdWindows[0]?.options.minHeight).toBe(MIN_WINDOW_HEIGHT);
    expect(createdWindows[0]?.options.minWidth).toBe(MIN_WINDOW_WIDTH);
    expect(createdWindows[0]?.options.titleBarStyle).toBe("hiddenInset");
    expect(createdWindows[0]?.options).not.toHaveProperty("autoHideMenuBar");
    expect(createdWindows[0]?.options.webPreferences?.spellcheck).toBe(true);
    expect(createdWindows[0]?.webContents.spellCheckerEnabledValues).toEqual([
      true,
    ]);
    expect(createdWindows[0]?.options.trafficLightPosition).toEqual({
      x: MACOS_TRAFFIC_LIGHT_INSET_PX,
      y: MACOS_TRAFFIC_LIGHT_TOP_INSET_PX,
    });
    expect(createdWindows[0]?.loadedUrls).toEqual(["http://127.0.0.1:38886"]);
    expect(createdWindows[1]?.loadedUrls).toEqual(["http://127.0.0.1:38886"]);
    expect(createdWindows[0]?.webContents.getZoomFactor()).toBe(1);
    expect(createdWindows[1]?.webContents.getZoomFactor()).toBe(1);

    await factory.persistOpenWindows();
    await expect(
      readPersistedWindowStateFile({ userDataPath }),
    ).resolves.toEqual({
      windows: [
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
      ],
      zoomFactor: 1,
    });
  });

  it("allocates distinct state keys for concurrent implicit windows", async () => {
    const generatedStateKeys: WindowStateKey[] = ["window-concurrent"];
    const { createdWindows, factory, userDataPath } =
      await createFactoryHarness({
        createWindowStateKey() {
          return generatedStateKeys.shift() ?? "window-fallback";
        },
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
    const { windows: persistedEntries } = await readPersistedWindowStateFile({
      userDataPath,
    });
    const stateKeys = persistedEntries.map((entry) => entry.stateKey);

    expect(new Set(stateKeys)).toEqual(new Set(["main", "window-concurrent"]));
    expect(new Set(stateKeys).size).toBe(2);
  });

  it("opens only policy-approved blank-target links externally and denies every popup", async () => {
    const openedExternalUrls: string[] = [];
    const { createdWindows, factory } = await createFactoryHarness({
      openExternalUrl({ url }) {
        openedExternalUrls.push(url);
      },
    });

    await factory.createWindow({
      initialUrl: "http://127.0.0.1:38886",
      stateKey: null,
    });
    const browserWindow = createdWindows[0];
    if (!browserWindow) {
      throw new Error("Expected desktop window");
    }
    const handler = browserWindow.webContents.windowOpenHandler;
    if (!handler) {
      throw new Error("Expected window open handler");
    }

    const results = [
      "https://example.com/from-markdown",
      "devin://file/Users/me/.bb/artifacts/thr_1/review.diff",
      "javascript:alert(1)",
      "file:///System/Applications/Chess.app",
      "http://127.0.0.1:38886/threads/thr_1",
    ].map((url) => handler({ url }));

    expect(createdWindows).toHaveLength(1);
    expect(openedExternalUrls).toEqual([
      "https://example.com/from-markdown",
      "http://127.0.0.1:38886/threads/thr_1",
    ]);
    expect(new Set(results.map((result) => result.action))).toEqual(
      new Set(["deny"]),
    );
  });

  it.each([
    {
      name: "keeps the native frame",
      isLinuxFrameless: false,
      isLinuxTransparent: false,
      present: { autoHideMenuBar: true },
      absent: ["frame", "titleBarStyle", "trafficLightPosition"],
    },
    {
      name: "enables transparency when requested",
      isLinuxFrameless: false,
      isLinuxTransparent: true,
      present: {
        autoHideMenuBar: true,
        transparent: true,
        backgroundColor: "#00000000",
      },
      absent: ["frame"],
    },
    {
      name: "removes the native frame when requested",
      isLinuxFrameless: true,
      isLinuxTransparent: false,
      present: { autoHideMenuBar: true, frame: false },
      absent: ["titleBarStyle", "trafficLightPosition"],
    },
  ])(
    "$name for Linux windows",
    async ({ isLinuxFrameless, isLinuxTransparent, present, absent }) => {
      const { createdWindows, factory } = await createFactoryHarness({
        isMac: false,
        isLinuxTransparent,
        isLinuxFrameless,
      });

      await factory.createWindow({ initialUrl: null, stateKey: null });

      const options = createdWindows[0]?.options;
      expect(options).toMatchObject(present);
      for (const key of absent) {
        expect(options).not.toHaveProperty(key);
      }
    },
  );
});
