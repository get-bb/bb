import { describe, expect, it } from "vitest";
import { BbRealtimeClient } from "../src/realtime-client.js";
import { createHttpTransport } from "../src/transport-http.js";
import type { BbRealtimeSocket } from "../src/transport.js";

class SynchronousErrorOnCloseSocket implements BbRealtimeSocket {
  closeCalls = 0;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: BbRealtimeSocket["onmessage"] = null;
  onopen: (() => void) | null = null;
  readyState = 0;

  close(): void {
    this.closeCalls += 1;
    if (this.closeCalls > 1) {
      throw new Error("recursive close");
    }
    this.onerror?.();
    this.readyState = 3;
    this.onclose?.();
  }

  send(): void {}
}

describe("BbRealtimeClient", () => {
  it("does not recursively close when a failed Node socket errors during close", () => {
    const socket = new SynchronousErrorOnCloseSocket();
    const client = new BbRealtimeClient({
      transport: createHttpTransport({
        baseUrl: "http://bb.test",
        runtime: "node",
        websocket: () => socket,
      }),
    });
    const unsubscribe = client.subscribe({
      event: "system:changed",
      callback: () => {},
    });
    const failConnection = socket.onerror;

    expect(failConnection).not.toBeNull();
    expect(() => failConnection?.()).not.toThrow();
    expect(socket.closeCalls).toBe(1);
    expect(socket.onerror).toBeNull();

    unsubscribe();
  });
});
