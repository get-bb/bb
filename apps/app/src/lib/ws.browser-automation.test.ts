import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clientMessageSchema, type ClientMessage } from "@bb/domain";

const fakeSocketState = vi.hoisted(() => {
  type CloseHandler = () => void;
  type MessageHandler = (event: MessageEvent) => void;
  type OpenHandler = () => void;

  class FakeReconnectingWebSocket {
    onclose: CloseHandler | null = null;
    onmessage: MessageHandler | null = null;
    onopen: OpenHandler | null = null;
    readyState = 0;
    readonly sentMessages: string[] = [];

    constructor() {
      instances.push(this);
    }

    close(): void {
      this.readyState = 3;
      this.onclose?.();
    }

    open(): void {
      this.readyState = 1;
      this.onopen?.();
    }

    receive(payload: unknown): void {
      this.onmessage?.({ data: JSON.stringify(payload) } as MessageEvent);
    }

    send(data: string): void {
      this.sentMessages.push(data);
    }
  }

  const instances: FakeReconnectingWebSocket[] = [];

  return {
    FakeReconnectingWebSocket,
    instances,
  };
});

vi.mock("partysocket/ws", () => ({
  default: fakeSocketState.FakeReconnectingWebSocket,
}));

vi.mock("./dev-websocket-url", () => ({
  buildDevWebSocketUrl: () => "ws://bb.test/ws",
}));

import { WebSocketManager } from "./ws";

function readClientMessages(): readonly ClientMessage[] {
  const socket = fakeSocketState.instances[0];
  if (!socket) {
    throw new Error("Expected websocket to be created");
  }
  return socket.sentMessages.map((message) =>
    clientMessageSchema.parse(JSON.parse(message)),
  );
}

function getOnlySocket() {
  const socket = fakeSocketState.instances[0];
  if (!socket) {
    throw new Error("Expected websocket to be created");
  }
  return socket;
}

describe("WebSocketManager browser automation channel", () => {
  const originalWebSocket = globalThis.WebSocket;

  beforeEach(() => {
    fakeSocketState.instances.length = 0;
    Object.defineProperty(globalThis, "WebSocket", {
      configurable: true,
      value: { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 },
    });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, "WebSocket", {
      configurable: true,
      value: originalWebSocket,
    });
  });

  it("advertises the capability after connecting and again on every reconnect", () => {
    const manager = new WebSocketManager();
    manager.connect();
    manager.setBrowserAutomationCapability("window-a");
    const socket = getOnlySocket();
    expect(socket.sentMessages).toEqual([]);

    socket.open();
    expect(readClientMessages()).toEqual([
      { type: "browser-automation.capability", windowId: "window-a" },
    ]);

    socket.close();
    socket.open();
    expect(readClientMessages()).toEqual([
      { type: "browser-automation.capability", windowId: "window-a" },
      { type: "browser-automation.capability", windowId: "window-a" },
    ]);
  });

  it("notifies socket loss immediately and only once per outage", () => {
    const manager = new WebSocketManager();
    const disconnected = vi.fn();
    manager.onDisconnected(disconnected);
    manager.connect();
    const socket = getOnlySocket();
    socket.open();

    socket.close();
    socket.close();
    expect(disconnected).toHaveBeenCalledOnce();
  });

  it("withdraws a capability and does not advertise it on reconnect", () => {
    const manager = new WebSocketManager();
    manager.connect();
    const socket = getOnlySocket();
    socket.open();
    manager.setBrowserAutomationCapability("window-a");
    manager.clearBrowserAutomationCapability();

    expect(readClientMessages()).toEqual([
      { type: "browser-automation.capability", windowId: "window-a" },
      { type: "browser-automation.capability-unavailable" },
    ]);

    socket.close();
    socket.open();
    expect(readClientMessages()).toHaveLength(2);
  });

  it("routes open and close messages to their listeners and drops unknown fields", () => {
    const manager = new WebSocketManager();
    manager.connect();
    const socket = getOnlySocket();
    socket.open();
    const opened = vi.fn();
    const closed = vi.fn();
    const changed = vi.fn();
    manager.onBrowserAutomationOpen(opened);
    manager.onBrowserAutomationClose(closed);
    manager.onChanged(changed);

    socket.receive({
      type: "browser-automation.open",
      requestId: "req-1",
      targetId: "bt_1",
      threadId: "thr_1",
      url: "https://example.test/",
      futureField: true,
    });
    socket.receive({ type: "browser-automation.close", targetId: "bt_1" });

    expect(opened).toHaveBeenCalledWith({
      type: "browser-automation.open",
      requestId: "req-1",
      targetId: "bt_1",
      threadId: "thr_1",
      url: "https://example.test/",
    });
    expect(closed).toHaveBeenCalledWith({
      type: "browser-automation.close",
      targetId: "bt_1",
    });
    expect(changed).not.toHaveBeenCalled();
  });

  it("sends replies only over an open socket", () => {
    const manager = new WebSocketManager();
    manager.connect();
    const socket = getOnlySocket();
    const reply = {
      type: "browser-automation.target-closed" as const,
      targetId: "bt_1",
      windowId: "window-a",
      tabId: "browser:fresh-1",
    };

    manager.sendBrowserAutomationReply(reply);
    expect(socket.sentMessages).toEqual([]);

    socket.open();
    manager.sendBrowserAutomationReply(reply);
    expect(readClientMessages()).toEqual([reply]);
  });
});
