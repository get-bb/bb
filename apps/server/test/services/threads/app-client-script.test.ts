import { describe, expect, it, vi } from "vitest";
import type {
  AppDataBroadcastMessage,
  AppDataListResponse,
  Bb,
} from "@bb/server-contract";
import {
  injectAppClientScript,
  type AppClientBootstrap,
} from "../../../src/services/threads/app-client-script.js";

type OpenHandler = () => void;
type CloseHandler = () => void;
type ErrorHandler = () => void;
type MessageHandler = (event: SocketMessageEvent) => void;
type FetchMock = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

interface SocketMessageEvent {
  data: string;
}

interface ScriptWindow {
  bb?: Bb;
}

interface ExecuteScriptArgs {
  fetchMock: FetchMock;
  windowObject: ScriptWindow;
}

interface DeferredResponse {
  promise: Promise<Response>;
  resolve(response: Response): void;
}

const bootstrap: AppClientBootstrap = {
  appId: "app_status",
  applicationId: "app_status",
  appSessionToken: "appsess_test",
  capabilities: ["data", "message"],
  dataUrl: "/api/v1/apps/app_status/data",
  messageUrl: "/api/v1/apps/app_status/message",
  targetThreadId: "thr_123",
  wsUrl: "ws://server/ws",
};

class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  messages: string[] = [];
  onclose: CloseHandler | null = null;
  onerror: ErrorHandler | null = null;
  onmessage: MessageHandler | null = null;
  onopen: OpenHandler | null = null;
  readyState = FakeWebSocket.CONNECTING;

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  close(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.();
  }

  emit(payload: AppDataBroadcastMessage): void {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }

  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }

  send(message: string): void {
    this.messages.push(message);
  }
}

function extractScript(html: string): string {
  const match = /<script[^>]*>([\s\S]*)<\/script>/u.exec(html);
  const script = match?.[1];
  if (!script) {
    throw new Error("Injected app client script not found");
  }
  return script;
}

function executeScript(args: ExecuteScriptArgs): void {
  FakeWebSocket.instances = [];
  const html = injectAppClientScript("<html><head></head></html>", bootstrap);
  const script = extractScript(html);
  const runScript = new Function("window", "fetch", "WebSocket", script);
  runScript(args.windowObject, args.fetchMock, FakeWebSocket);
}

function listResponse(body: AppDataListResponse): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function requireBb(windowObject: ScriptWindow): Bb {
  if (!windowObject.bb?.data) {
    throw new Error("window.bb.data was not installed");
  }
  return windowObject.bb;
}

function createDeferredResponse(): DeferredResponse {
  let resolvePromise: DeferredResponse["resolve"] = () => {};
  const promise = new Promise<Response>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve: resolvePromise,
  };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("app client script", () => {
  it("subscribes before replaying existing data for onChange", async () => {
    const fetchMock = vi.fn(async () => listResponse({ entries: [] }));
    const windowObject: ScriptWindow = {};
    executeScript({ fetchMock, windowObject });

    const bb = requireBb(windowObject);
    bb.data?.onChange("", vi.fn());
    await Promise.resolve();

    expect(fetchMock).not.toHaveBeenCalled();
    const socket = FakeWebSocket.instances[0];
    if (!socket) {
      throw new Error("Expected websocket");
    }
    socket.open();
    await flushPromises();

    expect(JSON.parse(socket.messages[0] ?? "")).toEqual({
      type: "subscribe",
      entity: "thread",
      id: "app_status:data",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/apps/app_status/data",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("does not deliver initial replay entries after onChange unsubscribe", async () => {
    const deferred = createDeferredResponse();
    const fetchMock = vi.fn(async () => deferred.promise);
    const windowObject: ScriptWindow = {};
    executeScript({ fetchMock, windowObject });

    const bb = requireBb(windowObject);
    const callback = vi.fn();
    const unsubscribe = bb.data?.onChange("", callback);
    await Promise.resolve();
    const socket = FakeWebSocket.instances[0];
    if (!socket) {
      throw new Error("Expected websocket");
    }
    socket.open();
    await flushPromises();

    unsubscribe?.();
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
    await flushPromises();

    expect(callback).not.toHaveBeenCalled();
    expect(socket.readyState).toBe(FakeWebSocket.CLOSED);
    expect(socket.messages.map((message) => JSON.parse(message))).toEqual([
      {
        type: "subscribe",
        entity: "thread",
        id: "app_status:data",
      },
      {
        type: "unsubscribe",
        entity: "thread",
        id: "app_status:data",
      },
    ]);
  });

  it("replays existing data when a resync hint arrives", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
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
      )
      .mockResolvedValueOnce(
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
      );
    const windowObject: ScriptWindow = {};
    executeScript({ fetchMock, windowObject });

    const bb = requireBb(windowObject);
    const callback = vi.fn();
    bb.data?.onChange("", callback);
    await Promise.resolve();
    const socket = FakeWebSocket.instances[0];
    if (!socket) {
      throw new Error("Expected websocket");
    }
    socket.open();
    await flushPromises();
    socket.emit({
      type: "app-data.resync",
      applicationId: "app_status",
    });
    await vi.waitFor(() => {
      expect(callback).toHaveBeenCalledTimes(2);
    });

    expect(callback).toHaveBeenCalledWith({
      path: "state.json",
      value: { count: 1 },
      deleted: false,
    });
    expect(callback).toHaveBeenCalledWith({
      path: "state.json",
      value: { count: 2 },
      deleted: false,
    });
  });
});
