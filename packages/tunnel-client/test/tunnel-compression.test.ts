import { once } from "node:events";
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebSocket as NodeWebSocket, WebSocketServer } from "ws";
import { decodeFrame, encodeFrame, type Frame } from "@bb/tunnel-contract";
import { TunnelSession } from "../src/session.js";

const PAYLOAD_BYTES = 1024 * 1024;

let origin: Server;
let originWs: WebSocketServer;
let gate: WebSocketServer;
let tunnel: NodeWebSocket;
let session: TunnelSession;
let gateSocket: NodeWebSocket;
let wireBytes = 0;

function port(server: Server | WebSocketServer): number {
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("expected a TCP address");
  }
  return address.port;
}

beforeAll(async () => {
  origin = createServer((request, response) => {
    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    if (request.url === "/encoded") headers["content-encoding"] = "br";
    response.writeHead(200, headers);
    response.end(Buffer.alloc(PAYLOAD_BYTES));
  });
  originWs = new WebSocketServer({ server: origin, perMessageDeflate: false });
  originWs.on("connection", (socket) => socket.send("x".repeat(PAYLOAD_BYTES)));
  origin.listen(0, "127.0.0.1");
  await once(origin, "listening");

  gate = new WebSocketServer({
    host: "127.0.0.1",
    port: 0,
    perMessageDeflate: true,
  });
  await once(gate, "listening");
  const connected = new Promise<NodeWebSocket>((resolve) => {
    gate.once("connection", (socket, request) => {
      request.socket.on("data", (chunk: Buffer) => {
        wireBytes += chunk.byteLength;
      });
      resolve(socket);
    });
  });
  tunnel = new NodeWebSocket(`ws://127.0.0.1:${port(gate)}/`);
  gateSocket = await connected;
  await once(tunnel, "open");
  session = new TunnelSession({
    tunnel,
    log: { warn: () => {} },
    resolveOrigin: () => ({
      kind: "ok",
      resolved: {
        origin: `http://127.0.0.1:${port(origin)}`,
        publicOrigin: "https://share.example",
      },
    }),
  });
  session.start();
});

afterAll(async () => {
  session.dispose();
  tunnel.terminate();
  for (const client of gate.clients) client.terminate();
  for (const client of originWs.clients) client.terminate();
  await new Promise<void>((resolve) => gate.close(() => resolve()));
  originWs.close();
  origin.closeAllConnections();
  await new Promise<void>((resolve) => origin.close(() => resolve()));
});

async function relayWireBytes(
  open: Frame,
  doneType: Frame["type"],
): Promise<number> {
  wireBytes = 0;
  const done = new Promise<void>((resolve) => {
    const onMessage = (data: Buffer) => {
      if (decodeFrame(data).type !== doneType) return;
      gateSocket.off("message", onMessage);
      resolve();
    };
    gateSocket.on("message", onMessage);
  });
  gateSocket.send(encodeFrame(open));
  await done;
  return wireBytes;
}

describe("tunnel send compression", () => {
  it("negotiates permessage-deflate with the gate", () => {
    expect(tunnel.extensions).toContain("permessage-deflate");
  });

  it("sends an already content-encoded response body uncompressed", async () => {
    const bytes = await relayWireBytes(
      {
        type: "open-http",
        streamId: 1,
        method: "GET",
        path: "/encoded",
        headers: [],
        hasBody: false,
      },
      "body-end",
    );
    expect(bytes).toBeGreaterThan(PAYLOAD_BYTES);
  });

  it("compresses a response body that has no content encoding", async () => {
    const bytes = await relayWireBytes(
      {
        type: "open-http",
        streamId: 3,
        method: "GET",
        path: "/plain",
        headers: [],
        hasBody: false,
      },
      "body-end",
    );
    expect(bytes).toBeLessThan(PAYLOAD_BYTES / 10);
  });

  it("compresses realtime data from an origin websocket", async () => {
    const bytes = await relayWireBytes(
      {
        type: "open-ws",
        streamId: 5,
        path: "/ws",
        headers: [],
        protocols: [],
      },
      "ws-data",
    );
    expect(bytes).toBeLessThan(PAYLOAD_BYTES / 10);
  });
});
