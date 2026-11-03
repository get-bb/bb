import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BB_DESKTOP_FOCUS_WINDOW_CHANNEL } from "../src/desktop-window-command-ipc.js";
import { registerDesktopWindowFocusIpc } from "../src/desktop-window-focus.js";

const mock = vi.hoisted(() => {
  const listeners = new Map<
    string,
    (event: { sender: { id: number } }) => void
  >();
  const window = {
    isDestroyed: vi.fn(() => false),
    isMinimized: vi.fn(() => false),
    restore: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
  };
  return {
    appFocus: vi.fn(),
    listeners,
    window,
    fromWebContents: vi.fn((_sender: { id: number }) => window),
    on: vi.fn(
      (
        channel: string,
        listener: (event: { sender: { id: number } }) => void,
      ) => {
        listeners.set(channel, listener);
      },
    ),
  };
});

vi.mock("electron", () => ({
  app: { focus: mock.appFocus },
  BrowserWindow: { fromWebContents: mock.fromWebContents },
  ipcMain: { on: mock.on },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mock.window.isDestroyed.mockReturnValue(false);
  mock.window.isMinimized.mockReturnValue(false);
  mock.fromWebContents.mockReturnValue(mock.window);
  registerDesktopWindowFocusIpc(new Set([42, 43]));
});

afterEach(() => {
  vi.restoreAllMocks();
});

function request(id: number) {
  mock.listeners.get(BB_DESKTOP_FOCUS_WINDOW_CHANNEL)?.({ sender: { id } });
}

describe("desktop notification window activation", () => {
  it.each([
    { platform: "darwin", stealsAppFocus: true },
    { platform: "linux", stealsAppFocus: false },
    { platform: "win32", stealsAppFocus: false },
  ] as const)(
    "restores and focuses the sending application window on $platform",
    ({ platform, stealsAppFocus }) => {
      vi.spyOn(process, "platform", "get").mockReturnValue(platform);
      mock.window.isMinimized.mockReturnValue(true);
      request(42);
      expect(mock.fromWebContents).toHaveBeenCalledWith({ id: 42 });
      expect(mock.window.restore).toHaveBeenCalledOnce();
      expect(mock.window.show).toHaveBeenCalledOnce();
      expect(mock.window.focus).toHaveBeenCalledOnce();
      if (stealsAppFocus)
        expect(mock.appFocus).toHaveBeenCalledWith({ steal: true });
      else expect(mock.appFocus).not.toHaveBeenCalled();
      expect(mock.window.restore.mock.invocationCallOrder[0]).toBeLessThan(
        mock.window.show.mock.invocationCallOrder[0]!,
      );
      expect(mock.window.show.mock.invocationCallOrder[0]).toBeLessThan(
        mock.window.focus.mock.invocationCallOrder[0]!,
      );
    },
  );

  it("focuses only the second sender when multiple application windows are registered", () => {
    const secondWindow = {
      isDestroyed: vi.fn(() => false),
      isMinimized: vi.fn(() => false),
      restore: vi.fn(),
      show: vi.fn(),
      focus: vi.fn(),
    };
    mock.fromWebContents.mockImplementation((sender) => {
      expect(sender).toEqual({ id: 43 });
      return secondWindow;
    });
    request(43);
    expect(secondWindow.show).toHaveBeenCalledOnce();
    expect(secondWindow.focus).toHaveBeenCalledOnce();
    expect(secondWindow.restore).not.toHaveBeenCalled();
    expect(mock.window.show).not.toHaveBeenCalled();
    expect(mock.window.focus).not.toHaveBeenCalled();
  });

  it("rejects requests from unregistered web contents", () => {
    request(99);
    expect(mock.fromWebContents).not.toHaveBeenCalled();
    expect(mock.window.focus).not.toHaveBeenCalled();
  });

  it("ignores a window destroyed before activation", () => {
    mock.window.isDestroyed.mockReturnValue(true);
    request(42);
    expect(mock.window.show).not.toHaveBeenCalled();
    expect(mock.window.focus).not.toHaveBeenCalled();
  });
});
