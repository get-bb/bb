import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface FakeWebSocketInstance {
  emit(event: "close" | "error" | "message" | "open", data?: unknown): void;
  options: WebSocketInit | undefined;
  sent: string[];
}

const fakeWebSockets: FakeWebSocketInstance[] = [];

class FakeWebSocket implements FakeWebSocketInstance {
  static readonly CLOSED = 3;
  static readonly CONNECTING = 0;
  readonly sent: string[] = [];
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onopen: (() => void) | null = null;
  readyState = FakeWebSocket.CONNECTING;

  constructor(
    readonly url: string,
    options?: WebSocketInit,
  ) {
    this.options = options;
    fakeWebSockets.push(this);
  }

  readonly options: WebSocketInit | undefined;

  close(): void {
    if (this.readyState === FakeWebSocket.CLOSED) {
      return;
    }
    this.readyState = FakeWebSocket.CLOSED;
    this.emit("close");
  }

  emit(event: "close" | "error" | "message" | "open", data?: unknown): void {
    if (event === "close") {
      this.onclose?.();
    } else if (event === "error") {
      this.onerror?.();
    } else if (event === "message") {
      this.onmessage?.({ data });
    } else {
      this.onopen?.();
    }
  }

  send(data: string): void {
    this.sent.push(data);
  }
}

beforeEach(() => {
  vi.stubGlobal("WebSocket", FakeWebSocket);
});

import { createDesktopAuthenticatedWebsocketFactory } from "../src/desktop-authenticated-websocket.js";

function deferred<T>(): {
  promise: Promise<T>;
  reject(error: Error): void;
  resolve(value: T): void;
} {
  let rejectPromise: (error: Error) => void = () => {};
  let resolvePromise: (value: T) => void = () => {};
  const promise = new Promise<T>((resolve, reject) => {
    rejectPromise = reject;
    resolvePromise = resolve;
  });
  return {
    promise,
    reject: rejectPromise,
    resolve: resolvePromise,
  };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

afterEach(() => {
  fakeWebSockets.length = 0;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("desktop authenticated WebSocket", () => {
  it("opens with headers resolved for that connection", async () => {
    const headers = deferred<Record<string, string> | undefined>();
    const resolveHeaders = vi.fn(() => headers.promise);
    const socket = createDesktopAuthenticatedWebsocketFactory({
      headers: resolveHeaders,
    })("wss://bb.test/ws");
    const onopen = vi.fn();
    const onmessage = vi.fn();
    socket.onopen = onopen;
    socket.onmessage = onmessage;

    expect(socket.readyState).toBe(0);
    expect(resolveHeaders).toHaveBeenCalledWith("wss://bb.test/ws");
    expect(fakeWebSockets).toHaveLength(0);

    headers.resolve({ Cookie: "bb_session=fresh" });
    await flushMicrotasks();

    const delegate = fakeWebSockets[0];
    expect(delegate?.options).toEqual({
      headers: { Cookie: "bb_session=fresh" },
    });
    delegate?.emit("open");
    expect(onopen).toHaveBeenCalledOnce();
    delegate?.emit("message", "thread changed");
    expect(onmessage).toHaveBeenCalledWith({ data: "thread changed" });

    socket.send("subscribe");
    expect(delegate?.sent).toEqual(["subscribe"]);
  });

  it("closes without opening while header resolution is pending", async () => {
    const headers = deferred<Record<string, string> | undefined>();
    const socket = createDesktopAuthenticatedWebsocketFactory({
      headers: () => headers.promise,
    })("wss://bb.test/ws");
    const onclose = vi.fn();
    socket.onclose = onclose;

    socket.close();
    headers.resolve({ Cookie: "bb_session=late" });
    await flushMicrotasks();

    expect(onclose).toHaveBeenCalledOnce();
    expect(socket.readyState).toBe(3);
    expect(fakeWebSockets).toHaveLength(0);
  });

  it("reports header resolution failure as an error and close", async () => {
    const headers = deferred<Record<string, string> | undefined>();
    const socket = createDesktopAuthenticatedWebsocketFactory({
      headers: () => headers.promise,
    })("wss://bb.test/ws");
    const onclose = vi.fn();
    const onerror = vi.fn(() => socket.close());
    socket.onclose = onclose;
    socket.onerror = onerror;

    headers.reject(new Error("cookie store unavailable"));
    await flushMicrotasks();

    expect(onerror).toHaveBeenCalledOnce();
    expect(onclose).toHaveBeenCalledOnce();
    expect(fakeWebSockets).toHaveLength(0);
  });
});
