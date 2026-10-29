import { EventEmitter } from "node:events";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { registerDesktopAttentionIpc } from "../src/desktop-attention.js";
import { BB_DESKTOP_SET_ATTENTION_THREADS_CHANNEL } from "../src/desktop-window-command-ipc.js";

const mock = vi.hoisted(() => {
  const windows: {
    webContents: import("node:events").EventEmitter & {
      id: number;
      mainFrame: object;
      getURL: () => string;
    };
    isDestroyed: () => boolean;
    setOverlayIcon: ReturnType<typeof vi.fn>;
  }[] = [];
  return {
    app: Object.assign(
      new (class {
        handlers = new Map<string, () => void>();
        on(name: string, callback: () => void) {
          this.handlers.set(name, callback);
        }
      })(),
      { setBadgeCount: vi.fn() },
    ),
    handlers: new Map<string, (event: unknown, payload?: unknown) => void>(),
    windows,
  };
});
vi.mock("electron", () => ({
  app: mock.app,
  ipcMain: {
    on: (name: string, callback: (event: unknown, payload?: unknown) => void) =>
      mock.handlers.set(name, callback),
  },
  BrowserWindow: {
    getAllWindows: () => mock.windows,
    fromWebContents: (sender: { id: number }) =>
      mock.windows.find((window) => window.webContents.id === sender.id) ??
      null,
  },
  nativeImage: { createFromBitmap: vi.fn(() => ({ image: true })) },
}));

function makeWindow(id: number, origin = "http://localhost:3000") {
  const webContents = Object.assign(new EventEmitter(), {
    id,
    mainFrame: {},
    getURL: () => origin,
  });
  return {
    webContents,
    isDestroyed: vi.fn(() => false),
    setOverlayIcon: vi.fn(),
  };
}
function report(index: number, payload: unknown, mainFrame = true) {
  const sender = mock.windows[index]!.webContents;
  mock.handlers.get(BB_DESKTOP_SET_ATTENTION_THREADS_CHANNEL)?.(
    { sender, senderFrame: mainFrame ? sender.mainFrame : {} },
    payload,
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  mock.windows = [
    makeWindow(1),
    makeWindow(2),
    makeWindow(3, "http://other-server"),
  ];
  registerDesktopAttentionIpc(new Set([1, 2, 3]));
});
afterEach(() => {
  vi.restoreAllMocks();
});

it.each(["darwin", "linux", "win32"] as const)(
  "maintains a deduplicated badge across windows, servers, navigation and close on %s",
  (platform) => {
    vi.spyOn(process, "platform", "get").mockReturnValue(platform);
    const count = () =>
      platform === "win32"
        ? mock.windows[0]!.setOverlayIcon.mock.lastCall?.[1]
        : mock.app.setBadgeCount.mock.lastCall?.[0];
    const expected = (n: number) =>
      platform === "win32" ? (n > 0 ? `${n} threads need attention` : "") : n;
    report(0, ["a", "b"]);
    report(1, ["a"]);
    expect(count()).toBe(expected(2));
    report(2, ["a"]);
    expect(count()).toBe(expected(3));
    report(0, [-1]);
    report(0, [], false);
    expect(count()).toBe(expected(3));
    const frame = {};
    mock.handlers.get(BB_DESKTOP_SET_ATTENTION_THREADS_CHANNEL)?.(
      { sender: { id: 99, mainFrame: frame }, senderFrame: frame },
      ["untrusted"],
    );
    expect(count()).toBe(expected(3));
    mock.windows[0]!.webContents.emit(
      "did-start-navigation",
      {},
      "http://other",
      false,
      true,
    );
    expect(count()).toBe(expected(2));
    mock.windows[1]!.webContents.emit("destroyed");
    expect(count()).toBe(expected(1));
    mock.windows[2]!.webContents.emit("render-process-gone");
    expect(count()).toBe(expected(0));
    report(2, ["new"]);
    expect(count()).toBe(expected(1));
    report(2, []);
    expect(count()).toBe(expected(0));
    if (platform === "win32")
      expect(mock.windows[0]!.setOverlayIcon.mock.lastCall?.[0]).toBeNull();
  },
);
