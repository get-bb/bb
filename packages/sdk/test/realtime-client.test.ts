import { afterEach, expect, it, vi } from "vitest";
import { createBbRealtimeClient } from "../src/realtime-client.js";
import { createHttpTransport } from "../src/transport-http.js";
import type { BbRealtimeSocket } from "../src/transport.js";

afterEach(() => vi.useRealTimers());

it("recovers when closing a failed handshake synchronously emits another error", async () => {
  vi.useFakeTimers();
  const sockets: BbRealtimeSocket[] = [];
  const client = createBbRealtimeClient({
    transport: createHttpTransport({
      baseUrl: "http://bb.test",
      runtime: "node",
      websocket: () => {
        const socket: BbRealtimeSocket = {
          readyState: 0,
          onopen: null,
          onclose: null,
          onerror: null,
          onmessage: null,
          send: vi.fn(),
          close: vi.fn(() => socket.onerror?.()),
        };
        sockets.push(socket);
        return socket;
      },
    }),
  });
  const callback = vi.fn();
  const stop = client.subscribe({ event: "system:changed", callback });
  try {
    await vi.advanceTimersByTimeAsync(0);
    const failed = sockets[0]!;
    failed.onerror?.();
    expect(failed.close).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1000);
    const recovered = sockets[1]!;
    recovered.readyState = 1;
    recovered.onopen?.();
    recovered.onmessage?.({
      data: JSON.stringify({
        type: "changed",
        entity: "system",
        changes: ["plugins-changed"],
      }),
    });
    expect(callback).toHaveBeenCalledOnce();
  } finally {
    stop();
  }
});

it("preserves subscribe event payloads while RPC watches receive structured changes", async () => {
  vi.useFakeTimers();
  const socket: BbRealtimeSocket = {
    readyState: 0,
    onopen: null,
    onclose: null,
    onerror: null,
    onmessage: null,
    send: vi.fn(),
    close: vi.fn(),
  };
  const client = createBbRealtimeClient({
    transport: createHttpTransport({
      baseUrl: "http://bb.test",
      runtime: "node",
      websocket: () => socket,
    }),
  });
  const subscribed = vi.fn();
  const changed = vi.fn();
  const threadChanged = vi.fn();
  const stop = client.subscribe({
    event: "plugin:changed",
    pluginId: "example",
    callback: subscribed,
  });
  const stopThread = client.subscribe({
    event: "thread:changed",
    threadId: "thread-1",
    callback: threadChanged,
  });
  const stopRead = client.watchPluginChanges("example", changed);
  try {
    await vi.advanceTimersByTimeAsync(0);
    socket.readyState = 1;
    socket.onopen?.();
    const change = { entity: "row", id: "a", changes: ["updated"], value: 2 };
    const thread = {
      type: "changed",
      entity: "thread",
      id: "thread-1",
      changes: ["title-changed"],
    };
    for (const message of [
      { type: "changed", entity: "plugin", pluginId: "other", change },
      { type: "changed", entity: "plugin", pluginId: "example", change },
      thread,
    ])
      socket.onmessage?.({ data: JSON.stringify(message) });
    expect(changed).toHaveBeenCalledExactlyOnceWith(change);
    expect(subscribed).toHaveBeenCalledExactlyOnceWith({
      type: "changed",
      entity: "plugin",
      pluginId: "example",
      tags: null,
    });
    expect(threadChanged).toHaveBeenCalledExactlyOnceWith(thread);
    stopRead();
    socket.onmessage?.({
      data: JSON.stringify({
        type: "changed",
        entity: "plugin",
        pluginId: "example",
        change,
      }),
    });
    expect(changed).toHaveBeenCalledOnce();
  } finally {
    stopRead();
    stopThread();
    stop();
  }
});
