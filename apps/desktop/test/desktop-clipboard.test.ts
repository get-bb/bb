import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerDesktopClipboardIpc } from "../src/desktop-clipboard.js";
import { BB_DESKTOP_WRITE_CLIPBOARD_CHANNEL } from "../src/desktop-window-command-ipc.js";

const mock = vi.hoisted(() => {
  type Handler = (
    event: { sender: { id: number } },
    payload: unknown,
  ) => Promise<void>;
  const handlers = new Map<string, Handler>();
  return {
    handlers,
    write: vi.fn(async (_items: unknown[]) => {}),
    writeText: vi.fn(async (_text: string) => {}),
    handle: vi.fn((channel: string, handler: Handler) => {
      handlers.set(channel, handler);
    }),
  };
});

vi.mock("electron", () => ({
  clipboard: { write: mock.write, writeText: mock.writeText },
  ClipboardItem: class {
    constructor(readonly items: Record<string, string>) {}
  },
  ipcMain: { handle: mock.handle },
}));

beforeEach(() => {
  vi.clearAllMocks();
  registerDesktopClipboardIpc(new Set([42]));
});

function request(id: number, payload: unknown): Promise<void> {
  const handler = mock.handlers.get(BB_DESKTOP_WRITE_CLIPBOARD_CHANNEL);
  if (handler === undefined) throw new Error("clipboard handler missing");
  return handler({ sender: { id } }, payload);
}

describe("desktop clipboard writes", () => {
  it("writes plain text for an application window", async () => {
    await request(42, { text: "plain" });
    expect(mock.writeText).toHaveBeenCalledWith("plain");
    expect(mock.write).not.toHaveBeenCalled();
  });

  it("writes plain and HTML representations as one clipboard item", async () => {
    await request(42, { text: "plain", html: "<b>rich</b>" });
    expect(mock.write).toHaveBeenCalledWith([
      { items: { "text/plain": "plain", "text/html": "<b>rich</b>" } },
    ]);
  });

  it("rejects writes from other web contents", async () => {
    await expect(request(99, { text: "plain" })).rejects.toThrow(
      "Clipboard writes are limited to bb windows",
    );
    expect(mock.writeText).not.toHaveBeenCalled();
  });

  it("rejects malformed content", async () => {
    await expect(request(42, { text: 1 })).rejects.toThrow();
    await expect(
      request(42, { text: "plain", image: "x" }),
    ).rejects.toThrow();
    expect(mock.writeText).not.toHaveBeenCalled();
    expect(mock.write).not.toHaveBeenCalled();
  });
});
