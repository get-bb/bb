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
      { dock: { setBadge: vi.fn() }, setBadgeCount: vi.fn() },
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

function attention(pendingThreadIds: string[], unreadThreadIds: string[]) {
  return { pendingThreadIds, unreadThreadIds };
}

it.each(["darwin", "linux", "win32"] as const)(
  "counts pending threads and dots unread ones across windows, servers, navigation, crash and close on %s",
  (platform) => {
    vi.spyOn(process, "platform", "get").mockReturnValue(platform);
    const badge = () =>
      platform === "win32"
        ? mock.windows[0]!.setOverlayIcon.mock.lastCall?.[1]
        : platform === "darwin"
          ? mock.app.dock.setBadge.mock.lastCall?.[0]
          : mock.app.setBadgeCount.mock.lastCall?.[0];
    const expected = (pending: number, unread: boolean) => {
      if (platform === "linux") return pending;
      if (platform === "darwin")
        return pending > 0 ? String(pending) : unread ? "•" : "";
      if (pending === 1) return "1 thread needs your input";
      if (pending > 1) return `${pending} threads need your input`;
      return unread ? "Unread threads" : "";
    };
    report(0, attention(["a"], []));
    report(1, attention([], ["a"]));
    expect(badge()).toBe(expected(1, false));
    report(1, attention(["a"], ["b"]));
    report(2, attention(["a"], []));
    expect(badge()).toBe(expected(2, true));
    report(0, ["a", "b", "c"]);
    report(0, attention([""], []));
    report(0, attention([], []), false);
    expect(badge()).toBe(expected(2, true));
    const frame = {};
    mock.handlers.get(BB_DESKTOP_SET_ATTENTION_THREADS_CHANNEL)?.(
      { sender: { id: 99, mainFrame: frame }, senderFrame: frame },
      attention(["untrusted"], []),
    );
    expect(badge()).toBe(expected(2, true));
    mock.windows[1]!.webContents.emit(
      "did-start-navigation",
      {},
      "http://other",
      false,
      true,
    );
    report(0, attention([], ["b"]));
    expect(badge()).toBe(expected(1, true));
    mock.windows[2]!.webContents.emit("render-process-gone");
    expect(badge()).toBe(expected(0, true));
    if (platform === "win32")
      expect(mock.windows[0]!.setOverlayIcon.mock.lastCall?.[0]).not.toBeNull();
    mock.windows[0]!.webContents.emit("destroyed");
    expect(badge()).toBe(expected(0, false));
    if (platform === "win32")
      expect(mock.windows[0]!.setOverlayIcon.mock.lastCall?.[0]).toBeNull();
    report(2, attention([], ["new"]));
    expect(badge()).toBe(expected(0, true));
    report(2, attention([], []));
    expect(badge()).toBe(expected(0, false));
  },
);
