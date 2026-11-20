import http from "node:http";
import type { Socket } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocketServer, type RawData } from "ws";
import {
  DEFAULT_CONNECTION_TIMEOUT_MS,
  DEFAULT_MAX_RECONNECTION_DELAY,
  DEFAULT_MIN_RECONNECTION_DELAY,
  DEFAULT_RECONNECTION_DELAY_GROW_FACTOR,
  createDefaultReconnectingWebSocket,
  type ReconnectingWebSocketLike,
} from "./server-connection-support.js";

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

async function startCompressingServer() {
  const wss = new WebSocketServer({ noServer: true });
  wss.options.perMessageDeflate = { threshold: 0 };
  const server = http.createServer();
  let raw: Socket | null = null;
  const messages: string[] = [];
  const waiters: Array<() => void> = [];
  server.on("upgrade", (request, socket, head) => {
    raw = request.socket;
    wss.handleUpgrade(request, socket, head, (websocket) => {
      websocket.on("message", (data: RawData) => {
        messages.push(String(data));
        waiters.shift()?.();
      });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(() => {
    wss.close();
    server.close();
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Expected a TCP server address");
  }
  return {
    url: `ws://127.0.0.1:${address.port}`,
    messages,
    async wireBytes(send: () => void): Promise<number> {
      const before = raw?.bytesRead ?? 0;
      const received = new Promise<void>((resolve) => waiters.push(resolve));
      send();
      await received;
      return (raw?.bytesRead ?? 0) - before;
    },
  };
}

function connect(url: string): Promise<ReconnectingWebSocketLike> {
  const socket = createDefaultReconnectingWebSocket(async () => url, {
    minReconnectionDelay: DEFAULT_MIN_RECONNECTION_DELAY,
    maxReconnectionDelay: DEFAULT_MAX_RECONNECTION_DELAY,
    reconnectionDelayGrowFactor: DEFAULT_RECONNECTION_DELAY_GROW_FACTOR,
    connectionTimeout: DEFAULT_CONNECTION_TIMEOUT_MS,
    maxRetries: 0,
    onFrameWritten: () => {},
  });
  cleanups.unshift(() => socket.close());
  return new Promise((resolve) => {
    socket.onopen = () => resolve(socket);
  });
}

describe("createDefaultReconnectingWebSocket", () => {
  it("compresses text frames for a server that accepts compression and sends binary frames uncompressed", async () => {
    const server = await startCompressingServer();
    const socket = await connect(server.url);
    const frame = JSON.stringify(
      Array.from({ length: 2_000 }, (_, index) => ({
        seq: index,
        line: "src/server-connection.ts: compiled without errors",
      })),
    );

    const compressed = await server.wireBytes(() => socket.send(frame));
    const uncompressed = await server.wireBytes(() =>
      socket.send(new TextEncoder().encode(frame)),
    );

    expect(server.messages).toEqual([frame, frame]);
    expect(compressed).toBeLessThan(frame.length / 4);
    expect(uncompressed).toBeGreaterThan(frame.length);
  });
});
