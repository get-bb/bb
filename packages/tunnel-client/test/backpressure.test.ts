import { EventEmitter } from "node:events";
import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WebSocket as NodeWebSocket } from "ws";
import { decodeFrame, encodeFrame, type Frame } from "@bb/tunnel-contract";
import { TunnelSession } from "../src/session.js";

const CHUNK_BYTES = 64 * 1024;
const CHUNK_COUNT = 48;

class FakeTunnel extends EventEmitter {
  readonly readyState = 1;
  readonly frames: Frame[] = [];
  readonly terminate = vi.fn();
  bufferedAmount = 0;

  send(data: Uint8Array): void {
    this.frames.push(decodeFrame(data));
  }

  bodyBytes(): number {
    let total = 0;
    for (const frame of this.frames) {
      if (frame.type === "body-chunk") total += frame.data.length;
    }
    return total;
  }
}

let origin: Server | undefined;

afterEach(async () => {
  const server = origin;
  origin = undefined;
  if (server !== undefined) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

async function startOrigin(): Promise<number> {
  origin = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/octet-stream" });
    let written = 0;
    const writeNext = () => {
      if (written === CHUNK_COUNT) {
        response.end();
        return;
      }
      written += 1;
      if (response.write(Buffer.alloc(CHUNK_BYTES, 1))) {
        setImmediate(writeNext);
      } else {
        response.once("drain", writeNext);
      }
    };
    writeNext();
  });
  const server = origin;
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("expected a TCP address");
  }
  return address.port;
}

function openDownload(tunnel: FakeTunnel, port: number): TunnelSession {
  const session = new TunnelSession({
    tunnel: tunnel as unknown as NodeWebSocket,
    log: { warn: () => {} },
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
        streamId: 3,
        method: "GET",
        path: "/big",
        headers: [],
        hasBody: false,
      }),
    ),
    true,
  );
  return session;
}

describe("tunnel response backpressure", () => {
  it("stops reading the origin while the tunnel send buffer is backed up, then finishes", async () => {
    const port = await startOrigin();
    const tunnel = new FakeTunnel();
    tunnel.bufferedAmount = 8 * 1024 * 1024;
    const session = openDownload(tunnel, port);

    await vi.waitFor(() => {
      expect(tunnel.bodyBytes()).toBeGreaterThan(0);
    });
    await new Promise((resolve) => setTimeout(resolve, 150));
    const heldAt = tunnel.bodyBytes();
    expect(heldAt).toBeLessThan(CHUNK_BYTES * CHUNK_COUNT);
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(tunnel.bodyBytes()).toBe(heldAt);
    expect(tunnel.frames.some((frame) => frame.type === "body-end")).toBe(
      false,
    );

    tunnel.bufferedAmount = 0;
    await vi.waitFor(() => {
      expect(tunnel.frames.at(-1)).toMatchObject({ type: "body-end" });
    });
    expect(tunnel.bodyBytes()).toBe(CHUNK_BYTES * CHUNK_COUNT);
    session.dispose();
  });

  it("stops waiting when the stream is canceled", async () => {
    const port = await startOrigin();
    const tunnel = new FakeTunnel();
    tunnel.bufferedAmount = 8 * 1024 * 1024;
    const session = openDownload(tunnel, port);
    await vi.waitFor(() => {
      expect(tunnel.bodyBytes()).toBeGreaterThan(0);
    });

    tunnel.emit(
      "message",
      Buffer.from(
        encodeFrame({
          type: "close-stream",
          streamId: 3,
          code: 1000,
          reason: "visitor canceled response body",
        }),
      ),
      true,
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    const settledAt = tunnel.frames.length;
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(tunnel.frames.length).toBe(settledAt);
    expect(tunnel.bodyBytes()).toBeLessThan(CHUNK_BYTES * CHUNK_COUNT);
    expect(tunnel.frames.some((frame) => frame.type === "body-end")).toBe(
      false,
    );
    session.dispose();
  });
});
