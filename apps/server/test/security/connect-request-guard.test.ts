import { once } from "node:events";
import { afterEach, expect, it } from "vitest";
import WebSocket, { WebSocketServer } from "ws";
import {
  decodeFrame,
  encodeFrame,
  type Frame,
  type HeaderPair,
} from "@bb/tunnel-contract";
import { TunnelSession } from "@bb/tunnel-client";
import {
  startTestServer,
  type RunningTestServer,
} from "../helpers/test-app.js";

let server: RunningTestServer | undefined;
let gateway: WebSocketServer | undefined;
let client: WebSocket | undefined;
let session: TunnelSession | undefined;

afterEach(async () => {
  session?.dispose();
  client?.terminate();
  if (gateway !== undefined) {
    for (const socket of gateway.clients) socket.terminate();
    await new Promise<void>((resolve, reject) => {
      gateway!.close((error) => (error ? reject(error) : resolve()));
    });
  }
  await server?.close();
});

it("carries Connect HTTP and WebSocket requests through the host guard", async () => {
  server = await startTestServer();
  gateway = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await once(gateway, "listening");
  const address = gateway.address();
  if (address === null || typeof address === "string")
    throw new Error("Expected TCP listener");
  const connected = new Promise<WebSocket>((resolve) =>
    gateway!.once("connection", resolve),
  );
  client = new WebSocket(`ws://127.0.0.1:${address.port}`);
  await once(client, "open");
  const relay = await connected;
  const baseUrl = server.baseUrl;
  session = new TunnelSession({
    tunnel: client,
    log: { warn: () => {} },
    resolveOrigin: () => ({
      kind: "ok",
      resolved: { origin: baseUrl, publicOrigin: "https://bee.getbb.app" },
    }),
  });
  session.start();
  const frames: Frame[] = [];
  relay.on("message", (data: Buffer) => frames.push(decodeFrame(data)));
  const headers: HeaderPair[] = [
    ["Host", "bee.getbb.app"],
    ["Origin", "https://bee.getbb.app"],
    ["X-Forwarded-Host", "bee.getbb.app"],
    ["X-Forwarded-Proto", "https"],
  ];
  relay.send(
    encodeFrame({
      type: "open-http",
      streamId: 1,
      method: "GET",
      path: "/api/v1/threads",
      headers,
      hasBody: false,
    }),
  );
  await expect
    .poll(() =>
      frames.find(
        (frame) => frame.type === "resp-head" && frame.streamId === 1,
      ),
    )
    .toMatchObject({ status: 200 });
  relay.send(
    encodeFrame({
      type: "open-http",
      streamId: 2,
      method: "GET",
      path: "/api/v1/threads",
      headers: [["Host", "bee.getbb.app"]],
      hasBody: false,
    }),
  );
  await expect
    .poll(() =>
      frames.find(
        (frame) => frame.type === "resp-head" && frame.streamId === 2,
      ),
    )
    .toMatchObject({ status: 200 });
  relay.send(
    encodeFrame({
      type: "open-ws",
      streamId: 3,
      path: "/ws",
      headers,
      protocols: [],
    }),
  );
  await expect
    .poll(() =>
      frames.find(
        (frame) => frame.type === "ws-open-ack" && frame.streamId === 3,
      ),
    )
    .toBeDefined();
  relay.send(
    encodeFrame({
      type: "open-http",
      streamId: 4,
      method: "GET",
      path: "/api/v1/threads",
      headers: [
        ["Host", "bee.getbb.app"],
        ["Origin", "https://attacker.example"],
      ],
      hasBody: false,
    }),
  );
  await expect
    .poll(() =>
      frames.find(
        (frame) => frame.type === "resp-head" && frame.streamId === 4,
      ),
    )
    .toMatchObject({ status: 403 });
});
