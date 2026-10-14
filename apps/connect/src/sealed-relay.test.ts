import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocketServer } from "ws";
import { decodeFrame, type Frame } from "@bb/tunnel-contract";
import {
  TunnelSession,
  plaintextStreamVerdict,
  type TunnelTransport,
} from "@bb/tunnel-client";
import {
  SealedChannelClient,
  acceptSealedChannel,
  generateSigningKeyPair,
  localDeviceIdentity,
  sealedFetch,
  type SealedSocket,
  type SigningKeyPair,
} from "@bb/sealed-channel";
import { GATE_AUTH_HEADER } from "./protocol-headers";
import { SealedAccess } from "bb-plugin-connect/src/sealed/sealed-access.js";
import { createKvDeviceRegistry } from "bb-plugin-connect/src/sealed/devices.js";
import { createDeviceCodeIssuer } from "bb-plugin-connect/src/sealed/device-codes.js";
import { createKvServerIdentityStore } from "bb-plugin-connect/src/sealed/identity.js";

vi.mock("drizzle-orm/d1", () => ({ drizzle: vi.fn(() => ({})) }));

class FakeWebSocketRequestResponsePair {
  constructor(
    readonly request: string,
    readonly response: string,
  ) {}
}
vi.stubGlobal("WebSocketRequestResponsePair", FakeWebSocketRequestResponsePair);

import { TunnelDO } from "./tunnel-do.js";

const SEALED_PATH = "/api/v1/plugins/connect/http/sealed";
const SECRET_RESPONSE = "thread-title-CONFIDENTIAL-relay-4d2e";
const SECRET_REQUEST = "prompt-CONFIDENTIAL-relay-91aa";
const SECRET_REALTIME = "realtime-CONFIDENTIAL-relay-77cc";
const LARGE_DOWNLOAD = Buffer.alloc(2 * 1024 * 1024 + 5, 0).map(
  (_, index) => (index * 7 + 3) % 256,
);
const LARGE_DOWNLOAD_MARKER = Buffer.from(LARGE_DOWNLOAD.subarray(4096, 4160));

interface RelayFrameLog {
  toTunnel: Frame[];
  fromTunnel: Frame[];
}

function mockDoState() {
  const storage = new Map<string, unknown>();
  const entries: Array<{ ws: WebSocket; tags: string[] }> = [];
  const api = {
    getWebSockets: (tag?: string) =>
      entries
        .filter((entry) => tag === undefined || entry.tags.includes(tag))
        .map((entry) => entry.ws),
    getTags: (ws: WebSocket) =>
      entries.find((entry) => entry.ws === ws)?.tags ?? [],
    acceptWebSocket: (ws: WebSocket, tags: string[] = []) => {
      entries.push({ ws, tags });
    },
    setWebSocketAutoResponse: vi.fn(),
    abort: vi.fn((reason?: string) => {
      throw new Error(reason);
    }),
    blockConcurrencyWhile: (fn: () => Promise<void>) => fn(),
    storage: {
      get: async (key: string) => storage.get(key),
      put: async (key: string | Record<string, unknown>, value?: unknown) => {
        if (typeof key === "string") storage.set(key, value);
        else for (const [k, v] of Object.entries(key)) storage.set(k, v);
      },
      delete: async (key: string) => {
        storage.delete(key);
      },
      setAlarm: async () => {},
      sync: async () => {},
    },
  } as unknown as DurableObjectState;
  return { api, entries };
}

async function withWorkersGlobals<T>(
  serverEnd: unknown,
  run: () => Promise<T>,
): Promise<T> {
  const RealResponse = globalThis.Response;
  class WorkersResponse extends RealResponse {
    readonly webSocket: WebSocket | null;
    constructor(
      body?: BodyInit | null,
      init?: ResponseInit & { webSocket?: WebSocket | null },
    ) {
      if (init?.webSocket != null) {
        super(null, { status: 200 });
        Object.defineProperty(this, "status", { value: init.status });
        this.webSocket = init.webSocket;
      } else {
        super(body ?? null, init);
        this.webSocket = null;
      }
    }
  }
  class FakeWebSocketPair {
    0 = { readyState: 1, send: () => {}, close: () => {} };
    1 = serverEnd;
  }
  globalThis.Response = WorkersResponse as never;
  (globalThis as { WebSocketPair?: unknown }).WebSocketPair = FakeWebSocketPair;
  try {
    return await run();
  } finally {
    globalThis.Response = RealResponse;
    delete (globalThis as { WebSocketPair?: unknown }).WebSocketPair;
  }
}

class OuterTunnelTransport extends EventEmitter implements TunnelTransport {
  readyState = 1;
  constructor(
    private readonly sendToRelay: (data: Uint8Array | string) => void,
  ) {
    super();
  }
  send(data: Uint8Array | string): void {
    this.sendToRelay(data);
  }
  terminate(): void {
    this.readyState = 3;
    this.emit("close");
  }
}

interface Origin {
  origin: string;
  requests: string[];
  identity: SigningKeyPair;
  access: SealedAccess;
  close(): Promise<void>;
}

function memoryKv() {
  const store = new Map<string, unknown>();
  return {
    get: async <T>(key: string) => store.get(key) as T | undefined,
    set: async (key: string, value: unknown) => {
      store.set(key, value);
    },
    delete: async (key: string) => {
      store.delete(key);
    },
    list: async (prefix: string) =>
      [...store.keys()].filter((key) => key.startsWith(prefix)),
  };
}

async function startOrigin(): Promise<Origin> {
  const kv = memoryKv();
  const access = new SealedAccess({
    identity: createKvServerIdentityStore(kv),
    devices: createKvDeviceRegistry(kv),
    codes: createDeviceCodeIssuer(),
    policy: kv,
  });
  await access.load();
  const identity = (await access.serverIdentity()) as SigningKeyPair;
  const requests: string[] = [];
  const server: Server = createServer((request, response) => {
    requests.push(`${request.method} ${request.url}`);
    if (request.url === "/api/v1/system/config") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ title: SECRET_RESPONSE }));
      return;
    }
    if (
      request.url === "/api/v1/threads/thr_1/thread-storage/files/upload.bin"
    ) {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        const body = Buffer.concat(chunks);
        response.writeHead(201, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            bytes: body.length,
            digest: createHash("sha256").update(body).digest("hex"),
          }),
        );
      });
      return;
    }
    if (
      request.url === "/api/v1/threads/thr_1/thread-storage/files/report.bin"
    ) {
      response.writeHead(200, { "content-type": "application/octet-stream" });
      response.end(LARGE_DOWNLOAD);
      return;
    }
    response.writeHead(404);
    response.end();
  });
  const realtime = new WebSocketServer({ noServer: true });
  realtime.on("connection", (socket) => {
    socket.on("message", (data) =>
      socket.send(`${SECRET_REALTIME}:${data.toString()}`),
    );
  });
  const sealedEndpoint = new WebSocketServer({ noServer: true });
  sealedEndpoint.on("connection", (socket) => {
    const acceptor = acceptSealedChannel({
      socket: {
        send: (data) => socket.send(data),
        close: (code, reason) => socket.close(code, reason),
        get readyState() {
          return socket.readyState;
        },
      },
      identity,
      authorize: (request) => access.authorize(request),
      onEstablished(channel) {
        const handle = {};
        void access.channelOpened(
          handle,
          channel.deviceId,
          identity.publicKey,
          (code, reason) => channel.close(code, reason),
        );
        channel.transport.on("close", () => access.channelClosed(handle));
        const inner = new TunnelSession({
          tunnel: channel.transport,
          log: { warn: () => {} },
          resolveOrigin: () => ({
            kind: "ok",
            resolved: { origin, publicOrigin: "https://sawyer.getbb.app" },
          }),
        });
        inner.start();
        channel.transport.on("close", () => inner.dispose());
      },
    });
    socket.on("message", (data: Buffer, isBinary: boolean) => {
      void acceptor.onMessage(
        isBinary ? new Uint8Array(data) : data.toString(),
      );
    });
    socket.on("close", (code: number, reason: Buffer) =>
      acceptor.onClose(code, reason.toString()),
    );
  });
  server.on("upgrade", (request, socket, head) => {
    const path = new URL(request.url ?? "/", "http://origin").pathname;
    const target =
      path === SEALED_PATH ? sealedEndpoint : path === "/ws" ? realtime : null;
    if (target === null) {
      socket.destroy();
      return;
    }
    target.handleUpgrade(request, socket, head, (ws) =>
      target.emit("connection", ws, request),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("no port");
  const origin = `http://127.0.0.1:${address.port}`;
  return {
    origin,
    requests,
    identity,
    access,
    close: () =>
      new Promise<void>((resolve) => {
        realtime.close();
        sealedEndpoint.close();
        server.close(() => resolve());
      }),
  };
}

interface Relay {
  dob: TunnelDO;
  frames: RelayFrameLog;
  connectTunnel(): Promise<{
    session: TunnelSession;
    transport: OuterTunnelTransport;
    ws: WebSocket;
  }>;
  openVisitorSocket(path: string): Promise<SealedSocket>;
}

function createRelay(origin: Origin, requireSealed: () => boolean): Relay {
  const state = mockDoState();
  const dob = new TunnelDO(state.api, {
    TUNNEL_DO: {} as DurableObjectNamespace,
    DB: {} as D1Database,
    GATE_EVENTS: {
      writeDataPoint: () => {},
    } as unknown as AnalyticsEngineDataset,
    BASE_DOMAIN: "getbb.app",
    BETTER_AUTH_SECRET: "secret",
  });
  const frames: RelayFrameLog = { toTunnel: [], fromTunnel: [] };

  async function connectTunnel() {
    let transport!: OuterTunnelTransport;
    let tunnelReadyState = 1;
    const ws = {
      get readyState() {
        return tunnelReadyState;
      },
      send(data: ArrayBuffer | ArrayBufferView | string) {
        if (typeof data === "string") {
          transport.emit("message", Buffer.from(data), false);
          return;
        }
        const bytes =
          data instanceof ArrayBuffer
            ? new Uint8Array(data)
            : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
        frames.toTunnel.push(decodeFrame(bytes));
        transport.emit("message", bytes, true);
      },
      close(code: number, reason: string) {
        if (tunnelReadyState === 3) return;
        tunnelReadyState = 3;
        transport.terminate();
        const index = state.entries.findIndex((entry) => entry.ws === ws);
        if (index >= 0) state.entries.splice(index, 1);
        void code;
        void reason;
      },
      deserializeAttachment: () => null,
      serializeAttachment: () => {},
    } as unknown as WebSocket & { readyState: number };
    transport = new OuterTunnelTransport((data) => {
      if (typeof data === "string") return;
      frames.fromTunnel.push(decodeFrame(data));
      dob.webSocketMessage(
        ws,
        data.buffer.slice(
          data.byteOffset,
          data.byteOffset + data.byteLength,
        ) as ArrayBuffer,
      );
    });
    await withWorkersGlobals(ws, async () => {
      const accepted = await dob.fetch(
        new Request("https://do.internal/__tunnel?v=1", {
          headers: { upgrade: "websocket" },
        }),
      );
      expect(accepted.status).toBe(101);
    });
    const session = new TunnelSession({
      tunnel: transport,
      log: { warn: () => {} },
      resolveOrigin: () => ({
        kind: "ok",
        resolved: {
          origin: origin.origin,
          publicOrigin: "https://sawyer.getbb.app",
        },
      }),
      guardStream: (stream) => plaintextStreamVerdict(stream, requireSealed()),
    });
    session.start();
    return { session, transport, ws };
  }

  async function openVisitorSocket(path: string): Promise<SealedSocket> {
    let attachment: unknown = null;
    const socket: SealedSocket = {
      send(data) {
        dob.webSocketMessage(
          visitorEnd,
          data.buffer.slice(
            data.byteOffset,
            data.byteOffset + data.byteLength,
          ) as ArrayBuffer,
        );
      },
      close(code = 1000, reason = "") {
        dob.webSocketClose(visitorEnd, code, reason);
      },
      onOpen: null,
      onMessage: null,
      onClose: null,
      onError: null,
    };
    let visitorReadyState = 1;
    const visitorEnd = {
      get readyState() {
        return visitorReadyState;
      },
      send(data: ArrayBuffer | ArrayBufferView | string) {
        if (typeof data === "string") return;
        const bytes =
          data instanceof ArrayBuffer
            ? new Uint8Array(data)
            : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
        socket.onMessage?.(bytes);
      },
      close(code: number, reason: string) {
        visitorReadyState = 3;
        socket.onClose?.(code, reason);
      },
      serializeAttachment(value: unknown) {
        attachment = value;
      },
      deserializeAttachment() {
        return attachment;
      },
    } as unknown as WebSocket & { readyState: number };
    await withWorkersGlobals(visitorEnd, async () => {
      const response = await dob.fetch(
        new Request(`https://do.internal${path}`, {
          headers: { upgrade: "websocket", [GATE_AUTH_HEADER]: "session" },
        }),
      );
      expect(response.status).toBe(101);
    });
    setTimeout(() => socket.onOpen?.(), 0);
    return socket;
  }

  return { dob, frames, connectTunnel, openVisitorSocket };
}

function frameText(frame: Frame): string {
  if (frame.type === "ws-data" || frame.type === "body-chunk") {
    return Buffer.from(frame.data).toString("latin1");
  }
  return JSON.stringify(frame);
}

function relayFramesContain(log: RelayFrameLog, needle: string): boolean {
  return [...log.toTunnel, ...log.fromTunnel].some((frame) =>
    frameText(frame).includes(needle),
  );
}

describe("bb connect relay with sealed channels", () => {
  let origin: Origin;
  let cleanups: Array<() => void | Promise<void>> = [];

  beforeEach(async () => {
    origin = await startOrigin();
  });

  afterEach(async () => {
    for (const cleanup of cleanups.reverse()) await cleanup();
    cleanups = [];
    await origin.close();
  });

  async function connectSealedVisitor(
    relay: Relay,
    options: { device?: SigningKeyPair; deviceCode?: string } = {},
  ) {
    const socket = await relay.openVisitorSocket(SEALED_PATH);
    const connection = await SealedChannelClient.connect({
      socket,
      device: localDeviceIdentity(options.device ?? generateSigningKeyPair()),
      deviceName: "Visitor browser",
      surface: "browser",
      ...(options.deviceCode !== undefined
        ? { deviceCode: options.deviceCode }
        : {}),
      verifyServerKey: (key) =>
        Buffer.from(key).equals(Buffer.from(origin.identity.publicKey))
          ? "accept"
          : "reject",
      supportsStreaming: true,
    });
    if (connection.client === null)
      throw new Error(`handshake ${connection.outcome.status}`);
    return connection.client;
  }

  async function handshakeOutcome(
    relay: Relay,
    device: SigningKeyPair,
  ): Promise<string> {
    const socket = await relay.openVisitorSocket(SEALED_PATH);
    const connection = await SealedChannelClient.connect({
      socket,
      device: localDeviceIdentity(device),
      deviceName: "Visitor browser",
      surface: "browser",
      verifyServerKey: () => "accept",
      supportsStreaming: true,
    });
    connection.client?.close();
    return connection.outcome.status;
  }

  it("relays only ciphertext for API, file-transfer, and realtime traffic while readable traffic keeps working", async () => {
    let required = false;
    const relay = createRelay(origin, () => required);
    const tunnel = await relay.connectTunnel();
    cleanups.push(() => tunnel.session.dispose());

    const client = await connectSealedVisitor(relay);
    cleanups.push(() => client.close());

    const config = await sealedFetch(
      client,
      "https://sawyer.getbb.app/api/v1/system/config",
      undefined,
      { origin: "https://sawyer.getbb.app" },
    );
    expect(config.status).toBe(200);
    expect(await config.json()).toEqual({ title: SECRET_RESPONSE });

    const secretBytes = Buffer.from(SECRET_REQUEST);
    const upload = new Uint8Array(3 * 1024 * 1024 + 17).map(
      (_, index) => index % 251,
    );
    upload.set(secretBytes, 1_000_003);
    const posted = await sealedFetch(
      client,
      "https://sawyer.getbb.app/api/v1/threads/thr_1/thread-storage/files/upload.bin",
      {
        method: "PUT",
        body: upload,
        headers: { "content-type": "application/octet-stream" },
      },
      { origin: "https://sawyer.getbb.app" },
    );
    expect(posted.status).toBe(201);
    expect(await posted.json()).toEqual({
      bytes: upload.length,
      digest: createHash("sha256").update(upload).digest("hex"),
    });
    const uploadMarker = Buffer.from(
      upload.subarray(2_000_000, 2_000_064),
    ).toString("latin1");

    const download = await sealedFetch(
      client,
      "https://sawyer.getbb.app/api/v1/threads/thr_1/thread-storage/files/report.bin",
      undefined,
      { origin: "https://sawyer.getbb.app" },
    );
    expect(download.status).toBe(200);
    const downloaded = Buffer.from(await download.arrayBuffer());
    expect(downloaded.length).toBe(LARGE_DOWNLOAD.length);
    expect(downloaded.equals(LARGE_DOWNLOAD)).toBe(true);

    const realtime = client.openWebSocket({ path: "/ws" });
    const echoed = await new Promise<string>((resolve) => {
      realtime.onOpen = () => realtime.send("subscribe");
      realtime.onMessage = (data) => resolve(String(data));
    });
    expect(echoed).toBe(`${SECRET_REALTIME}:subscribe`);
    realtime.close();

    expect(origin.requests).toEqual([
      "GET /api/v1/system/config",
      "PUT /api/v1/threads/thr_1/thread-storage/files/upload.bin",
      "GET /api/v1/threads/thr_1/thread-storage/files/report.bin",
    ]);

    const opens = relay.frames.toTunnel.filter(
      (frame) => frame.type === "open-ws",
    );
    expect(opens).toHaveLength(1);
    expect(opens[0]).toMatchObject({ path: SEALED_PATH });
    expect(
      relay.frames.toTunnel.filter((frame) => frame.type === "open-http"),
    ).toHaveLength(0);
    const dataFrames = [
      ...relay.frames.toTunnel,
      ...relay.frames.fromTunnel,
    ].filter((frame) => frame.type === "ws-data");
    expect(dataFrames.length).toBeGreaterThan(8);
    for (const needle of [
      SECRET_RESPONSE,
      SECRET_REQUEST,
      SECRET_REALTIME,
      uploadMarker,
      LARGE_DOWNLOAD_MARKER.toString("latin1"),
      "/thread-storage/files/report.bin",
      "/api/v1/system/config",
      "/api/v1/threads/thr_1/thread-storage/files/upload.bin",
      "content-type",
      "subscribe",
      '"title"',
    ]) {
      expect(relayFramesContain(relay.frames, needle), needle).toBe(false);
    }

    const readable = await relay.dob.fetch(
      new Request("https://do.internal/api/v1/system/config", {
        headers: { [GATE_AUTH_HEADER]: "session" },
      }),
    );
    expect(readable.status).toBe(200);
    expect(await readable.json()).toEqual({ title: SECRET_RESPONSE });
    expect(relayFramesContain(relay.frames, SECRET_RESPONSE)).toBe(true);
  });

  it("refuses readable API traffic once encryption is required but still relays sealed channels", async () => {
    const relay = createRelay(origin, () => true);
    const tunnel = await relay.connectTunnel();
    cleanups.push(() => tunnel.session.dispose());

    const refused = await relay.dob.fetch(
      new Request("https://do.internal/api/v1/system/config", {
        headers: { [GATE_AUTH_HEADER]: "session" },
      }),
    );
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ code: "sealed_required" });

    const client = await connectSealedVisitor(relay);
    cleanups.push(() => client.close());
    const config = await sealedFetch(
      client,
      "https://sawyer.getbb.app/api/v1/system/config",
      undefined,
      {
        origin: "https://sawyer.getbb.app",
      },
    );
    expect(await config.json()).toEqual({ title: SECRET_RESPONSE });
    expect(origin.requests).toEqual(["GET /api/v1/system/config"]);
  });

  it("admits devices through the real registry: pending until approved by code, revoked devices are cut off", async () => {
    await origin.access.setRequired(true);
    const relay = createRelay(origin, () => origin.access.required);
    const tunnel = await relay.connectTunnel();
    cleanups.push(() => tunnel.session.dispose());

    const stranger = generateSigningKeyPair();
    expect(await handshakeOutcome(relay, stranger)).toBe("pending");
    const pending = await origin.access.listDevices();
    expect(pending.map((device) => device.status)).toEqual(["pending"]);

    const code = await origin.access.createDeviceCode();
    const client = await connectSealedVisitor(relay, {
      device: stranger,
      deviceCode: code.code,
    });
    const closed = new Promise<string>((resolve) =>
      client.onClose((_code, reason) => resolve(reason)),
    );
    const config = await sealedFetch(
      client,
      "https://sawyer.getbb.app/api/v1/system/config",
      undefined,
      { origin: "https://sawyer.getbb.app" },
    );
    expect(config.status).toBe(200);
    expect(relayFramesContain(relay.frames, SECRET_RESPONSE)).toBe(false);
    const approved = await origin.access.listDevices();
    expect(approved[0]).toMatchObject({
      status: "approved",
      approvedVia: "device-code",
    });

    await origin.access.revokeDevice(approved[0]!.id);
    expect(await closed).toBe("device revoked");
    expect(await handshakeOutcome(relay, stranger)).toBe("rejected");
  });

  it("recovers after the server's tunnel reconnects: the sealed client is closed and can re-handshake", async () => {
    const relay = createRelay(origin, () => false);
    const first = await relay.connectTunnel();
    const client = await connectSealedVisitor(relay);
    const closed = new Promise<number>((resolve) =>
      client.onClose((code) => resolve(code)),
    );

    const second = await relay.connectTunnel();
    cleanups.push(
      () => second.session.dispose(),
      () => first.session.dispose(),
    );
    expect(await closed).toBe(1001);
    expect(client.isOpen).toBe(false);

    const again = await connectSealedVisitor(relay);
    cleanups.push(() => again.close());
    const config = await sealedFetch(
      again,
      "https://sawyer.getbb.app/api/v1/system/config",
      undefined,
      {
        origin: "https://sawyer.getbb.app",
      },
    );
    expect(config.status).toBe(200);
  });
});
