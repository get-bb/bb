import { afterEach, describe, expect, it, vi } from "vitest";
import { statusIframeThreadTellRequestSchema } from "@bb/server-contract";
import type {
  BbThreadTell,
  BbStatusState,
  JsonValue,
  StatusDataKey,
  StatusStateBroadcastMessage,
  StatusStateChangeEvent,
  ThreadStatusDataListResponse,
} from "@bb/server-contract";
import {
  injectStatusStateClientScript,
  type StatusStateBootstrap,
} from "../../../src/services/threads/status-state-client-script.js";

interface ScriptWindow {
  bbStatusState?: BbStatusState;
  bbThreadTell?: BbThreadTell;
  crypto: {
    randomUUID(): string;
  };
}

interface CallbackCall {
  event: StatusStateChangeEvent;
  key: StatusDataKey;
  newValue: JsonValue | undefined;
  prevValue: JsonValue | undefined;
}

interface DeferredResponse {
  promise: Promise<Response>;
  resolve(response: Response): void;
}

interface FetchCall {
  init: RequestInit | undefined;
  input: string;
}

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onopen: (() => void) | null = null;
  readonly sent: string[] = [];
  readyState = FakeWebSocket.CONNECTING;

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
    queueMicrotask(() => {
      this.readyState = FakeWebSocket.OPEN;
      this.onopen?.();
    });
  }

  close(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.();
  }

  send(data: string): void {
    this.sent.push(data);
  }

  emit(data: string): void {
    this.onmessage?.({ data });
  }
}

const bootstrap: StatusStateBootstrap = {
  threadId: "thread-1",
  listUrl: "/api/v1/threads/thread-1/status-data",
  mutationUrl: "/api/v1/threads/thread-1/status-state",
  sendMessageUrl: "/api/v1/threads/thread-1/send",
  wsUrl: "ws://localhost:3334/ws",
};

function createDeferredResponse(): DeferredResponse {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

function jsonResponse(body: JsonValue): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function listResponse(body: ThreadStatusDataListResponse): Response {
  return jsonResponse(body);
}

function existingStatusState(): BbStatusState {
  return {
    async list() {
      return {};
    },
    async get() {
      return undefined;
    },
    async set() {},
    async delete() {},
    on() {
      return () => {};
    },
  };
}

function makeBroadcast(
  overrides: Partial<StatusStateBroadcastMessage> & {
    key: StatusDataKey;
  },
): StatusStateBroadcastMessage {
  return {
    type: "status-data.changed",
    threadId: "thread-1",
    key: overrides.key,
    value: overrides.value ?? null,
    deleted: overrides.deleted ?? false,
    previousValue: overrides.previousValue ?? null,
    previousValuePresent: overrides.previousValuePresent ?? false,
    version: overrides.version ?? null,
    writerClientId: overrides.writerClientId ?? null,
    operationId: overrides.operationId ?? null,
  };
}

function extractInlineScript(html: string): string {
  const match =
    /<script[^>]*data-bb-status-state-client[^>]*>([\s\S]*)<\/script>/u.exec(
      html,
    );
  if (!match) {
    throw new Error("Injected script not found");
  }
  return match[1];
}

function executeScript(args: {
  fetch: typeof fetch;
  html: string;
  window: ScriptWindow;
}): void {
  const script = extractInlineScript(args.html);
  const run = new Function(
    "window",
    "WebSocket",
    "fetch",
    "console",
    "setTimeout",
    "clearTimeout",
    script,
  );
  run(
    args.window,
    FakeWebSocket,
    args.fetch,
    console,
    setTimeout,
    clearTimeout,
  );
}

function requireBbThreadTell(windowObject: ScriptWindow): BbThreadTell {
  if (!windowObject.bbThreadTell) {
    throw new Error("bbThreadTell was not installed");
  }
  return windowObject.bbThreadTell;
}

function requireStringRequestBody(init: RequestInit | undefined): string {
  if (typeof init?.body !== "string") {
    throw new Error("Expected string request body");
  }
  return init.body;
}

describe("status state client script", () => {
  afterEach(() => {
    FakeWebSocket.instances = [];
    vi.useRealTimers();
  });

  it("injects before user scripts", () => {
    const html =
      "<html><head><script>window.userRan = true;</script></head></html>";
    const injected = injectStatusStateClientScript(html, bootstrap);

    expect(injected.indexOf("data-bb-status-state-client")).toBeLessThan(
      injected.indexOf("window.userRan"),
    );
    expect(injected).toContain("window.bbStatusState");
    expect(injected).toContain("window.bbThreadTell");
  });

  it("installs bbThreadTell and posts text to the owning thread send route", async () => {
    const calls: FetchCall[] = [];
    const fetchMock: typeof fetch = async (input, init) => {
      if (typeof input !== "string") {
        throw new Error("Expected string URL");
      }
      calls.push({ input, init });
      return jsonResponse({ ok: true });
    };
    const windowObject: ScriptWindow = {
      bbStatusState: existingStatusState(),
      crypto: { randomUUID: () => "op-from-crypto" },
    };

    executeScript({
      html: injectStatusStateClientScript(
        "<html><head></head></html>",
        bootstrap,
      ),
      window: windowObject,
      fetch: fetchMock,
    });

    await requireBbThreadTell(windowObject)("hello from iframe");

    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call.input).toBe("/api/v1/threads/thread-1/send");
    expect(call.init?.method).toBe("POST");
    expect(call.init?.credentials).toBe("same-origin");
    const headers = new Headers(call.init?.headers);
    expect(headers.get("accept")).toBe("application/json");
    expect(headers.get("content-type")).toBe("application/json");
    expect(
      statusIframeThreadTellRequestSchema.parse(
        JSON.parse(requireStringRequestBody(call.init)),
      ),
    ).toEqual({
      input: [{ type: "text", text: "hello from iframe" }],
      mode: "auto",
    });
  });

  it("throws bbThreadTell non-string input errors synchronously", () => {
    const calls: FetchCall[] = [];
    const fetchMock: typeof fetch = async (input, init) => {
      if (typeof input !== "string") {
        throw new Error("Expected string URL");
      }
      calls.push({ input, init });
      return jsonResponse({ ok: true });
    };
    const windowObject: ScriptWindow = {
      bbStatusState: existingStatusState(),
      crypto: { randomUUID: () => "op-from-crypto" },
    };

    executeScript({
      html: injectStatusStateClientScript(
        "<html><head></head></html>",
        bootstrap,
      ),
      window: windowObject,
      fetch: fetchMock,
    });

    expect(() => {
      // @ts-expect-error Runtime validation intentionally rejects bad callers.
      requireBbThreadTell(windowObject)(123);
    }).toThrow(TypeError);
    expect(calls).toHaveLength(0);
  });

  it("rejects bbThreadTell with the server 4xx message and error metadata", async () => {
    const fetchMock: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          code: "invalid_request",
          message: "Thread is archived",
          retryable: false,
        }),
        { status: 409, headers: { "content-type": "application/json" } },
      );
    const windowObject: ScriptWindow = {
      bbStatusState: existingStatusState(),
      crypto: { randomUUID: () => "op-from-crypto" },
    };

    executeScript({
      html: injectStatusStateClientScript(
        "<html><head></head></html>",
        bootstrap,
      ),
      window: windowObject,
      fetch: fetchMock,
    });

    await expect(
      requireBbThreadTell(windowObject)("ping"),
    ).rejects.toMatchObject({
      code: "invalid_request",
      message: "Thread is archived",
      retryable: false,
      status: 409,
    });
  });

  it("rejects bbThreadTell 5xx responses with a generic server error", async () => {
    const fetchMock: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          code: "internal_error",
          message: "database detail that should not leak",
        }),
        { status: 503, headers: { "content-type": "application/json" } },
      );
    const windowObject: ScriptWindow = {
      bbStatusState: existingStatusState(),
      crypto: { randomUUID: () => "op-from-crypto" },
    };

    executeScript({
      html: injectStatusStateClientScript(
        "<html><head></head></html>",
        bootstrap,
      ),
      window: windowObject,
      fetch: fetchMock,
    });

    await expect(
      requireBbThreadTell(windowObject)("ping"),
    ).rejects.toMatchObject({
      message: "bbThreadTell failed: server error (503)",
      status: 503,
    });
  });

  it("hydrates, fires immediate listeners, writes optimistically, and reconciles broadcasts", async () => {
    let operationId = "";
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (!init?.method) {
          return new Response(
            JSON.stringify({
              values: { todos: ["seed"] },
              versions: { todos: "v1" },
              hash: "list-hash",
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }

        operationId =
          new Headers(init.headers).get("x-bb-status-state-operation") ?? "";
        return new Response(
          JSON.stringify({
            key: "todos",
            value: ["next"],
            version: "v2",
            sizeBytes: 9,
            modifiedAtMs: 10,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    );
    const windowObject: ScriptWindow = {
      crypto: { randomUUID: () => "op-from-crypto" },
    };

    executeScript({
      html: injectStatusStateClientScript(
        "<html><head></head></html>",
        bootstrap,
      ),
      window: windowObject,
      fetch: fetchMock,
    });
    const state = windowObject.bbStatusState;
    if (!state) {
      throw new Error("bbStatusState was not installed");
    }

    const calls: CallbackCall[] = [];
    state.on("todos", (newValue, prevValue, key, event) => {
      calls.push({ newValue, prevValue, key, event });
    });

    const listed = await state.list();
    expect(listed.todos).toEqual(["seed"]);
    expect(calls).toEqual([
      {
        newValue: ["seed"],
        prevValue: undefined,
        key: "todos",
        event: {
          source: "remote",
          operation: "hydrate",
          optimistic: false,
          version: "v1",
          error: null,
        },
      },
    ]);

    await state.set("todos", ["next"]);
    expect(calls[1]).toEqual({
      newValue: ["next"],
      prevValue: ["seed"],
      key: "todos",
      event: {
        source: "local",
        operation: "set",
        optimistic: true,
        version: null,
        error: null,
      },
    });

    const socket = FakeWebSocket.instances[0];
    expect(socket.url).toBe("ws://localhost:3334/ws");
    expect(JSON.parse(socket.sent[0])).toEqual({
      type: "subscribe",
      entity: "thread",
      id: "thread-1:status-data",
    });
    socket.emit(
      JSON.stringify({
        type: "status-data.changed",
        threadId: "thread-1",
        key: "todos",
        value: ["next"],
        deleted: false,
        previousValue: ["seed"],
        previousValuePresent: true,
        version: "v2",
        writerClientId: "client",
        operationId,
      }),
    );
    expect(calls).toHaveLength(2);

    const immediateCalls: CallbackCall[] = [];
    state.on("todos", (newValue, prevValue, key, event) => {
      immediateCalls.push({ newValue, prevValue, key, event });
    });
    expect(immediateCalls).toEqual([
      {
        newValue: ["next"],
        prevValue: undefined,
        key: "todos",
        event: {
          source: "remote",
          operation: "hydrate",
          optimistic: false,
          version: "v2",
          error: null,
        },
      },
    ]);
  });

  it("replays broadcasts after an in-flight hydration snapshot so newer realtime values win", async () => {
    const listDeferred = createDeferredResponse();
    const fetchMock = vi.fn(async () => listDeferred.promise);
    const windowObject: ScriptWindow = {
      crypto: { randomUUID: () => "op-from-crypto" },
    };

    executeScript({
      html: injectStatusStateClientScript(
        "<html><head></head></html>",
        bootstrap,
      ),
      window: windowObject,
      fetch: fetchMock,
    });
    const state = windowObject.bbStatusState;
    if (!state) {
      throw new Error("bbStatusState was not installed");
    }
    const calls: CallbackCall[] = [];
    state.on("todos", (newValue, prevValue, key, event) => {
      calls.push({ newValue, prevValue, key, event });
    });

    await Promise.resolve();
    FakeWebSocket.instances[0].emit(
      JSON.stringify(
        makeBroadcast({
          key: "todos",
          value: ["broadcast"],
          version: "v2",
        }),
      ),
    );
    listDeferred.resolve(
      listResponse({
        values: { todos: ["stale"] },
        versions: { todos: "v1" },
        hash: "list-hash",
      }),
    );

    const listed = await state.list();
    expect(listed.todos).toEqual(["broadcast"]);
    expect(calls.map((call) => call.newValue)).toEqual([
      ["stale"],
      ["broadcast"],
    ]);
    expect(calls.at(-1)?.event).toEqual({
      source: "remote",
      operation: "set",
      optimistic: false,
      version: "v2",
      error: null,
    });
  });

  it("resyncs changed, added, and deleted keys after reconnect", async () => {
    vi.useFakeTimers();
    const snapshots: ThreadStatusDataListResponse[] = [
      {
        values: { todos: ["old"], removed: true },
        versions: { todos: "v1", removed: "remove-v1" },
        hash: "initial-hash",
      },
      {
        values: { todos: ["new"], extra: 1 },
        versions: { todos: "v2", extra: "extra-v1" },
        hash: "resync-hash",
      },
    ];
    const fetchMock = vi.fn(async () => {
      const next = snapshots.shift();
      if (!next) {
        throw new Error("Unexpected list request");
      }
      return listResponse(next);
    });
    const windowObject: ScriptWindow = {
      crypto: { randomUUID: () => "op-from-crypto" },
    };

    executeScript({
      html: injectStatusStateClientScript(
        "<html><head></head></html>",
        bootstrap,
      ),
      window: windowObject,
      fetch: fetchMock,
    });
    const state = windowObject.bbStatusState;
    if (!state) {
      throw new Error("bbStatusState was not installed");
    }
    const calls: CallbackCall[] = [];
    state.on("*", (newValue, prevValue, key, event) => {
      calls.push({ newValue, prevValue, key, event });
    });
    await state.list();

    FakeWebSocket.instances[0].close();
    await vi.advanceTimersByTimeAsync(1000);
    await Promise.resolve();
    await Promise.resolve();
    await state.list();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(await state.get("todos")).toEqual(["new"]);
    expect(await state.get("extra")).toBe(1);
    expect(await state.get("removed")).toBeUndefined();
    expect(calls.slice(2)).toEqual([
      {
        newValue: ["new"],
        prevValue: ["old"],
        key: "todos",
        event: {
          source: "remote",
          operation: "resync",
          optimistic: false,
          version: "v2",
          error: null,
        },
      },
      {
        newValue: 1,
        prevValue: undefined,
        key: "extra",
        event: {
          source: "remote",
          operation: "resync",
          optimistic: false,
          version: "extra-v1",
          error: null,
        },
      },
      {
        newValue: undefined,
        prevValue: true,
        key: "removed",
        event: {
          source: "remote",
          operation: "resync",
          optimistic: false,
          version: null,
          error: null,
        },
      },
    ]);
  });

  it("fires wildcard hydration once per existing key when registered after hydration", async () => {
    const fetchMock = vi.fn(async () =>
      listResponse({
        values: { todos: ["seed"], filters: { done: false } },
        versions: { todos: "v1", filters: "v2" },
        hash: "list-hash",
      }),
    );
    const windowObject: ScriptWindow = {
      crypto: { randomUUID: () => "op-from-crypto" },
    };

    executeScript({
      html: injectStatusStateClientScript(
        "<html><head></head></html>",
        bootstrap,
      ),
      window: windowObject,
      fetch: fetchMock,
    });
    const state = windowObject.bbStatusState;
    if (!state) {
      throw new Error("bbStatusState was not installed");
    }
    await state.list();

    const calls: CallbackCall[] = [];
    state.on("*", (newValue, prevValue, key, event) => {
      calls.push({ newValue, prevValue, key, event });
    });

    expect(calls).toEqual([
      {
        newValue: ["seed"],
        prevValue: undefined,
        key: "todos",
        event: {
          source: "remote",
          operation: "hydrate",
          optimistic: false,
          version: "v1",
          error: null,
        },
      },
      {
        newValue: { done: false },
        prevValue: undefined,
        key: "filters",
        event: {
          source: "remote",
          operation: "hydrate",
          optimistic: false,
          version: "v2",
          error: null,
        },
      },
    ]);
  });

  it("reverts optimistic set state and emits a revert event when the write fails", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (!init?.method) {
          return listResponse({
            values: { todos: ["seed"] },
            versions: { todos: "v1" },
            hash: "list-hash",
          });
        }
        return new Response("write failed", { status: 500 });
      },
    );
    const windowObject: ScriptWindow = {
      crypto: { randomUUID: () => "op-from-crypto" },
    };

    executeScript({
      html: injectStatusStateClientScript(
        "<html><head></head></html>",
        bootstrap,
      ),
      window: windowObject,
      fetch: fetchMock,
    });
    const state = windowObject.bbStatusState;
    if (!state) {
      throw new Error("bbStatusState was not installed");
    }
    const calls: CallbackCall[] = [];
    state.on("todos", (newValue, prevValue, key, event) => {
      calls.push({ newValue, prevValue, key, event });
    });
    await state.list();

    await expect(state.set("todos", ["next"])).rejects.toThrow("write failed");

    expect(await state.get("todos")).toEqual(["seed"]);
    expect(calls.slice(1)).toEqual([
      {
        newValue: ["next"],
        prevValue: ["seed"],
        key: "todos",
        event: {
          source: "local",
          operation: "set",
          optimistic: true,
          version: null,
          error: null,
        },
      },
      {
        newValue: ["seed"],
        prevValue: ["next"],
        key: "todos",
        event: {
          source: "local",
          operation: "revert",
          optimistic: false,
          version: "v1",
          error: "write failed",
        },
      },
    ]);
  });
});
