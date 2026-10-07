import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WebSocket as NodeWebSocket } from "ws";
import {
  HEARTBEAT_REQUEST,
  HEARTBEAT_RESPONSE,
  encodeFrame,
} from "@bb/tunnel-contract";
import { TunnelSession } from "../src/session.js";

class FakeTunnel extends EventEmitter {
  readonly readyState = 1;
  bufferedAmount = 0;
  send(): void {}
  terminate(): void {}
}

describe("tunnel traffic snapshot", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reports in-flight streams, bytes each way, and how long each direction has been quiet", () => {
    const tunnel = new FakeTunnel();
    const session = new TunnelSession({
      tunnel: tunnel as unknown as NodeWebSocket,
      log: { warn: () => {} },
      resolveOrigin: () => ({ kind: "unregistered" }),
    });
    session.start();
    expect(session.snapshot(Date.now())).toEqual({
      openHttpStreams: 0,
      openWsStreams: 0,
      bytesReceived: 0,
      bytesSent: 0,
      lastReceivedAgeMs: null,
      lastSentAgeMs: null,
      bufferedBytes: 0,
    });

    const openFrame = Buffer.from(
      encodeFrame({
        type: "open-http",
        streamId: 3,
        method: "POST",
        path: "/api/v1/threads",
        headers: [],
        hasBody: true,
      }),
    );
    tunnel.emit("message", openFrame, true);
    vi.advanceTimersByTime(20_000);
    tunnel.emit("message", Buffer.from(HEARTBEAT_RESPONSE), false);
    vi.advanceTimersByTime(5_000);
    tunnel.bufferedAmount = 4096;

    expect(session.snapshot(Date.now())).toEqual({
      openHttpStreams: 1,
      openWsStreams: 0,
      bytesReceived: openFrame.byteLength + HEARTBEAT_RESPONSE.length,
      bytesSent: HEARTBEAT_REQUEST.length,
      lastReceivedAgeMs: 5_000,
      lastSentAgeMs: 5_000,
      bufferedBytes: 4096,
    });
    session.dispose();
  });
});
