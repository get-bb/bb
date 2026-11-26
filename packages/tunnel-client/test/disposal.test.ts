import { once } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { WebSocket, WebSocketServer } from "ws";
import { encodeFrame, type Frame } from "@bb/tunnel-contract";
import { TunnelSession, type StreamOriginResult } from "../src/session.js";

describe("tunnel session disposal", () => {
  it.each(["open-http", "open-ws"] as const)(
    "ignores late %s frames while the transport is still open",
    async (type) => {
      const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
      await once(server, "listening");
      const address = server.address();
      if (address === null || typeof address === "string") {
        throw new Error("expected a TCP address");
      }
      const connected = new Promise<WebSocket>((resolve) => {
        server.once("connection", resolve);
      });
      const tunnel = new WebSocket(`ws://127.0.0.1:${address.port}`);
      await once(tunnel, "open");
      const peer = await connected;
      const resolveOrigin = vi.fn((): StreamOriginResult => ({
        kind: "unregistered",
      }));
      const onActivity = vi.fn();
      const session = new TunnelSession({
        tunnel,
        log: { warn: () => {} },
        resolveOrigin,
        onActivity,
      });
      const receive = async (frame: Frame) => {
        const received = once(tunnel, "message");
        peer.send(encodeFrame(frame));
        await received;
      };
      session.start();
      try {
        await receive({
          type: "open-http",
          streamId: 1,
          method: "POST",
          path: "/pending",
          headers: [],
          hasBody: true,
        });
        expect(session.snapshot(Date.now()).openHttpStreams).toBe(1);
        session.dispose();
        onActivity.mockClear();

        await receive(
          type === "open-http"
            ? {
                type,
                streamId: 2,
                method: "GET",
                path: "/late",
                headers: [],
                hasBody: false,
              }
            : {
                type,
                streamId: 2,
                path: "/ws",
                headers: [],
                protocols: [],
              },
        );

        expect(resolveOrigin).not.toHaveBeenCalled();
        expect(onActivity).not.toHaveBeenCalled();
        expect(session.snapshot(Date.now()).openHttpStreams).toBe(0);
      } finally {
        session.dispose();
        tunnel.terminate();
        peer.terminate();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    },
  );
});
