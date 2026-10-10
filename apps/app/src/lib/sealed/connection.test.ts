import { afterEach, describe, expect, it, vi } from "vitest";
import {
  acceptSealedChannel,
  decodeFrame,
  encodeFrame,
  base64UrlEncode,
  deviceCodeAck,
  generateSigningKeyPair,
  keyFingerprint,
  localDeviceIdentity,
  verifyDeviceCodeProof,
  type ClientAuthRequest,
  type HandshakeOutcome,
  type SigningKeyPair,
} from "@bb/sealed-channel";
import { SealedConnection, SealedHandshakeError } from "./connection";
import type { SealedTrustRecord, SealedTrustStore } from "./trust-store";

interface FakeServer {
  identity: SigningKeyPair;
  authorize: (request: ClientAuthRequest) => HandshakeOutcome;
  sockets: FakeWebSocket[];
}

class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static server: FakeServer | null = null;
  binaryType = "blob";
  readyState = 0;
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  private acceptor: ReturnType<typeof acceptSealedChannel> | null = null;
  private closed = false;

  constructor(readonly url: string) {
    const server = FakeWebSocket.server;
    if (server === null) throw new Error("no server");
    server.sockets.push(this);
    const socket = this;
    this.acceptor = acceptSealedChannel({
      socket: {
        send(data) {
          const copy = data.slice().buffer;
          queueMicrotask(() => socket.onmessage?.({ data: copy }));
        },
        close(code, reason) {
          socket.serverClose(code ?? 1000, reason ?? "");
        },
        get readyState() {
          return socket.closed ? 3 : 1;
        },
      },
      identity: server.identity,
      authorize: async (request) => server.authorize(request),
      onEstablished(channel) {
        channel.transport.on("message", (data, isBinary) => {
          if (!isBinary) return;
          const frame = decodeFrame(data);
          if (frame.type !== "open-http") return;
          channel.transport.send(
            encodeFrame({
              type: "resp-head",
              streamId: frame.streamId,
              status: 200,
              headers: [],
            }),
          );
          channel.transport.send(
            encodeFrame({
              type: "body-chunk",
              streamId: frame.streamId,
              data: new TextEncoder().encode(`ok:${frame.path}`),
            }),
          );
          channel.transport.send(
            encodeFrame({ type: "body-end", streamId: frame.streamId }),
          );
        });
      },
    });
    setTimeout(() => {
      this.readyState = 1;
      this.onopen?.({});
    }, 0);
  }

  send(data: ArrayBuffer): void {
    void this.acceptor?.onMessage(new Uint8Array(data));
  }

  close(code = 1000, reason = ""): void {
    if (this.closed) return;
    this.closed = true;
    this.readyState = 3;
    this.acceptor?.onClose(code, reason);
    queueMicrotask(() => this.onclose?.({ code, reason }));
  }

  serverClose(code: number, reason: string): void {
    if (this.closed) return;
    this.closed = true;
    this.readyState = 3;
    queueMicrotask(() => this.onclose?.({ code, reason }));
  }
}

function memoryTrust(
  initial: SealedTrustRecord | null = null,
): SealedTrustStore & { records: Map<string, SealedTrustRecord> } {
  const records = new Map<string, SealedTrustRecord>();
  if (initial !== null) records.set("https://sawyer.getbb.app", initial);
  return {
    records,
    async get(origin) {
      return records.get(origin) ?? null;
    },
    async set(origin, record) {
      records.set(origin, record);
    },
    async clear(origin) {
      records.delete(origin);
    },
  };
}

function createConnection(
  trust: SealedTrustStore,
  expectedServerKey: string | null = null,
  hostVerified = true,
) {
  return new SealedConnection({
    origin: "https://sawyer.getbb.app",
    profile: {
      identity: localDeviceIdentity(generateSigningKeyPair()),
      name: "Test browser",
      surface: "browser",
      delegation: null,
    },
    trust,
    expectedServerKey,
    hostVerified,
    WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
  });
}

describe("SealedConnection", () => {
  afterEach(() => {
    FakeWebSocket.server = null;
    vi.useRealTimers();
  });

  it("pins the server key on first use, proxies requests, and reconnects after a drop", async () => {
    const identity = generateSigningKeyPair();
    FakeWebSocket.server = {
      identity,
      authorize: ({ deviceId }) => ({ status: "ok", deviceId }),
      sockets: [],
    };
    const trust = memoryTrust();
    const connection = createConnection(trust);
    const states: string[] = [];
    connection.subscribe(() => states.push(connection.getState().kind));

    const response = await connection.fetch(
      "https://sawyer.getbb.app/api/v1/system/config",
    );
    expect(await response.text()).toBe("ok:/api/v1/system/config");
    expect(connection.getState()).toMatchObject({
      kind: "ready",
      verified: false,
      fingerprint: keyFingerprint(identity.publicKey),
    });
    const pinned = trust.records.get("https://sawyer.getbb.app");
    expect(pinned).toMatchObject({
      serverKey: base64UrlEncode(identity.publicKey),
      verified: false,
    });

    await connection.markVerified();
    expect(trust.records.get("https://sawyer.getbb.app")?.verified).toBe(true);
    expect(connection.getState()).toMatchObject({
      kind: "ready",
      verified: true,
    });

    FakeWebSocket.server.sockets[0]!.serverClose(1001, "tunnel reconnected");
    await vi.waitFor(() => expect(connection.getState().kind).toBe("offline"));
    const again = await connection.fetch(
      "https://sawyer.getbb.app/api/v1/threads",
    );
    expect(await again.text()).toBe("ok:/api/v1/threads");
    expect(FakeWebSocket.server.sockets).toHaveLength(2);
    expect(states).toContain("offline");
    connection.stop();
  });

  it("refuses a server whose key differs from the pinned one and never falls back", async () => {
    const pinnedIdentity = generateSigningKeyPair();
    const impostor = generateSigningKeyPair();
    FakeWebSocket.server = {
      identity: impostor,
      authorize: ({ deviceId }) => ({ status: "ok", deviceId }),
      sockets: [],
    };
    const trust = memoryTrust({
      serverKey: base64UrlEncode(pinnedIdentity.publicKey),
      fingerprint: keyFingerprint(pinnedIdentity.publicKey),
      verified: true,
      deviceId: null,
      pinnedAt: 1,
    });
    const connection = createConnection(trust);
    await expect(
      connection.fetch("https://sawyer.getbb.app/api/v1/system/config"),
    ).rejects.toThrow("does not match the pinned key");
    expect(connection.getState()).toEqual({
      kind: "key-mismatch",
      expected: keyFingerprint(pinnedIdentity.publicKey),
      actual: keyFingerprint(impostor.publicKey),
      presentedKey: base64UrlEncode(impostor.publicKey),
    });
    expect(trust.records.get("https://sawyer.getbb.app")?.serverKey).toBe(
      base64UrlEncode(pinnedIdentity.publicKey),
    );
    connection.stop();
  });

  it("does not carry a verified mark over to a different key the host now expects", async () => {
    const oldIdentity = generateSigningKeyPair();
    const identity = generateSigningKeyPair();
    FakeWebSocket.server = {
      identity,
      authorize: ({ deviceId }) => ({ status: "ok", deviceId }),
      sockets: [],
    };
    const trust = memoryTrust();
    trust.records.set("https://sawyer.getbb.app", {
      serverKey: base64UrlEncode(oldIdentity.publicKey),
      fingerprint: "OLD",
      verified: true,
      acknowledged: true,
      deviceId: null,
      pinnedAt: 1,
    });
    const connection = createConnection(
      trust,
      base64UrlEncode(identity.publicKey),
      false,
    );
    await connection.ensure();
    expect(connection.getState()).toMatchObject({
      kind: "ready",
      verified: false,
      acknowledged: false,
    });
    connection.stop();
  });

  it("keeps a first-contact pin unacknowledged until the owner confirms or continues", async () => {
    const identity = generateSigningKeyPair();
    FakeWebSocket.server = {
      identity,
      authorize: ({ deviceId }) => ({ status: "ok", deviceId }),
      sockets: [],
    };
    const trust = memoryTrust();
    const connection = createConnection(trust);
    await connection.ensure();
    expect(connection.getState()).toMatchObject({
      kind: "ready",
      verified: false,
      acknowledged: false,
    });
    await connection.acknowledgeUnverified();
    expect(connection.getState()).toMatchObject({ acknowledged: true });
    expect(trust.records.get("https://sawyer.getbb.app")).toMatchObject({
      verified: false,
      acknowledged: true,
    });
    connection.stop();
  });

  it("honours a host-provided expected key and carries the host's verified flag", async () => {
    const identity = generateSigningKeyPair();
    FakeWebSocket.server = {
      identity,
      authorize: ({ deviceId }) => ({ status: "ok", deviceId }),
      sockets: [],
    };
    const trust = memoryTrust();
    const connection = createConnection(
      trust,
      base64UrlEncode(identity.publicKey),
    );
    await connection.ensure();
    expect(connection.getState()).toMatchObject({
      kind: "ready",
      verified: true,
    });
    connection.stop();

    const unverifiedHost = createConnection(
      memoryTrust(),
      base64UrlEncode(identity.publicKey),
      false,
    );
    await unverifiedHost.ensure();
    expect(unverifiedHost.getState()).toMatchObject({
      kind: "ready",
      verified: false,
    });
    unverifiedHost.stop();
  });

  it("stays pending until approved, then enrolls with a device code on demand", async () => {
    const identity = generateSigningKeyPair();
    let approved = false;
    FakeWebSocket.server = {
      identity,
      authorize: ({ deviceId, proof, transcript }) => {
        if (approved) return { status: "ok", deviceId };
        if (
          proof?.kind === "device-code" &&
          verifyDeviceCodeProof("ABCD-EFGH-JKLM", proof, transcript)
        ) {
          approved = true;
          return {
            status: "ok",
            deviceId,
            codeAck: deviceCodeAck("ABCD-EFGH-JKLM", transcript),
          };
        }
        return { status: "pending", deviceId };
      },
      sockets: [],
    };
    const trust = memoryTrust();
    const connection = createConnection(trust);
    await expect(connection.ensure()).rejects.toBeInstanceOf(
      SealedHandshakeError,
    );
    expect(connection.getState()).toMatchObject({ kind: "pending" });
    expect(trust.records.get("https://sawyer.getbb.app")).toMatchObject({
      verified: false,
    });

    connection.useDeviceCode("abcd efgh jklm");
    await vi.waitFor(() => expect(connection.getState().kind).toBe("ready"));
    connection.stop();
  });

  it("reports a rejected device and stops retrying", async () => {
    const identity = generateSigningKeyPair();
    FakeWebSocket.server = {
      identity,
      authorize: ({ deviceId }) => ({
        status: "rejected",
        deviceId,
        reason: "revoked",
      }),
      sockets: [],
    };
    const connection = createConnection(memoryTrust());
    await expect(connection.ensure()).rejects.toBeInstanceOf(
      SealedHandshakeError,
    );
    expect(connection.getState()).toMatchObject({
      kind: "rejected",
      reason: "revoked",
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(FakeWebSocket.server.sockets).toHaveLength(1);
    connection.stop();
  });
});
