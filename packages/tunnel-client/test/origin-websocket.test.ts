import { EventEmitter } from "node:events";
import type { IncomingMessage } from "node:http";
import { describe, expect, it, vi } from "vitest";
import { WebSocketServer, type WebSocket as NodeWebSocket } from "ws";
import { decodeFrame, encodeFrame, type Frame } from "@bb/tunnel-contract";
import { TunnelSession } from "../src/session.js";

class FakeTunnel extends EventEmitter {
  readonly readyState = 1;
  readonly frames: Frame[] = [];
  readonly terminate = vi.fn();

  send(data: Uint8Array): void {
    this.frames.push(decodeFrame(data));
  }
}

describe("tunnel origin websockets", () => {
  it("does not offer permessage-deflate on the loopback relay", async () => {
    const origin = new WebSocketServer({
      host: "127.0.0.1",
      port: 0,
      perMessageDeflate: true,
    });
    await new Promise<void>((resolve) => origin.once("listening", resolve));
    const address = origin.address();
    if (address === null || typeof address === "string") {
      throw new Error("expected a TCP address");
    }
    const upgrades: IncomingMessage[] = [];
    origin.on("connection", (socket, request) => {
      upgrades.push(request);
      socket.send("x".repeat(64 * 1024));
    });
    const tunnel = new FakeTunnel();
    const session = new TunnelSession({
      tunnel: tunnel as unknown as NodeWebSocket,
      log: { warn: () => {} },
      monotonicNow: () => 0,
      resolveOrigin: () => ({
        kind: "ok",
        resolved: {
          origin: `http://127.0.0.1:${address.port}`,
          publicOrigin: "https://share.example",
        },
      }),
    });
    session.start();
    try {
      tunnel.emit(
        "message",
        Buffer.from(
          encodeFrame({
            type: "open-ws",
            streamId: 1,
            path: "/ws",
            headers: [],
            protocols: [],
          }),
        ),
        true,
      );
      await vi.waitFor(() =>
        expect(tunnel.frames).toContainEqual(
          expect.objectContaining({ type: "ws-data", streamId: 1 }),
        ),
      );
      expect(upgrades).toHaveLength(1);
      expect(upgrades[0]?.headers["sec-websocket-extensions"]).toBe(undefined);
    } finally {
      session.dispose();
      for (const client of origin.clients) client.terminate();
      await new Promise<void>((resolve) => origin.close(() => resolve()));
    }
  });
});
