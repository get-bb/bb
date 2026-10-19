import { EventEmitter } from "node:events";
import { createServer } from "node:net";
import { createServer as createHttpServer } from "node:http";
import { describe, expect, it, vi } from "vitest";
import type { WebSocket as NodeWebSocket } from "ws";
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

async function closedLoopbackPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("expected a TCP address");
  }
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}

describe("tunnel origin failures", () => {
  it.each(["http", "ws"])(
    "suppresses refused %s origins across protocols and recovers after cooldown",
    async (protocol) => {
      const port = await closedLoopbackPort();
      let now = 0;
      let hits = 0;
      const origin = createHttpServer((_req, res) => {
        hits++;
        res.end("recovered");
      });
      const tunnel = new FakeTunnel();
      const warnings: string[] = [];
      const session = new TunnelSession({
        tunnel: tunnel as unknown as NodeWebSocket,
        log: { warn: (message) => warnings.push(message) },
        monotonicNow: () => now,
        resolveOrigin: (target) =>
          target === "removed"
            ? { kind: "unregistered" }
            : {
                kind: "ok",
                resolved: {
                  origin: `http://127.0.0.1:${port}`,
                  publicOrigin: "https://share.example",
                },
              },
      });
      const send = (frame: Frame) =>
        tunnel.emit("message", Buffer.from(encodeFrame(frame)), true);
      const http = (streamId: number, target = "shared", hasBody = false) =>
        send({
          type: "open-http",
          streamId,
          target,
          method: "POST",
          path: "/poll",
          headers: [],
          hasBody,
        });
      const ws = (streamId: number) =>
        send({
          type: "open-ws",
          streamId,
          target: "shared",
          path: "/ws",
          headers: [],
          protocols: [],
        });
      session.start();
      try {
        if (protocol === "http") http(1);
        else ws(1);
        await vi.waitFor(() =>
          expect(tunnel.frames).toContainEqual(
            expect.objectContaining({ type: "close-stream", streamId: 1 }),
          ),
        );
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toContain(`http://127.0.0.1:${port}`);
        expect(warnings[0]).toContain("ECONNREFUSED");
        now = 1000;
        if (protocol === "http") ws(9);
        else http(9);
        await vi.waitFor(() =>
          expect(tunnel.frames).toContainEqual(
            expect.objectContaining({ type: "close-stream", streamId: 9 }),
          ),
        );
        expect(warnings).toHaveLength(1);
        await new Promise<void>((resolve) =>
          origin.listen(port, "127.0.0.1", resolve),
        );
        http(2);
        ws(3);
        http(4, "shared", true);
        for (const streamId of [2, 3, 4])
          expect(tunnel.frames).toContainEqual(
            expect.objectContaining({ type: "close-stream", streamId }),
          );
        expect(hits).toBe(0);
        expect(session.snapshot(0).openHttpStreams).toBe(0);
        http(5, "removed");
        await vi.waitFor(() =>
          expect(tunnel.frames).toContainEqual(
            expect.objectContaining({
              type: "resp-head",
              streamId: 5,
              status: 404,
            }),
          ),
        );
        now = 2000;
        http(6);
        http(7);
        expect(tunnel.frames).toContainEqual(
          expect.objectContaining({ type: "close-stream", streamId: 7 }),
        );
        await vi.waitFor(() =>
          expect(tunnel.frames).toContainEqual({
            type: "body-end",
            streamId: 6,
          }),
        );
        http(8);
        await vi.waitFor(() =>
          expect(tunnel.frames).toContainEqual({
            type: "body-end",
            streamId: 8,
          }),
        );
        expect(hits).toBe(2);
        expect(warnings).toHaveLength(1);
        await new Promise<void>((resolve) => origin.close(() => resolve()));
        ws(10);
        await vi.waitFor(() =>
          expect(tunnel.frames).toContainEqual(
            expect.objectContaining({ type: "close-stream", streamId: 10 }),
          ),
        );
        expect(warnings).toHaveLength(2);
      } finally {
        session.dispose();
        await new Promise<void>((resolve) => origin.close(() => resolve()));
      }
    },
  );

  it("logs the failed request without its query string", async () => {
    const port = await closedLoopbackPort();
    const tunnel = new FakeTunnel();
    const warnings: string[] = [];
    const session = new TunnelSession({
      tunnel: tunnel as unknown as NodeWebSocket,
      log: { warn: (message) => warnings.push(message) },
      resolveOrigin: () => ({
        kind: "ok",
        resolved: {
          origin: `http://127.0.0.1:${port}`,
          publicOrigin: "https://handle.getbb.app",
        },
      }),
    });
    session.start();

    tunnel.emit(
      "message",
      Buffer.from(
        encodeFrame({
          type: "open-http",
          streamId: 7,
          method: "POST",
          path: "/api/v1/plugins/demo/http/hook?token=secret-token",
          headers: [],
          hasBody: false,
        }),
      ),
      true,
    );

    await vi.waitFor(() => {
      expect(tunnel.frames).toContainEqual(
        expect.objectContaining({ type: "close-stream", streamId: 7 }),
      );
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(
      /^origin http error on POST \/api\/v1\/plugins\/demo\/http\/hook: .*ECONNREFUSED/u,
    );
    expect(warnings[0]).not.toContain("secret-token");
    session.dispose();
  });
});
