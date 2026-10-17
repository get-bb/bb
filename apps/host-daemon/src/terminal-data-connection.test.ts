import { describe, expect, it, vi } from "vitest";
import type {
  CreateReconnectingWebSocket,
  ReconnectingWebSocketLike,
} from "./server-connection-support.js";
import { TerminalDataConnection } from "./terminal-data-connection.js";

function createFixture() {
  let readyState = 0;
  let bufferedAmount = 0;
  let urlProvider: (() => Promise<string>) | undefined;
  const onMessage = vi.fn();
  const socket: ReconnectingWebSocketLike = {
    get readyState() {
      return readyState;
    },
    get bufferedAmount() {
      return bufferedAmount;
    },
    onopen: null,
    onmessage: null,
    onclose: null,
    onerror: null,
    send: vi.fn(),
    close: vi.fn(() => {
      readyState = 3;
    }),
    reconnect: vi.fn(),
  };
  const createWebSocket: CreateReconnectingWebSocket = (url, _options) => {
    urlProvider = url;
    return socket;
  };
  const logger = {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  };
  const connection = new TerminalDataConnection({
    createWebSocket,
    hostKey: "host-key",
    logger,
    onMessage,
    serverHeaders: {},
    urlProvider: async (sessionId) =>
      `ws://localhost:3334/internal/ws/terminals?sessionId=${sessionId}`,
  });
  connection.connect("session-1");
  return {
    connection,
    socket,
    onMessage,
    url: () => urlProvider?.(),
    setBufferedAmount: (bytes: number) => {
      bufferedAmount = bytes;
    },
    message: (data: unknown) => {
      socket.onmessage?.({ data: JSON.stringify(data) });
    },
    open: () => {
      readyState = 1;
      socket.onopen?.({ type: "open" });
    },
    disconnect: () => {
      readyState = 3;
      socket.onclose?.({ code: 1006, reason: "dropped" });
    },
  };
}

describe("TerminalDataConnection", () => {
  it("flushes queued output before exit on its own socket", () => {
    const fixture = createFixture();
    fixture.open();
    fixture.setBufferedAmount(2 * 1024 * 1024);
    const output = {
      type: "terminal.output" as const,
      terminalId: "term-1",
      chunk: { seq: 0, dataBase64: "YQ==" },
    };
    const exited = {
      type: "terminal.exited" as const,
      terminalId: "term-1",
      exitCode: 0,
      closeReason: "user" as const,
    };
    expect(fixture.connection.sendMessage(output)).toBe(true);
    expect(fixture.socket.send).not.toHaveBeenCalled();
    expect(fixture.connection.sendMessage(exited)).toBe(true);
    expect(fixture.socket.send).toHaveBeenNthCalledWith(
      1,
      JSON.stringify(output),
    );
    expect(fixture.socket.send).toHaveBeenNthCalledWith(
      2,
      JSON.stringify(exited),
    );
    fixture.connection.close();
  });

  it("replays a pending exit after catch-up answers without replaying lost output", async () => {
    const fixture = createFixture();
    expect(new URL((await fixture.url()) ?? "").pathname).toBe(
      "/internal/ws/terminals",
    );
    fixture.open();
    fixture.disconnect();
    const output = {
      type: "terminal.output" as const,
      terminalId: "term-1",
      chunk: { seq: 0, dataBase64: "YQ==" },
    };
    const exited = {
      type: "terminal.exited" as const,
      terminalId: "term-1",
      exitCode: 1,
      closeReason: "process-exit" as const,
    };
    expect(fixture.connection.sendMessage(output)).toBe(false);
    expect(fixture.connection.sendMessage(exited)).toBe(false);
    fixture.open();
    expect(fixture.socket.send).not.toHaveBeenCalled();
    fixture.message({
      type: "terminal.attach",
      terminalId: "term-1",
      requestId: "catch-up-1",
      sinceSeq: 1,
      tailBytes: 1024,
    });
    await vi.waitFor(() => {
      expect(fixture.onMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: "terminal.attach", terminalId: "term-1" }),
      );
    });
    expect(fixture.socket.send).toHaveBeenCalledWith(JSON.stringify(exited));
    fixture.message({ type: "terminal.exited.ack", terminalId: "term-1" });
    fixture.disconnect();
    fixture.open();
    fixture.message({
      type: "terminal.attach",
      terminalId: "term-1",
      requestId: "catch-up-2",
      sinceSeq: 1,
      tailBytes: 1024,
    });
    expect(fixture.socket.send).toHaveBeenCalledTimes(1);
    fixture.connection.close();
  });
  it("reconnects when a data send fails", () => {
    const fixture = createFixture();
    fixture.open();
    vi.mocked(fixture.socket.send).mockImplementationOnce(() => {
      throw new Error("send failed");
    });
    expect(
      fixture.connection.sendMessage({
        type: "terminal.output",
        terminalId: "term-1",
        chunk: { seq: 0, dataBase64: "YQ==" },
      }),
    ).toBe(false);
    expect(fixture.socket.reconnect).toHaveBeenCalledWith(1013, "send-failed");
    fixture.connection.close();
  });
});
