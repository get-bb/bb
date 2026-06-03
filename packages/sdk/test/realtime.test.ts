import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppDataListResponse } from "@bb/server-contract";
import type { JsonValue } from "@bb/domain";
import { createBbSdk } from "../src/core.js";
import { resolveRealtimeUrl } from "../src/realtime-url.js";
import type { FetchImplementation } from "../src/response.js";
import { createHttpTransport } from "../src/transport-http.js";
import type {
  BbRealtimeSocket,
  BbRealtimeSocketFactory,
} from "../src/transport.js";

interface CapturedRequest {
  method: string;
  url: string;
}

interface FetchQueue {
  fetch: FetchImplementation;
  requests: CapturedRequest[];
}

interface DeferredResponse {
  promise: Promise<Response>;
  resolve(response: Response): void;
}

interface StateListResponseInput {
  count: number;
  modifiedAtMs: number;
  version: string;
}

class FakeWebSocket implements BbRealtimeSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 3;

  messages: string[] = [];
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onopen: ((event: Event) => void) | null = null;
  readyState = FakeWebSocket.CONNECTING;

  constructor(readonly url: string) {}

  close(): void {
    if (this.readyState === FakeWebSocket.CLOSED) {
      return;
    }
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.(new CloseEvent("close"));
  }

  emit(message: JsonValue | string): void {
    const data =
      typeof message === "string" ? message : JSON.stringify(message);
    this.onmessage?.(new MessageEvent("message", { data }));
  }

  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.(new Event("open"));
  }

  send(message: string): void {
    this.messages.push(message);
  }
}

function createWebsocketFactory(): {
  sockets: FakeWebSocket[];
  websocket: BbRealtimeSocketFactory;
} {
  const sockets: FakeWebSocket[] = [];
  return {
    sockets,
    websocket(url) {
      const socket = new FakeWebSocket(url);
      sockets.push(socket);
      return socket;
    },
  };
}

function jsonResponse(body: JsonValue): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function listResponse(body: AppDataListResponse): Response {
  return jsonResponse(body);
}

function stateListResponse(input: StateListResponseInput): Response {
  return listResponse({
    entries: [
      {
        path: "state.json",
        value: { count: input.count },
        version: input.version,
        sizeBytes: 1,
        modifiedAtMs: input.modifiedAtMs,
      },
    ],
  });
}

function createFetchQueue(responses: readonly Response[]): FetchQueue {
  const requests: CapturedRequest[] = [];
  const remaining = [...responses];
  const fetchMock: FetchImplementation = async (input, init) => {
    requests.push({
      method: init?.method ?? "GET",
      url: String(input),
    });
    const next = remaining.shift();
    if (!next) {
      throw new Error("No queued SDK realtime test response");
    }
    return next;
  };
  return { fetch: fetchMock, requests };
}

function createDeferredResponse(): DeferredResponse {
  let resolveResponse: (response: Response) => void = () => {};
  const promise = new Promise<Response>((resolve) => {
    resolveResponse = resolve;
  });
  return {
    promise,
    resolve: resolveResponse,
  };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("SDK realtime", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    Reflect.deleteProperty(globalThis, "location");
  });

  it("resolves realtime websocket URLs", () => {
    expect(
      resolveRealtimeUrl({
        transport: createHttpTransport({
          baseUrl: "http://bb.test/base",
          runtime: "node",
        }),
      }),
    ).toBe("ws://bb.test/ws");
    expect(
      resolveRealtimeUrl({
        transport: createHttpTransport({
          baseUrl: "https://bb.test",
          realtimeUrl: "wss://override.test/ws",
          runtime: "node",
        }),
      }),
    ).toBe("wss://override.test/ws");

    Object.defineProperty(globalThis, "location", {
      configurable: true,
      value: new URL("https://browser.test/app"),
    });
    expect(
      resolveRealtimeUrl({
        transport: createHttpTransport({
          runtime: "browser",
        }),
      }),
    ).toBe("wss://browser.test/ws");

    expect(() =>
      resolveRealtimeUrl({
        transport: createHttpTransport({
          runtime: "node",
        }),
      }),
    ).toThrow("baseUrl or realtimeUrl");
  });

  it("uses one socket per SDK instance and ref-counts target subscriptions", () => {
    const { sockets, websocket } = createWebsocketFactory();
    const sdk = createBbSdk({
      transport: createHttpTransport({
        baseUrl: "http://bb.test",
        runtime: "node",
        websocket,
      }),
    });
    const firstCallback = vi.fn();
    const secondCallback = vi.fn();

    const unsubscribeFirst = sdk.on({
      event: "thread:changed",
      threadId: "thr_1",
      callback: firstCallback,
    });
    const unsubscribeSecond = sdk.on({
      event: "thread:changed",
      threadId: "thr_1",
      callback: secondCallback,
    });

    expect(sockets).toHaveLength(1);
    const socket = sockets[0];
    socket.open();

    expect(socket.messages.map((message) => JSON.parse(message))).toEqual([
      { type: "subscribe", entity: "thread", id: "thr_1" },
    ]);

    socket.emit({
      type: "changed",
      entity: "thread",
      id: "thr_1",
      changes: ["events-appended"],
    });

    expect(firstCallback).toHaveBeenCalledTimes(1);
    expect(secondCallback).toHaveBeenCalledTimes(1);

    unsubscribeFirst();
    unsubscribeFirst();
    expect(socket.messages.map((message) => JSON.parse(message))).toEqual([
      { type: "subscribe", entity: "thread", id: "thr_1" },
    ]);

    unsubscribeSecond();
    unsubscribeSecond();
    expect(socket.messages.map((message) => JSON.parse(message))).toEqual([
      { type: "subscribe", entity: "thread", id: "thr_1" },
      { type: "unsubscribe", entity: "thread", id: "thr_1" },
    ]);
    expect(socket.readyState).toBe(FakeWebSocket.CLOSED);
  });

  it("reconnects and resubscribes active targets", async () => {
    vi.useFakeTimers();
    const { sockets, websocket } = createWebsocketFactory();
    const sdk = createBbSdk({
      transport: createHttpTransport({
        baseUrl: "http://bb.test",
        runtime: "node",
        websocket,
      }),
    });
    const connectionCallback = vi.fn();

    const unsubscribeConnection = sdk.on({
      event: "realtime:connection",
      callback: connectionCallback,
    });
    const unsubscribeThread = sdk.on({
      event: "thread:changed",
      callback: vi.fn(),
    });

    expect(sockets).toHaveLength(1);
    sockets[0].open();
    expect(sockets[0].messages.map((message) => JSON.parse(message))).toEqual([
      { type: "subscribe", entity: "thread" },
    ]);

    sockets[0].close();
    expect(connectionCallback).toHaveBeenCalledWith({
      state: "disconnected",
      reconnected: false,
      reconnectDelayMs: 1000,
    });

    await vi.advanceTimersByTimeAsync(1000);
    expect(sockets).toHaveLength(2);
    sockets[1].open();
    await flushPromises();

    expect(sockets[1].messages.map((message) => JSON.parse(message))).toEqual([
      { type: "subscribe", entity: "thread" },
    ]);
    expect(connectionCallback).toHaveBeenCalledWith({
      state: "connected",
      reconnected: true,
      reconnectDelayMs: null,
    });

    unsubscribeThread();
    unsubscribeConnection();
  });

  it("does not open a websocket for connection-only listeners", () => {
    const { sockets, websocket } = createWebsocketFactory();
    const sdk = createBbSdk({
      transport: createHttpTransport({
        baseUrl: "http://bb.test",
        runtime: "node",
        websocket,
      }),
    });

    const unsubscribeConnection = sdk.on({
      event: "realtime:connection",
      callback: vi.fn(),
    });

    expect(sockets).toHaveLength(0);
    unsubscribeConnection();
    expect(sockets).toHaveLength(0);
  });

  it("closes the socket and does not reconnect after the last target unsubscribes", async () => {
    vi.useFakeTimers();
    const { sockets, websocket } = createWebsocketFactory();
    const sdk = createBbSdk({
      transport: createHttpTransport({
        baseUrl: "http://bb.test",
        runtime: "node",
        websocket,
      }),
    });
    const connectionCallback = vi.fn();

    const unsubscribeConnection = sdk.on({
      event: "realtime:connection",
      callback: connectionCallback,
    });
    const unsubscribeThread = sdk.on({
      event: "thread:changed",
      callback: vi.fn(),
    });

    expect(sockets).toHaveLength(1);
    sockets[0].open();
    await flushPromises();
    unsubscribeThread();

    expect(sockets[0].messages.map((message) => JSON.parse(message))).toEqual([
      { type: "subscribe", entity: "thread" },
      { type: "unsubscribe", entity: "thread" },
    ]);
    expect(sockets[0].readyState).toBe(FakeWebSocket.CLOSED);
    expect(connectionCallback).toHaveBeenCalledWith({
      state: "disconnected",
      reconnected: false,
      reconnectDelayMs: null,
    });

    await vi.advanceTimersByTimeAsync(1000);
    expect(sockets).toHaveLength(1);

    unsubscribeConnection();
  });

  it("ignores malformed websocket messages without dropping valid listeners", () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const { sockets, websocket } = createWebsocketFactory();
    const sdk = createBbSdk({
      transport: createHttpTransport({
        baseUrl: "http://bb.test",
        runtime: "node",
        websocket,
      }),
    });
    const callback = vi.fn();

    sdk.on({ event: "app:changed", callback });
    sockets[0].open();
    sockets[0].emit("{");
    sockets[0].emit({ type: "changed", entity: "bogus", changes: [] });
    sockets[0].emit({
      type: "changed",
      entity: "app",
      changes: ["apps-changed"],
    });

    expect(consoleErrorSpy).toHaveBeenCalled();
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith({
      type: "changed",
      entity: "app",
      changes: ["apps-changed"],
    });
  });

  it("subscribes before app-data replay and dedupes buffered events by version", async () => {
    const deferred = createDeferredResponse();
    const fetchMock: FetchImplementation = vi.fn(async () => deferred.promise);
    const { sockets, websocket } = createWebsocketFactory();
    const sdk = createBbSdk({
      context: { applicationId: "status" },
      transport: createHttpTransport({
        baseUrl: "http://bb.test",
        fetch: fetchMock,
        runtime: "node",
        websocket,
      }),
    });
    const callback = vi.fn();

    sdk.on({
      event: "app-data:changed",
      prefix: "",
      callback,
    });
    await flushPromises();

    expect(fetchMock).not.toHaveBeenCalled();
    sockets[0].open();
    await flushPromises();

    expect(sockets[0].messages.map((message) => JSON.parse(message))).toEqual([
      { type: "subscribe", entity: "app", id: "status:data" },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    sockets[0].emit({
      type: "app-data.changed",
      applicationId: "status",
      path: "state.json",
      value: { count: 1 },
      deleted: false,
      version: "v1",
    });
    deferred.resolve(
      listResponse({
        entries: [
          {
            path: "state.json",
            value: { count: 1 },
            version: "v1",
            sizeBytes: 1,
            modifiedAtMs: 1,
          },
        ],
      }),
    );
    await vi.waitFor(() => expect(callback).toHaveBeenCalledTimes(1));
    expect(callback).toHaveBeenCalledWith({
      type: "app-data.changed",
      applicationId: "status",
      path: "state.json",
      value: { count: 1 },
      deleted: false,
      version: "v1",
    });
  });

  it("replays app-data after resync and reconnect", async () => {
    vi.useFakeTimers();
    const queue = createFetchQueue([
      listResponse({
        entries: [
          {
            path: "state.json",
            value: { count: 1 },
            version: "v1",
            sizeBytes: 1,
            modifiedAtMs: 1,
          },
        ],
      }),
      listResponse({
        entries: [
          {
            path: "state.json",
            value: { count: 2 },
            version: "v2",
            sizeBytes: 1,
            modifiedAtMs: 2,
          },
        ],
      }),
      listResponse({
        entries: [
          {
            path: "state.json",
            value: { count: 3 },
            version: "v3",
            sizeBytes: 1,
            modifiedAtMs: 3,
          },
        ],
      }),
    ]);
    const { sockets, websocket } = createWebsocketFactory();
    const sdk = createBbSdk({
      context: { applicationId: "status" },
      transport: createHttpTransport({
        baseUrl: "http://bb.test",
        fetch: queue.fetch,
        runtime: "node",
        websocket,
      }),
    });
    const callback = vi.fn();

    sdk.on({
      event: "app-data:changed",
      callback,
    });
    sockets[0].open();
    await vi.waitFor(() =>
      expect(callback).toHaveBeenCalledWith({
        type: "app-data.changed",
        applicationId: "status",
        path: "state.json",
        value: { count: 1 },
        deleted: false,
        version: "v1",
      }),
    );

    sockets[0].emit({
      type: "app-data.resync",
      applicationId: "status",
    });
    await vi.waitFor(() =>
      expect(callback).toHaveBeenCalledWith({
        type: "app-data.changed",
        applicationId: "status",
        path: "state.json",
        value: { count: 2 },
        deleted: false,
        version: "v2",
      }),
    );

    sockets[0].close();
    await vi.advanceTimersByTimeAsync(1000);
    sockets[1].open();
    await vi.waitFor(() =>
      expect(callback).toHaveBeenCalledWith({
        type: "app-data.changed",
        applicationId: "status",
        path: "state.json",
        value: { count: 3 },
        deleted: false,
        version: "v3",
      }),
    );
  });

  it("recovers app-data replay when the socket closes before opening", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const queue = createFetchQueue([
      stateListResponse({ count: 1, version: "v1", modifiedAtMs: 1 }),
    ]);
    const { sockets, websocket } = createWebsocketFactory();
    const sdk = createBbSdk({
      context: { applicationId: "status" },
      transport: createHttpTransport({
        baseUrl: "http://bb.test",
        fetch: queue.fetch,
        runtime: "node",
        websocket,
      }),
    });
    const callback = vi.fn();

    sdk.on({
      event: "app-data:changed",
      callback,
    });
    await flushPromises();
    expect(queue.requests).toHaveLength(0);

    sockets[0].close();
    await flushPromises();
    await vi.advanceTimersByTimeAsync(1000);
    expect(sockets).toHaveLength(2);

    sockets[1].open();
    await vi.waitFor(() =>
      expect(callback).toHaveBeenCalledWith({
        type: "app-data.changed",
        applicationId: "status",
        path: "state.json",
        value: { count: 1 },
        deleted: false,
        version: "v1",
      }),
    );
    sockets[1].emit({
      type: "app-data.changed",
      applicationId: "status",
      path: "state.json",
      value: { count: 2 },
      deleted: false,
      version: "v2",
    });

    await vi.waitFor(() =>
      expect(callback).toHaveBeenCalledWith({
        type: "app-data.changed",
        applicationId: "status",
        path: "state.json",
        value: { count: 2 },
        deleted: false,
        version: "v2",
      }),
    );
  });

  it("treats app-data resubscribe after idle close as a fresh connection", async () => {
    let listCount = 0;
    const fetchMock: FetchImplementation = vi.fn(async () => {
      listCount += 1;
      return stateListResponse({
        count: listCount,
        version: `v${listCount}`,
        modifiedAtMs: listCount,
      });
    });
    const { sockets, websocket } = createWebsocketFactory();
    const sdk = createBbSdk({
      context: { applicationId: "status" },
      transport: createHttpTransport({
        baseUrl: "http://bb.test",
        fetch: fetchMock,
        runtime: "node",
        websocket,
      }),
    });
    const callback = vi.fn();
    const connectionCallback = vi.fn();

    sdk.on({ event: "realtime:connection", callback: connectionCallback });
    const unsubscribeFirst = sdk.on({
      event: "app-data:changed",
      callback,
    });
    sockets[0].open();
    await vi.waitFor(() =>
      expect(callback).toHaveBeenCalledWith({
        type: "app-data.changed",
        applicationId: "status",
        path: "state.json",
        value: { count: 1 },
        deleted: false,
        version: "v1",
      }),
    );

    unsubscribeFirst();
    callback.mockClear();
    connectionCallback.mockClear();

    sdk.on({
      event: "app-data:changed",
      callback,
    });
    expect(sockets).toHaveLength(2);
    sockets[1].open();
    await vi.waitFor(() =>
      expect(callback).toHaveBeenCalledWith({
        type: "app-data.changed",
        applicationId: "status",
        path: "state.json",
        value: { count: 2 },
        deleted: false,
        version: "v2",
      }),
    );
    await flushPromises();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(connectionCallback).not.toHaveBeenCalledWith({
      state: "connected",
      reconnected: true,
      reconnectDelayMs: null,
    });
  });

  it("emits reconnect connection events after app-data replay completes", async () => {
    vi.useFakeTimers();
    const queue = createFetchQueue([
      stateListResponse({ count: 1, version: "v1", modifiedAtMs: 1 }),
      stateListResponse({ count: 2, version: "v2", modifiedAtMs: 2 }),
    ]);
    const { sockets, websocket } = createWebsocketFactory();
    const sdk = createBbSdk({
      context: { applicationId: "status" },
      transport: createHttpTransport({
        baseUrl: "http://bb.test",
        fetch: queue.fetch,
        runtime: "node",
        websocket,
      }),
    });
    const events: string[] = [];

    sdk.on({
      event: "realtime:connection",
      callback(event) {
        if (event.state === "connected" && event.reconnected) {
          events.push("connected:reconnected");
        }
      },
    });
    sdk.on({
      event: "app-data:changed",
      callback(event) {
        events.push(`app-data:${event.version}`);
      },
    });
    sockets[0].open();
    await vi.waitFor(() => expect(events).toContain("app-data:v1"));
    events.length = 0;

    sockets[0].close();
    await vi.advanceTimersByTimeAsync(1000);
    sockets[1].open();

    await vi.waitFor(() =>
      expect(events).toEqual(["app-data:v2", "connected:reconnected"]),
    );
  });

  it("routes bb.data.onChange through the shared SDK websocket", async () => {
    const queue = createFetchQueue([
      listResponse({
        entries: [],
      }),
    ]);
    const { sockets, websocket } = createWebsocketFactory();
    const sdk = createBbSdk({
      context: { applicationId: "status" },
      transport: createHttpTransport({
        baseUrl: "http://bb.test",
        fetch: queue.fetch,
        runtime: "node",
        websocket,
      }),
    });
    const dataCallback = vi.fn();
    const appCallback = vi.fn();

    sdk.on({ event: "app:changed", callback: appCallback });
    sdk.data.onChange({ prefix: "", callback: dataCallback });

    expect(sockets).toHaveLength(1);
    sockets[0].open();
    await flushPromises();

    expect(sockets[0].messages.map((message) => JSON.parse(message))).toEqual([
      { type: "subscribe", entity: "app" },
      { type: "subscribe", entity: "app", id: "status:data" },
    ]);

    sockets[0].emit({
      type: "changed",
      entity: "app",
      changes: ["apps-changed"],
    });
    sockets[0].emit({
      type: "app-data.changed",
      applicationId: "status",
      path: "state.json",
      value: null,
      deleted: true,
      version: null,
    });

    expect(appCallback).toHaveBeenCalledWith({
      type: "changed",
      entity: "app",
      changes: ["apps-changed"],
    });
    await vi.waitFor(() =>
      expect(dataCallback).toHaveBeenCalledWith({
        path: "state.json",
        value: undefined,
        deleted: true,
      }),
    );
  });
});
