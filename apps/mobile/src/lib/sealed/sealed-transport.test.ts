import { afterEach, describe, expect, it, vi } from "vitest";
import {
  acceptSealedChannel,
  base64UrlEncode,
  decodeFrame,
  deviceCodeAck,
  encodeFrame,
  generateSigningKeyPair,
  keyFingerprint,
  localDeviceIdentity,
  verifyDeviceCodeProof,
  type ClientAuthRequest,
  type HandshakeOutcome,
  type SigningKeyPair,
} from "@bb/sealed-channel";
import type { SealedServerTrust } from "../profiles/profile";
import {
  createMobileSealedTransport,
  type MobileSealedState,
} from "./sealed-transport";

interface FakeServer {
  identity: SigningKeyPair;
  authorize: (request: ClientAuthRequest) => HandshakeOutcome;
  requests: string[];
  sockets: FakeWebSocket[];
}

class FakeWebSocket {
  static server: FakeServer | null = null;
  binaryType = "blob";
  readyState = 0;
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  private acceptor: ReturnType<typeof acceptSealedChannel>;
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
          if (socket.closed) return;
          socket.closed = true;
          socket.readyState = 3;
          queueMicrotask(() =>
            socket.onclose?.({ code: code ?? 1000, reason: reason ?? "" }),
          );
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
          if (frame.type === "open-http") {
            server.requests.push(`${frame.method} ${frame.path}`);
            channel.transport.send(
              encodeFrame({
                type: "resp-head",
                streamId: frame.streamId,
                status: 200,
                headers: [["content-type", "application/json"]],
              }),
            );
            channel.transport.send(
              encodeFrame({
                type: "body-chunk",
                streamId: frame.streamId,
                data: new TextEncoder().encode(
                  JSON.stringify({ path: frame.path }),
                ),
              }),
            );
            channel.transport.send(
              encodeFrame({ type: "body-end", streamId: frame.streamId }),
            );
          }
          if (frame.type === "open-ws") {
            channel.transport.send(
              encodeFrame({
                type: "ws-open-ack",
                streamId: frame.streamId,
                protocol: null,
              }),
            );
          }
          if (frame.type === "ws-data") {
            channel.transport.send(
              encodeFrame({
                type: "ws-data",
                streamId: frame.streamId,
                isBinary: false,
                data: new TextEncoder().encode(
                  `echo:${new TextDecoder().decode(frame.data)}`,
                ),
              }),
            );
          }
        });
      },
    });
    setTimeout(() => {
      this.readyState = 1;
      this.onopen?.({});
    }, 0);
  }

  send(data: ArrayBuffer): void {
    void this.acceptor.onMessage(new Uint8Array(data));
  }

  close(code = 1000, reason = ""): void {
    if (this.closed) return;
    this.closed = true;
    this.readyState = 3;
    this.acceptor.onClose(code, reason);
    queueMicrotask(() => this.onclose?.({ code, reason }));
  }
}

function server(authorize: FakeServer["authorize"]): FakeServer {
  const identity = generateSigningKeyPair();
  FakeWebSocket.server = { identity, authorize, requests: [], sockets: [] };
  return FakeWebSocket.server;
}

function trustFor(
  identity: SigningKeyPair,
  verified = true,
): SealedServerTrust {
  return {
    serverKey: base64UrlEncode(identity.publicKey),
    fingerprint: keyFingerprint(identity.publicKey),
    verified,
  };
}

function transport(
  overrides: Partial<Parameters<typeof createMobileSealedTransport>[0]> = {},
) {
  const states: MobileSealedState[] = [];
  const pinned: SealedServerTrust[] = [];
  const plaintextFetch = vi.fn(
    async () => new Response("plaintext", { status: 200 }),
  );
  const created = createMobileSealedTransport({
    serverUrl: "https://sawyer.getbb.app",
    identity: async () => localDeviceIdentity(generateSigningKeyPair()),
    deviceName: "iPhone",
    trust: null,
    onPinned: (trust) => {
      pinned.push(trust);
    },
    onStateChange: (state) => states.push(state),
    WebSocketImpl: FakeWebSocket as never,
    plaintextFetch: plaintextFetch as unknown as typeof fetch,
    probeFetch: plaintextFetch as unknown as typeof fetch,
    ...overrides,
  });
  return { transport: created, states, pinned, plaintextFetch };
}

describe("createMobileSealedTransport", () => {
  afterEach(() => {
    FakeWebSocket.server = null;
  });

  it("uses the pinned key, relays fetches and realtime, and never touches plaintext fetch", async () => {
    const fake = server(({ deviceId }) => ({ status: "ok", deviceId }));
    const {
      transport: sealed,
      plaintextFetch,
      states,
    } = transport({ trust: trustFor(fake.identity) });
    const response = await sealed.fetch(
      "https://sawyer.getbb.app/api/v1/system/config",
      {
        headers: { "x-bb-app-surface": "mobile" },
      },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ path: "/api/v1/system/config" });
    expect(fake.requests).toEqual(["GET /api/v1/system/config"]);
    expect(plaintextFetch).not.toHaveBeenCalled();
    expect(states.at(-1)).toMatchObject({ kind: "ready", verified: true });

    const socket = sealed.socketFactory("wss://sawyer.getbb.app/ws");
    const echoed = await new Promise<string>((resolve) => {
      socket.onopen = () => socket.send("ping");
      socket.onmessage = (event) => resolve(String(event.data));
    });
    expect(echoed).toBe("echo:ping");
    socket.close();
    sealed.dispose();
  });

  it("probes an unpinned server, pins on first use, and reports pending until approved", async () => {
    let approved = false;
    const fake = server(({ deviceId }) =>
      approved ? { status: "ok", deviceId } : { status: "pending", deviceId },
    );
    const probe = vi.fn(
      async () =>
        new Response(JSON.stringify({ protocolVersion: 1 }), { status: 200 }),
    );
    const {
      transport: sealed,
      pinned,
      states,
    } = transport({ probeFetch: probe as unknown as typeof fetch });
    await expect(
      sealed.fetch("https://sawyer.getbb.app/api/v1/system/config"),
    ).rejects.toThrow("pending");
    expect(probe).toHaveBeenCalledTimes(1);
    expect(pinned).toEqual([trustFor(fake.identity, false)]);
    expect(states.at(-1)).toMatchObject({
      kind: "pending",
      fingerprint: keyFingerprint(fake.identity.publicKey),
    });
    approved = true;
    const settled = { done: false };
    const held = sealed
      .fetch("https://sawyer.getbb.app/api/v1/system/config")
      .then((response) => {
        settled.done = true;
        return response;
      });
    await vi.waitFor(() =>
      expect(states.at(-1)).toMatchObject({
        kind: "ready",
        verified: false,
        acknowledged: false,
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(settled.done).toBe(false);
    expect(fake.requests).toEqual([]);
    await sealed.acceptUnverified();
    const response = await held;
    expect(response.status).toBe(200);
    expect(pinned.at(-1)).toMatchObject({
      verified: false,
      acknowledged: true,
    });
    sealed.dispose();
  });

  it("sends a Request object's method, headers, and body through the channel", async () => {
    const fake = server(({ deviceId }) => ({ status: "ok", deviceId }));
    const { transport: sealed } = transport({ trust: trustFor(fake.identity) });
    const response = await sealed.fetch(
      new Request("https://sawyer.getbb.app/api/v1/threads", {
        method: "POST",
        body: "secret-body",
        headers: { "content-type": "text/plain" },
      }),
    );
    expect(response.status).toBe(200);
    expect(fake.requests).toEqual(["POST /api/v1/threads"]);
    sealed.dispose();
  });

  it("holds readable requests until the user accepts plaintext when the server offers no sealed endpoint and nothing is pinned", async () => {
    server(({ deviceId }) => ({ status: "ok", deviceId }));
    const probe = vi.fn(async () => new Response("nope", { status: 404 }));
    const {
      transport: sealed,
      plaintextFetch,
      states,
    } = transport({ probeFetch: probe as unknown as typeof fetch });
    const settled = { done: false };
    const pending = sealed
      .fetch("https://sawyer.getbb.app/api/v1/system/config")
      .then((response) => {
        settled.done = true;
        return response;
      });
    await vi.waitFor(() =>
      expect(states.at(-1)).toMatchObject({
        kind: "plaintext",
        accepted: false,
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(settled.done).toBe(false);
    expect(plaintextFetch).not.toHaveBeenCalled();
    sealed.acceptPlaintext();
    const response = await pending;
    expect(await response.text()).toBe("plaintext");
    expect(plaintextFetch).toHaveBeenCalledTimes(1);
    expect(states.at(-1)).toMatchObject({ kind: "plaintext", accepted: true });
    sealed.dispose();
  });

  it("refuses a server whose key differs from the pinned key", async () => {
    server(({ deviceId }) => ({ status: "ok", deviceId }));
    const other = generateSigningKeyPair();
    const {
      transport: sealed,
      plaintextFetch,
      states,
    } = transport({ trust: trustFor(other) });
    await expect(
      sealed.fetch("https://sawyer.getbb.app/api/v1/system/config"),
    ).rejects.toThrow("pinned key");
    expect(states.at(-1)).toMatchObject({
      kind: "key-mismatch",
      expected: keyFingerprint(other.publicKey),
    });
    expect(plaintextFetch).not.toHaveBeenCalled();
    sealed.dispose();
  });

  it("presents a device code once so QR-paired phones are approved immediately", async () => {
    const proofs: string[] = [];
    const fake = server(({ deviceId, proof, transcript }) => {
      proofs.push(proof?.kind ?? "none");
      if (
        proof?.kind === "device-code" &&
        verifyDeviceCodeProof("ABCD-EFGH-JKLM", proof, transcript)
      ) {
        return {
          status: "ok",
          deviceId,
          codeAck: deviceCodeAck("ABCD-EFGH-JKLM", transcript),
        };
      }
      return { status: "pending", deviceId };
    });
    const { transport: sealed } = transport({
      trust: trustFor(fake.identity),
      deviceCode: "ABCD-EFGH-JKLM",
    });
    await sealed.fetch("https://sawyer.getbb.app/api/v1/system/config");
    expect(proofs).toEqual(["device-code"]);
    sealed.dispose();
  });
});
