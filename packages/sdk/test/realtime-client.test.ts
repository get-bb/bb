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
