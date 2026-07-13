import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  decodeFrame,
  encodeFrame,
  type Frame,
  type OpenHttpFrame,
} from "@bb/tunnel-contract";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import type { HostDaemonLogger } from "../logger.js";
import {
  ConnectTunnelClient,
  type ConnectTunnelStatus,
  type CreateTunnelWebSocket,
} from "./index.js";

const logger: HostDaemonLogger = {
  debug() {},
  error() {},
  info() {},
  warn() {},
};

const openServers: Server[] = [];
const openWebSocketServers: WebSocketServer[] = [];

async function listen(server: Server): Promise<number> {
  openServers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return (server.address() as AddressInfo).port;
}

function attachGate(server: Server): WebSocketServer {
  const gate = new WebSocketServer({ noServer: true });
  server.on("upgrade", (request, socket, head) => {
    gate.handleUpgrade(request, socket, head, (websocket) => {
      gate.emit("connection", websocket, request);
    });
  });
  openWebSocketServers.push(gate);
  return gate;
}

function rawDataBuffer(data: RawData): Buffer {
  if (Array.isArray(data)) {
    return Buffer.concat(data);
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(new Uint8Array(data));
  }
  return Buffer.from(data);
}

async function waitFor(
  condition: () => boolean,
  message: string,
  timeoutMs = 2_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for ${message}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function tunnelFactory(args: {
  gatePort: number;
  requestedUrls: string[];
}): CreateTunnelWebSocket {
  return (url, options) => {
    args.requestedUrls.push(url);
    const local = new URL(url);
    local.protocol = "ws:";
    local.hostname = "127.0.0.1";
    local.port = String(args.gatePort);
    return new WebSocket(local, { headers: options.headers });
  };
}

function sendOpenHttp(socket: WebSocket, frame: OpenHttpFrame): void {
  socket.send(encodeFrame(frame));
}

afterEach(async () => {
  for (const websocketServer of openWebSocketServers.splice(0)) {
    for (const client of websocketServer.clients) {
      client.terminate();
    }
    await new Promise<void>((resolve) =>
      websocketServer.close(() => resolve()),
    );
  }
  for (const server of openServers.splice(0)) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

describe("ConnectTunnelClient", () => {
  it("dials on the first share, closes on the last removal, and ignores stale sets", async () => {
    const gateServer = createServer();
    const gatePort = await listen(gateServer);
    const gate = attachGate(gateServer);
    const requestedUrls: string[] = [];
    const credentials: string[] = [];
    const sockets: WebSocket[] = [];
    gate.on("connection", (socket, request) => {
      sockets.push(socket);
      credentials.push(request.headers.authorization ?? "");
    });

    const statuses: ConnectTunnelStatus[] = [];
    const client = new ConnectTunnelClient({
      machineCredential: "bbcm_machine-secret",
      logger,
      createWebSocket: tunnelFactory({ gatePort, requestedUrls }),
      reconnectBackoff: { baseDelayMs: 5, maxDelayMs: 20 },
      onStatusChange: (status) => statuses.push(status),
    });

    expect(
      client.replaceShareSet({
        generation: 1,
        ports: [4173],
        tunnel: null,
      }),
    ).toBe(true);
    expect(requestedUrls).toEqual([]);

    client.replaceShareSet({
      generation: 2,
      ports: [4173],
      tunnel: { label: "sawyer-air", baseDomain: "getbb.app" },
    });
    await waitFor(() => sockets.length === 1, "first machine tunnel");
    expect(requestedUrls).toEqual(["wss://sawyer-air.getbb.app/__tunnel?v=1"]);
    expect(credentials).toEqual(["Bearer bbcm_machine-secret"]);
    await waitFor(
      () => client.status().state === "connected",
      "connected state",
    );

    let closed = false;
    sockets[0]!.on("close", () => {
      closed = true;
    });
    client.replaceShareSet({
      generation: 3,
      ports: [],
      tunnel: { label: "sawyer-air", baseDomain: "getbb.app" },
    });
    await waitFor(() => closed, "last-share socket close");
    expect(client.status()).toMatchObject({
      state: "offline",
      generation: 3,
      ports: [],
      lastError: null,
    });

    expect(
      client.replaceShareSet({
        generation: 2,
        ports: [8080],
        tunnel: { label: "sawyer-air", baseDomain: "getbb.app" },
      }),
    ).toBe(false);
    expect(requestedUrls).toHaveLength(1);
    expect(statuses.some((status) => status.state === "connected")).toBe(true);
    client.shutdown();
  });

  it("proxies only explicitly shared HTTP targets to loopback", async () => {
    const originRequests: Array<{ host: string; path: string }> = [];
    const originServer = createServer((request, response) => {
      originRequests.push({
        host: request.headers.host ?? "",
        path: request.url ?? "",
      });
      response.writeHead(201, { "content-type": "text/plain" });
      response.end("origin-ok");
    });
    const originPort = await listen(originServer);

    const gateServer = createServer();
    const gatePort = await listen(gateServer);
    const gate = attachGate(gateServer);
    let gateSocket: WebSocket | undefined;
    const frames: Frame[] = [];
    gate.on("connection", (socket) => {
      gateSocket = socket;
      socket.on("message", (data: RawData, isBinary: boolean) => {
        if (isBinary) {
          frames.push(decodeFrame(rawDataBuffer(data)));
        }
      });
    });

    const client = new ConnectTunnelClient({
      machineCredential: "bbcm_machine-secret",
      logger,
      createWebSocket: tunnelFactory({ gatePort, requestedUrls: [] }),
    });
    client.replaceShareSet({
      generation: 1,
      ports: [originPort],
      tunnel: { label: "machine-a", baseDomain: "getbb.app" },
    });
    await waitFor(() => gateSocket !== undefined, "gate socket");

    sendOpenHttp(gateSocket!, {
      type: "open-http",
      streamId: 1,
      method: "GET",
      path: "/health?source=tunnel",
      headers: [],
      hasBody: false,
      target: String(originPort),
    });
    await waitFor(
      () =>
        frames.some(
          (frame) => frame.type === "body-end" && frame.streamId === 1,
        ),
      "shared origin response",
    );
    expect(
      frames.find(
        (frame) => frame.type === "resp-head" && frame.streamId === 1,
      ),
    ).toMatchObject({ type: "resp-head", status: 201 });
    const body = frames
      .filter(
        (frame): frame is Extract<Frame, { type: "body-chunk" }> =>
          frame.type === "body-chunk" && frame.streamId === 1,
      )
      .map((frame) => Buffer.from(frame.data).toString())
      .join("");
    expect(body).toBe("origin-ok");
    expect(originRequests).toEqual([
      { host: `127.0.0.1:${originPort}`, path: "/health?source=tunnel" },
    ]);

    sendOpenHttp(gateSocket!, {
      type: "open-http",
      streamId: 2,
      method: "GET",
      path: "/",
      headers: [],
      hasBody: false,
    });
    sendOpenHttp(gateSocket!, {
      type: "open-http",
      streamId: 3,
      method: "GET",
      path: "/",
      headers: [],
      hasBody: false,
      target: String(originPort + 1),
    });
    await waitFor(
      () =>
        frames.some(
          (frame) => frame.type === "body-end" && frame.streamId === 2,
        ) &&
        frames.some(
          (frame) => frame.type === "body-end" && frame.streamId === 3,
        ),
      "unregistered responses",
    );
    for (const streamId of [2, 3]) {
      expect(
        frames.find(
          (frame) => frame.type === "resp-head" && frame.streamId === streamId,
        ),
      ).toMatchObject({ status: 404 });
    }
    expect(originRequests).toHaveLength(1);
    client.shutdown();
  });

  it("reconnects with backoff after a gate socket drop", async () => {
    const gateServer = createServer();
    const gatePort = await listen(gateServer);
    const gate = attachGate(gateServer);
    const sockets: WebSocket[] = [];
    gate.on("connection", (socket) => sockets.push(socket));
    const statuses: ConnectTunnelStatus[] = [];

    const client = new ConnectTunnelClient({
      machineCredential: "bbcm_machine-secret",
      logger,
      createWebSocket: tunnelFactory({ gatePort, requestedUrls: [] }),
      reconnectBackoff: {
        baseDelayMs: 5,
        maxDelayMs: 20,
        stableConnectionMs: 1_000,
      },
      onStatusChange: (status) => statuses.push(status),
    });
    client.replaceShareSet({
      generation: 1,
      ports: [3000],
      tunnel: { label: "machine-a", baseDomain: "getbb.app" },
    });
    await waitFor(() => sockets.length === 1, "initial gate connection");
    sockets[0]!.terminate();
    await waitFor(() => sockets.length === 2, "backoff reconnect");
    await waitFor(
      () => client.status().state === "connected",
      "reconnected state",
    );

    expect(
      statuses.some(
        (status) =>
          status.state === "reconnecting" && status.lastError !== null,
      ),
    ).toBe(true);
    client.shutdown();
  });

  it("never dials without a machine credential", () => {
    let dialCount = 0;
    const client = new ConnectTunnelClient({
      logger,
      createWebSocket: () => {
        dialCount += 1;
        throw new Error("must not dial");
      },
    });

    client.replaceShareSet({
      generation: 1,
      ports: [3000],
      tunnel: { label: "machine-a", baseDomain: "getbb.app" },
    });

    expect(dialCount).toBe(0);
    expect(client.status()).toMatchObject({ state: "offline", ports: [3000] });
    client.shutdown();
  });
});
