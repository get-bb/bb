import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppDataListResponse } from "@bb/server-contract";
import type { JsonValue } from "@bb/domain";
import { createBbSdk } from "../src/core.js";
import { resolveRealtimeUrl } from "../src/realtime-url.js";
import type { FetchImplementation } from "../src/response.js";
import { createHttpTransport } from "../src/transport-http.js";
import type {
  AppDataChangedRealtimeEvent,
  AppDataResyncRealtimeEvent,
  BbRealtimeConnectionEvent,
  BbRealtimeUnsubscribe,
} from "../src/realtime-types.js";
import type {
  BbRealtimeSocket,
  BbRealtimeSocketFactory,
  BbRealtimeSocketMessageEvent,
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

interface StateChangedEventInput {
  count: number;
  version: string;
}

class FakeWebSocket implements BbRealtimeSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 3;

  messages: string[] = [];
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: BbRealtimeSocketMessageEvent) => void) | null = null;
  onopen: (() => void) | null = null;
  readyState = FakeWebSocket.CONNECTING;

  constructor(readonly url: string) {}

  close(): void {
    if (this.readyState === FakeWebSocket.CLOSED) {
      return;
    }
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.();
  }

  emit(message: JsonValue | string): void {
    const data =
      typeof message === "string" ? message : JSON.stringify(message);
    this.onmessage?.({ data });
  }

  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
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

function stateChangedEvent(
  input: StateChangedEventInput,
): AppDataChangedRealtimeEvent {
  return {
    type: "app-data.changed",
    applicationId: "status",
    path: "state.json",
    value: { count: input.count },
    deleted: false,
    version: input.version,
  };
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
    // A path-prefixed baseUrl keeps its prefix, mirroring the HTTP
    // transport's `${baseUrl}/api/v1` derivation.
    expect(
      resolveRealtimeUrl({
        transport: createHttpTransport({
          baseUrl: "http://bb.test/base",
          runtime: "node",
        }),
      }),
    ).toBe("ws://bb.test/base/ws");
    expect(
      resolveRealtimeUrl({
        transport: createHttpTransport({
          baseUrl: "http://bb.test/base/",
          runtime: "node",
        }),
      }),
    ).toBe("ws://bb.test/base/ws");
    expect(
      resolveRealtimeUrl({
        transport: createHttpTransport({
          baseUrl: "http://bb.test",
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

  it("delivers app content-changed messages with the application id to app:changed listeners", () => {
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

    sockets[0].emit({
      type: "changed",
      entity: "app",
      id: "status",
      changes: ["content-changed"],
    });
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith({
      type: "changed",
      entity: "app",
      id: "status",
      changes: ["content-changed"],
    });

    // List-level apps-changed (no id) still reaches the same listener.
    sockets[0].emit({
      type: "changed",
      entity: "app",
      changes: ["apps-changed"],
    });
    expect(callback).toHaveBeenCalledTimes(2);
    expect(callback).toHaveBeenNthCalledWith(2, {
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

  it("flushes buffered app-data events after replay and skips replayed duplicates", async () => {
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

    sdk.on({ event: "app-data:changed", callback });
    sockets[0].open();
    await flushPromises();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Buffered while the replay list fetch is pending: a duplicate of the
    // version the replay will deliver, plus a genuinely new event.
    sockets[0].emit({
      type: "app-data.changed",
      applicationId: "status",
      path: "state.json",
      value: { count: 1 },
      deleted: false,
      version: "v1",
    });
    sockets[0].emit({
      type: "app-data.changed",
      applicationId: "status",
      path: "other.json",
      value: { count: 2 },
      deleted: false,
      version: "v2",
    });
    expect(callback).not.toHaveBeenCalled();

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
    await vi.waitFor(() => expect(callback).toHaveBeenCalledTimes(2));
    expect(callback).toHaveBeenNthCalledWith(
      1,
      stateChangedEvent({ count: 1, version: "v1" }),
    );
    expect(callback).toHaveBeenNthCalledWith(2, {
      type: "app-data.changed",
      applicationId: "status",
      path: "other.json",
      value: { count: 2 },
      deleted: false,
      version: "v2",
    });
    await flushPromises();
    // The buffered duplicate of the replayed version was skipped.
    expect(callback).toHaveBeenCalledTimes(2);
  });

  it("skips stale buffered app-data events when replay already delivered the final version", async () => {
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

    sdk.on({ event: "app-data:changed", callback });
    sockets[0].open();
    await flushPromises();

    sockets[0].emit(stateChangedEvent({ count: 1, version: "v1" }));
    sockets[0].emit(stateChangedEvent({ count: 2, version: "v2" }));
    deferred.resolve(
      stateListResponse({ count: 2, version: "v2", modifiedAtMs: 2 }),
    );

    await vi.waitFor(() => expect(callback).toHaveBeenCalledTimes(1));
    expect(callback).toHaveBeenCalledWith(
      stateChangedEvent({ count: 2, version: "v2" }),
    );
    await flushPromises();
    // Flushing buffered v1 after the replayed v2 would resurface stale state,
    // so every buffered event for the path is skipped.
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).not.toHaveBeenCalledWith(
      stateChangedEvent({ count: 1, version: "v1" }),
    );
  });

  it("scopes thread changed deliveries to the subscribed threadId", () => {
    const { sockets, websocket } = createWebsocketFactory();
    const sdk = createBbSdk({
      transport: createHttpTransport({
        baseUrl: "http://bb.test",
        runtime: "node",
        websocket,
      }),
    });
    const thr1Callback = vi.fn();
    const thr2Callback = vi.fn();
    const unscopedCallback = vi.fn();

    sdk.on({
      event: "thread:changed",
      threadId: "thr_1",
      callback: thr1Callback,
    });
    sdk.on({
      event: "thread:changed",
      threadId: "thr_2",
      callback: thr2Callback,
    });
    sdk.on({ event: "thread:changed", callback: unscopedCallback });
    sockets[0].open();

    sockets[0].emit({
      type: "changed",
      entity: "thread",
      id: "thr_2",
      changes: ["events-appended"],
    });
    expect(thr1Callback).not.toHaveBeenCalled();
    expect(thr2Callback).toHaveBeenCalledTimes(1);
    expect(thr2Callback).toHaveBeenCalledWith({
      type: "changed",
      entity: "thread",
      id: "thr_2",
      changes: ["events-appended"],
    });

    sockets[0].emit({
      type: "changed",
      entity: "thread",
      id: "thr_1",
      changes: ["title-changed"],
    });
    expect(thr1Callback).toHaveBeenCalledTimes(1);
    expect(thr2Callback).toHaveBeenCalledTimes(1);
    expect(unscopedCallback).toHaveBeenCalledTimes(2);
    expect(unscopedCallback).toHaveBeenNthCalledWith(1, {
      type: "changed",
      entity: "thread",
      id: "thr_2",
      changes: ["events-appended"],
    });
    expect(unscopedCallback).toHaveBeenNthCalledWith(2, {
      type: "changed",
      entity: "thread",
      id: "thr_1",
      changes: ["title-changed"],
    });
  });

  it("filters app-data changed events by prefix and replays with the prefix query", async () => {
    const queue = createFetchQueue([listResponse({ entries: [] })]);
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

    sdk.on({ event: "app-data:changed", prefix: "foo", callback });
    sockets[0].open();
    await vi.waitFor(() => expect(queue.requests).toHaveLength(1));
    expect(queue.requests[0].url).toBe(
      "http://bb.test/api/v1/apps/status/data?prefix=foo",
    );

    sockets[0].emit({
      type: "app-data.changed",
      applicationId: "status",
      path: "foo/x.json",
      value: { count: 1 },
      deleted: false,
      version: "v1",
    });
    sockets[0].emit({
      type: "app-data.changed",
      applicationId: "status",
      path: "bar/y.json",
      value: { count: 2 },
      deleted: false,
      version: "v1",
    });

    await vi.waitFor(() => expect(callback).toHaveBeenCalledTimes(1));
    expect(callback).toHaveBeenCalledWith({
      type: "app-data.changed",
      applicationId: "status",
      path: "foo/x.json",
      value: { count: 1 },
      deleted: false,
      version: "v1",
    });
    await flushPromises();
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("dispatches project, environment, host, and system changed messages", () => {
    const { sockets, websocket } = createWebsocketFactory();
    const sdk = createBbSdk({
      transport: createHttpTransport({
        baseUrl: "http://bb.test",
        runtime: "node",
        websocket,
      }),
    });
    const projectCallback = vi.fn();
    const environmentCallback = vi.fn();
    const hostCallback = vi.fn();
    const systemCallback = vi.fn();

    sdk.on({ event: "project:changed", callback: projectCallback });
    sdk.on({ event: "environment:changed", callback: environmentCallback });
    sdk.on({ event: "host:changed", callback: hostCallback });
    sdk.on({ event: "system:changed", callback: systemCallback });
    sockets[0].open();

    sockets[0].emit({
      type: "changed",
      entity: "project",
      id: "proj_1",
      changes: ["project-updated"],
    });
    sockets[0].emit({
      type: "changed",
      entity: "environment",
      id: "env_1",
      changes: ["metadata-changed"],
    });
    sockets[0].emit({
      type: "changed",
      entity: "host",
      id: "host_1",
      changes: ["host-connected"],
    });
    sockets[0].emit({
      type: "changed",
      entity: "system",
      changes: ["config-changed"],
    });

    expect(projectCallback).toHaveBeenCalledTimes(1);
    expect(projectCallback).toHaveBeenCalledWith({
      type: "changed",
      entity: "project",
      id: "proj_1",
      changes: ["project-updated"],
    });
    expect(environmentCallback).toHaveBeenCalledTimes(1);
    expect(environmentCallback).toHaveBeenCalledWith({
      type: "changed",
      entity: "environment",
      id: "env_1",
      changes: ["metadata-changed"],
    });
    expect(hostCallback).toHaveBeenCalledTimes(1);
    expect(hostCallback).toHaveBeenCalledWith({
      type: "changed",
      entity: "host",
      id: "host_1",
      changes: ["host-connected"],
    });
    expect(systemCallback).toHaveBeenCalledTimes(1);
    expect(systemCallback).toHaveBeenCalledWith({
      type: "changed",
      entity: "system",
      changes: ["config-changed"],
    });
  });

  it("routes system change kinds only to matching kind-scoped listeners", () => {
    const { sockets, websocket } = createWebsocketFactory();
    const sdk = createBbSdk({
      transport: createHttpTransport({
        baseUrl: "http://bb.test",
        runtime: "node",
        websocket,
      }),
    });
    const configCallback = vi.fn();
    const appsCallback = vi.fn();

    sdk.on({ event: "system:config-changed", callback: configCallback });
    sdk.on({ event: "system:apps-changed", callback: appsCallback });
    sockets[0].open();

    sockets[0].emit({
      type: "changed",
      entity: "system",
      changes: ["config-changed"],
    });
    expect(configCallback).toHaveBeenCalledTimes(1);
    expect(configCallback).toHaveBeenCalledWith({
      type: "changed",
      entity: "system",
      changes: ["config-changed"],
    });
    expect(appsCallback).not.toHaveBeenCalled();

    sockets[0].emit({
      type: "changed",
      entity: "system",
      changes: ["apps-changed"],
    });
    expect(configCallback).toHaveBeenCalledTimes(1);
    expect(appsCallback).toHaveBeenCalledTimes(1);
    expect(appsCallback).toHaveBeenCalledWith({
      type: "changed",
      entity: "system",
      changes: ["apps-changed"],
    });
  });

  it("delivers server-sent app-data resync messages to direct subscribers", () => {
    const { sockets, websocket } = createWebsocketFactory();
    const sdk = createBbSdk({
      context: { applicationId: "status" },
      transport: createHttpTransport({
        baseUrl: "http://bb.test",
        runtime: "node",
        websocket,
      }),
    });
    const callback = vi.fn();

    sdk.on({ event: "app-data:resync", callback });
    sockets[0].open();

    sockets[0].emit({ type: "app-data.resync", applicationId: "other" });
    expect(callback).not.toHaveBeenCalled();

    sockets[0].emit({ type: "app-data.resync", applicationId: "status" });
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith({
      type: "app-data.resync",
      applicationId: "status",
    });
  });

  it("isolates throwing listeners so later listeners still receive the event", () => {
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
    const throwingCallback = vi.fn(() => {
      throw new Error("listener boom");
    });
    const secondCallback = vi.fn();

    sdk.on({ event: "thread:changed", callback: throwingCallback });
    sdk.on({ event: "thread:changed", callback: secondCallback });
    sockets[0].open();

    sockets[0].emit({
      type: "changed",
      entity: "thread",
      id: "thr_1",
      changes: ["events-appended"],
    });

    expect(throwingCallback).toHaveBeenCalledTimes(1);
    expect(secondCallback).toHaveBeenCalledTimes(1);
    expect(secondCallback).toHaveBeenCalledWith({
      type: "changed",
      entity: "thread",
      id: "thr_1",
      changes: ["events-appended"],
    });
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "bb realtime listener failed",
      expect.any(Error),
    );
  });

  it("keeps dispatching the in-flight event when callbacks unsubscribe themselves or siblings", () => {
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
    let unsubscribeSelf: BbRealtimeUnsubscribe = () => {};
    let unsubscribeSibling: BbRealtimeUnsubscribe = () => {};
    const selfRemovingCallback = vi.fn(() => unsubscribeSelf());
    const siblingRemovingCallback = vi.fn(() => unsubscribeSibling());
    const siblingCallback = vi.fn();
    const lastCallback = vi.fn();

    unsubscribeSelf = sdk.on({
      event: "thread:changed",
      callback: selfRemovingCallback,
    });
    sdk.on({ event: "thread:changed", callback: siblingRemovingCallback });
    unsubscribeSibling = sdk.on({
      event: "thread:changed",
      callback: siblingCallback,
    });
    sdk.on({ event: "thread:changed", callback: lastCallback });
    sockets[0].open();

    sockets[0].emit({
      type: "changed",
      entity: "thread",
      id: "thr_1",
      changes: ["events-appended"],
    });
    expect(selfRemovingCallback).toHaveBeenCalledTimes(1);
    expect(siblingRemovingCallback).toHaveBeenCalledTimes(1);
    // The sibling was unsubscribed mid-dispatch, before its turn.
    expect(siblingCallback).not.toHaveBeenCalled();
    expect(lastCallback).toHaveBeenCalledTimes(1);
    expect(lastCallback).toHaveBeenCalledWith({
      type: "changed",
      entity: "thread",
      id: "thr_1",
      changes: ["events-appended"],
    });
    expect(consoleErrorSpy).not.toHaveBeenCalled();

    sockets[0].emit({
      type: "changed",
      entity: "thread",
      id: "thr_1",
      changes: ["events-appended"],
    });
    expect(selfRemovingCallback).toHaveBeenCalledTimes(1);
    expect(siblingCallback).not.toHaveBeenCalled();
    expect(lastCallback).toHaveBeenCalledTimes(2);
  });

  it("tears down the socket safely when a callback unsubscribes the last targeted listener", async () => {
    vi.useFakeTimers();
    const { sockets, websocket } = createWebsocketFactory();
    const sdk = createBbSdk({
      transport: createHttpTransport({
        baseUrl: "http://bb.test",
        runtime: "node",
        websocket,
      }),
    });
    const connectionEvents: BbRealtimeConnectionEvent[] = [];
    sdk.on({
      event: "realtime:connection",
      callback(event) {
        connectionEvents.push(event);
      },
    });
    let unsubscribe: BbRealtimeUnsubscribe = () => {};
    const callback = vi.fn(() => unsubscribe());
    unsubscribe = sdk.on({ event: "thread:changed", callback });
    sockets[0].open();

    expect(() =>
      sockets[0].emit({
        type: "changed",
        entity: "thread",
        id: "thr_1",
        changes: ["events-appended"],
      }),
    ).not.toThrow();

    expect(callback).toHaveBeenCalledTimes(1);
    expect(sockets[0].readyState).toBe(FakeWebSocket.CLOSED);
    expect(connectionEvents[connectionEvents.length - 1]).toEqual({
      state: "disconnected",
      reconnected: false,
      reconnectDelayMs: null,
    });

    await vi.advanceTimersByTimeAsync(60_000);
    expect(sockets).toHaveLength(1);
  });

  it("grows the reconnect delay, caps it, and resets it after a successful open", async () => {
    vi.useFakeTimers();
    // Closing sockets that never opened logs expected connect failures.
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { sockets, websocket } = createWebsocketFactory();
    const sdk = createBbSdk({
      transport: createHttpTransport({
        baseUrl: "http://bb.test",
        runtime: "node",
        websocket,
      }),
    });
    const reportedDelays: (number | null)[] = [];

    sdk.on({
      event: "realtime:connection",
      callback(event) {
        if (event.state === "disconnected") {
          reportedDelays.push(event.reconnectDelayMs);
        }
      },
    });
    sdk.on({ event: "thread:changed", callback: vi.fn() });

    const expectedDelays = [
      1000, 1500, 2250, 3375, 5062.5, 7593.75, 11390.625, 17085.9375,
      25628.90625, 30000, 30000,
    ];
    for (const expectedDelay of expectedDelays) {
      sockets[sockets.length - 1].close();
      expect(reportedDelays[reportedDelays.length - 1]).toBe(expectedDelay);
      await vi.advanceTimersByTimeAsync(expectedDelay);
    }
    expect(reportedDelays).toEqual(expectedDelays);
    expect(sockets).toHaveLength(expectedDelays.length + 1);

    sockets[sockets.length - 1].open();
    await flushPromises();
    sockets[sockets.length - 1].close();
    expect(reportedDelays).toEqual([...expectedDelays, 1000]);
  });

  it("preserves reconnect intent when a new listener supersedes a pending backoff timer", async () => {
    vi.useFakeTimers();
    const queue = createFetchQueue([
      stateListResponse({ count: 1, version: "v1", modifiedAtMs: 1 }),
      stateListResponse({ count: 2, version: "v2", modifiedAtMs: 2 }),
      stateListResponse({ count: 3, version: "v3", modifiedAtMs: 3 }),
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
    const connectionEvents: BbRealtimeConnectionEvent[] = [];
    const callback = vi.fn();

    sdk.on({
      event: "realtime:connection",
      callback(event) {
        connectionEvents.push(event);
      },
    });
    sdk.on({ event: "app-data:changed", callback });
    sockets[0].open();
    await vi.waitFor(() =>
      expect(callback).toHaveBeenCalledWith(
        stateChangedEvent({ count: 1, version: "v1" }),
      ),
    );

    // Unexpected close leaves a backoff timer pending; adding a listener
    // during backoff connects immediately and cancels that timer.
    sockets[0].close();
    sdk.on({ event: "thread:changed", callback: vi.fn() });
    expect(sockets).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sockets).toHaveLength(2);

    sockets[1].open();
    await vi.waitFor(() =>
      expect(callback).toHaveBeenCalledWith(
        stateChangedEvent({ count: 2, version: "v2" }),
      ),
    );

    sockets[1].close();
    await vi.advanceTimersByTimeAsync(1000);
    expect(sockets).toHaveLength(3);
    sockets[2].open();
    await vi.waitFor(() =>
      expect(callback).toHaveBeenCalledWith(
        stateChangedEvent({ count: 3, version: "v3" }),
      ),
    );

    const disconnects = connectionEvents.filter(
      (event) => event.state === "disconnected",
    );
    expect(disconnects).toEqual([
      { state: "disconnected", reconnected: false, reconnectDelayMs: 1000 },
      { state: "disconnected", reconnected: false, reconnectDelayMs: 1000 },
    ]);
  });

  it("fires app-data resync before the reconnected connection event", async () => {
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
    const resyncCallback = vi.fn((event: AppDataResyncRealtimeEvent) => {
      events.push(`resync:${event.applicationId}`);
    });

    sdk.on({ event: "app-data:resync", callback: resyncCallback });
    sdk.on({ event: "app-data:changed", callback: vi.fn() });
    sdk.on({
      event: "realtime:connection",
      callback(event) {
        if (event.state === "connected" && event.reconnected) {
          events.push("connected:reconnected");
        }
      },
    });
    sockets[0].open();
    await vi.waitFor(() => expect(queue.requests).toHaveLength(1));
    expect(resyncCallback).not.toHaveBeenCalled();

    sockets[0].close();
    await vi.advanceTimersByTimeAsync(1000);
    sockets[1].open();
    await vi.waitFor(() => expect(events).toContain("connected:reconnected"));

    expect(events).toEqual(["resync:status", "connected:reconnected"]);
    expect(resyncCallback).toHaveBeenCalledWith({
      type: "app-data.resync",
      applicationId: "status",
    });
  });

  it("delivers the current connection state to late connection observers", async () => {
    const { sockets, websocket } = createWebsocketFactory();
    const sdk = createBbSdk({
      transport: createHttpTransport({
        baseUrl: "http://bb.test",
        runtime: "node",
        websocket,
      }),
    });

    sdk.on({ event: "thread:changed", callback: vi.fn() });
    sockets[0].open();

    const observerCallback = vi.fn();
    sdk.on({ event: "realtime:connection", callback: observerCallback });
    expect(observerCallback).not.toHaveBeenCalled();

    await flushPromises();
    expect(observerCallback).toHaveBeenCalledTimes(1);
    expect(observerCallback).toHaveBeenCalledWith({
      state: "connected",
      reconnected: false,
      reconnectDelayMs: null,
    });
  });

  it("cancels the pending reconnect when the last targeted listener unsubscribes during backoff", async () => {
    vi.useFakeTimers();
    const { sockets, websocket } = createWebsocketFactory();
    const sdk = createBbSdk({
      transport: createHttpTransport({
        baseUrl: "http://bb.test",
        runtime: "node",
        websocket,
      }),
    });
    const connectionEvents: BbRealtimeConnectionEvent[] = [];

    sdk.on({
      event: "realtime:connection",
      callback(event) {
        connectionEvents.push(event);
      },
    });
    const unsubscribeThread = sdk.on({
      event: "thread:changed",
      callback: vi.fn(),
    });
    sockets[0].open();
    sockets[0].close();

    unsubscribeThread();

    const disconnects = connectionEvents.filter(
      (event) => event.state === "disconnected",
    );
    expect(disconnects).toEqual([
      { state: "disconnected", reconnected: false, reconnectDelayMs: 1000 },
      { state: "disconnected", reconnected: false, reconnectDelayMs: null },
    ]);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(sockets).toHaveLength(1);
  });

  it("stops app-data replay deliveries after the callback unsubscribes", async () => {
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
    let unsubscribe: BbRealtimeUnsubscribe = () => {};
    const callback = vi.fn(() => unsubscribe());

    unsubscribe = sdk.on({ event: "app-data:changed", callback });
    sockets[0].open();
    await flushPromises();

    deferred.resolve(
      listResponse({
        entries: [
          { path: "a.json", value: 1, version: "va", sizeBytes: 1, modifiedAtMs: 1 },
          { path: "b.json", value: 2, version: "vb", sizeBytes: 1, modifiedAtMs: 2 },
          { path: "c.json", value: 3, version: "vc", sizeBytes: 1, modifiedAtMs: 3 },
        ],
      }),
    );
    await vi.waitFor(() => expect(callback).toHaveBeenCalledTimes(1));
    await flushPromises();

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith({
      type: "app-data.changed",
      applicationId: "status",
      path: "a.json",
      value: 1,
      deleted: false,
      version: "va",
    });
    expect(sockets[0].readyState).toBe(FakeWebSocket.CLOSED);
  });

  it("leniently parses inbound messages by stripping unknown kinds and fields", () => {
    const { sockets, websocket } = createWebsocketFactory();
    const sdk = createBbSdk({
      transport: createHttpTransport({
        baseUrl: "http://bb.test",
        runtime: "node",
        websocket,
      }),
    });
    const callback = vi.fn();

    sdk.on({ event: "thread:changed", callback });
    sockets[0].open();

    sockets[0].emit({
      type: "changed",
      entity: "thread",
      id: "thr_1",
      changes: ["events-appended", "kind-from-a-newer-server"],
    });
    expect(callback).toHaveBeenNthCalledWith(1, {
      type: "changed",
      entity: "thread",
      id: "thr_1",
      changes: ["events-appended"],
    });

    sockets[0].emit({
      type: "changed",
      entity: "thread",
      id: "thr_2",
      changes: ["events-appended"],
      fieldFromANewerServer: true,
    });
    expect(callback).toHaveBeenNthCalledWith(2, {
      type: "changed",
      entity: "thread",
      id: "thr_2",
      changes: ["events-appended"],
    });
    expect(callback).toHaveBeenCalledTimes(2);
  });
});
