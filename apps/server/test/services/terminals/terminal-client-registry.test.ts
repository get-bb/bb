import { Buffer } from "node:buffer";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TerminalClientRegistry } from "../../../src/services/terminals/terminal-client-registry.js";
import { createMockHubSocket } from "../../helpers/mock-hub-socket.js";

describe("TerminalClientRegistry", () => {
  afterEach(() => {
    vi.useRealTimers();
  });
  it("registers terminal clients and removes them when the socket disconnects", () => {
    const hub = new TerminalClientRegistry();
    const socket = createMockHubSocket();

    hub.registerTerminalClient("term-1", socket);
    hub.sendTerminalClientMessage("term-1", {
      type: "output",
      chunk: {
        seq: 0,
        dataBase64: "aGVsbG8=",
      },
    });
    hub.unregisterTerminalClientSocket(socket);
    hub.sendTerminalClientMessage("term-1", {
      type: "output",
      chunk: {
        seq: 1,
        dataBase64: "d29ybGQ=",
      },
    });

    expect(socket.messages.map((message) => JSON.parse(message))).toEqual([
      {
        type: "output",
        chunk: {
          seq: 0,
          dataBase64: "aGVsbG8=",
        },
      },
    ]);
  });

  it("gives terminal resize ownership to the latest client and restores it on detach", () => {
    const hub = new TerminalClientRegistry();
    const first = createMockHubSocket();
    const second = createMockHubSocket();

    hub.registerTerminalClient("term-1", first);
    hub.claimTerminalResizeOwnership("term-1", first);
    hub.registerTerminalClient("term-1", second);
    hub.claimTerminalResizeOwnership("term-1", second);

    expect(hub.isTerminalResizeOwner("term-1", first)).toBe(false);
    expect(hub.isTerminalResizeOwner("term-1", second)).toBe(true);

    hub.unregisterTerminalClient("term-1", second);
    expect(hub.isTerminalResizeOwner("term-1", first)).toBe(true);
  });

  it("queues terminal output while a browser socket is above high water", () => {
    vi.useFakeTimers();
    const hub = new TerminalClientRegistry();
    const socket = {
      ...createMockHubSocket(),
      raw: { bufferedAmount: 2 * 1024 * 1024 },
    };
    hub.registerTerminalClient("term-1", socket);

    hub.sendTerminalClientMessage("term-1", {
      type: "output",
      chunk: { seq: 0, dataBase64: "YQ==" },
    });
    hub.sendTerminalClientMessage("term-1", {
      type: "output",
      chunk: { seq: 1, dataBase64: "Yg==" },
    });
    expect(socket.messages).toEqual([]);

    socket.raw.bufferedAmount = 0;
    vi.advanceTimersByTime(10);
    expect(socket.messages.map((message) => JSON.parse(message))).toEqual([
      {
        type: "output",
        chunk: { seq: 0, dataBase64: "YQ==" },
      },
      {
        type: "output",
        chunk: { seq: 1, dataBase64: "Yg==" },
      },
    ]);
  });

  it("isolates a throwing terminal browser socket from healthy clients", () => {
    const hub = new TerminalClientRegistry();
    const healthy = createMockHubSocket();
    const closed: Array<{ code?: number; reason?: string }> = [];
    const failing = {
      close(code?: number, reason?: string) {
        closed.push({ code, reason });
      },
      send() {
        throw new Error("socket send failed");
      },
    };
    hub.registerTerminalClient("term-1", failing);
    hub.registerTerminalClient("term-1", healthy);

    expect(() =>
      hub.sendTerminalClientMessage("term-1", {
        type: "output",
        chunk: { seq: 0, dataBase64: "YQ==" },
      }),
    ).not.toThrow();
    hub.sendTerminalClientMessage("term-1", {
      type: "output",
      chunk: { seq: 1, dataBase64: "Yg==" },
    });

    expect(closed).toEqual([{ code: 1013, reason: "terminal-send-failed" }]);
    expect(healthy.messages.map((message) => JSON.parse(message))).toEqual([
      {
        type: "output",
        chunk: { seq: 0, dataBase64: "YQ==" },
      },
      {
        type: "output",
        chunk: { seq: 1, dataBase64: "Yg==" },
      },
    ]);
  });

  it("closes a terminal browser whose bounded output queue overflows", () => {
    vi.useFakeTimers();
    const hub = new TerminalClientRegistry();
    const socket = {
      ...createMockHubSocket(),
      raw: { bufferedAmount: 2 * 1024 * 1024 },
    };
    hub.registerTerminalClient("term-1", socket);
    const dataBase64 = Buffer.alloc(64 * 1024).toString("base64");

    for (let seq = 0; seq < 512; seq += 1) {
      hub.sendTerminalClientMessage("term-1", {
        type: "output",
        chunk: { seq, dataBase64 },
      });
    }

    expect(socket.closed).toContainEqual({
      code: 1013,
      reason: "terminal-backpressure",
    });
    expect(socket.messages).toEqual([]);
  });
});
