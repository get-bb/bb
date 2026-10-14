import {
  SealedChannelClient,
  SealedDeviceCodeError,
  SealedServerKeyMismatchError,
  base64UrlDecode,
  base64UrlEncode,
  bytesEqual,
  createWebSocketSealedSocket,
  keyFingerprint,
  sealedEndpointUrl,
  type DeviceIdentity,
  type HeaderPair,
  type RejectReason,
  type SealedRequest,
  type SealedResponse,
  type SealedWebSocketStream,
  type WebSocketConstructorLike,
} from "@bb/sealed-channel";
import { z } from "zod";
import type { SealedServerTrust } from "../profiles/profile";
import type {
  RealtimeSocketFactory,
  RealtimeSocketLike,
} from "../realtime/socket";

export const SEALED_ENDPOINT_PATH = "/api/v1/plugins/connect/http/sealed";

const sealedInfoSchema = z.object({ protocolVersion: z.literal(1) });
export const SEALED_INFO_PATH = `${SEALED_ENDPOINT_PATH}/info`;

export type MobileSealedState =
  | { kind: "idle" }
  | { kind: "probing" }
  | { kind: "plaintext"; reason: string; accepted: boolean }
  | { kind: "connecting" }
  | {
      kind: "ready";
      fingerprint: string;
      verified: boolean;
      acknowledged: boolean;
      deviceId: string;
    }
  | { kind: "pending"; fingerprint: string; deviceId: string }
  | { kind: "rejected"; reason: RejectReason; fingerprint: string | null }
  | { kind: "key-mismatch"; expected: string; actual: string }
  | { kind: "offline"; error: string; fingerprint: string | null };

export interface MobileSealedTransportOptions {
  serverUrl: string;
  identity: () => Promise<DeviceIdentity>;
  deviceName: string;
  trust: SealedServerTrust | null;
  deviceCode?: string | null;
  onPinned?: (trust: SealedServerTrust) => void | Promise<void>;
  onStateChange?: (state: MobileSealedState) => void;
  WebSocketImpl?: WebSocketConstructorLike;
  probeFetch?: typeof fetch;
  plaintextFetch?: typeof fetch;
  plaintextSocketFactory?: RealtimeSocketFactory;
}

export interface MobileSealedTransport {
  fetch: typeof fetch;
  socketFactory: RealtimeSocketFactory;
  getState(): MobileSealedState;
  probe(): Promise<"sealed" | "plaintext">;
  useDeviceCode(code: string): void;
  acceptPlaintext(): void;
  markVerified(): Promise<void>;
  acceptUnverified(): Promise<void>;
  dispose(): void;
}

const PROBE_TIMEOUT_MS = 6_000;
const PENDING_RETRY_MS = 5_000;

function headerPairs(init: HeadersInit | undefined): HeaderPair[] {
  const pairs: HeaderPair[] = [];
  if (init === undefined) return pairs;
  if (init instanceof Headers) {
    init.forEach((value, name) => pairs.push([name, value]));
    return pairs;
  }
  if (Array.isArray(init)) {
    for (const [name, value] of init) pairs.push([name, value]);
    return pairs;
  }
  for (const [name, value] of Object.entries(init)) pairs.push([name, value]);
  return pairs;
}

function encodeBody(body: BodyInit | null | undefined): Uint8Array | null {
  if (body === null || body === undefined) return null;
  if (typeof body === "string") return new TextEncoder().encode(body);
  if (body instanceof Uint8Array) return body;
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  if (ArrayBuffer.isView(body)) {
    return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
  }
  throw new TypeError(
    "sealed mobile fetch supports string and binary bodies only",
  );
}

function toResponse(sealed: SealedResponse, url: string): Response {
  const headers = new Headers();
  for (const [name, value] of sealed.headers) {
    const lower = name.toLowerCase();
    if (
      lower === "content-encoding" ||
      lower === "content-length" ||
      lower === "transfer-encoding"
    ) {
      continue;
    }
    headers.append(name, value);
  }
  const body =
    sealed.body === null
      ? null
      : sealed.body instanceof Uint8Array
        ? sealed.body.buffer.slice(
            sealed.body.byteOffset,
            sealed.body.byteOffset + sealed.body.byteLength,
          )
        : null;
  const response = new Response(body as ArrayBuffer | null, {
    status: sealed.status,
    headers,
  });
  try {
    Object.defineProperty(response, "url", { value: url });
  } catch {}
  return response;
}

class SealedRealtimeSocket implements RealtimeSocketLike {
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  onerror: ((event: { message: string | null }) => void) | null = null;
  private stream: SealedWebSocketStream | null = null;
  private state = 0;
  private pendingClose: { code: number; reason: string } | null = null;

  constructor(open: Promise<SealedWebSocketStream>) {
    open
      .then((stream) => {
        if (this.pendingClose !== null) {
          stream.close(this.pendingClose.code, this.pendingClose.reason);
          this.finish(this.pendingClose.code, this.pendingClose.reason);
          return;
        }
        this.stream = stream;
        const markOpen = () => {
          if (this.state !== 0) return;
          this.state = 1;
          this.onopen?.();
        };
        stream.onOpen = markOpen;
        if (stream.readyState === 1) markOpen();
        stream.onMessage = (data) => {
          this.onmessage?.({
            data:
              typeof data === "string" ? data : new TextDecoder().decode(data),
          });
        };
        stream.onClose = (code, reason) => this.finish(code, reason);
        stream.onError = (error) => this.onerror?.({ message: error.message });
      })
      .catch((error: unknown) => {
        this.onerror?.({
          message: error instanceof Error ? error.message : String(error),
        });
        this.finish(1006, "sealed channel unavailable");
      });
  }

  get readyState(): number {
    return this.state;
  }

  send(data: string): void {
    if (this.stream === null || this.state !== 1) return;
    this.stream.send(data);
  }

  close(code = 1000, reason = ""): void {
    if (this.state >= 2) return;
    if (this.stream === null) {
      this.pendingClose = { code, reason };
      this.state = 2;
      return;
    }
    this.state = 2;
    this.stream.close(code, reason);
  }

  private finish(code: number, reason: string): void {
    if (this.state === 3) return;
    this.state = 3;
    this.onclose?.({ code, reason });
  }
}

export function createMobileSealedTransport(
  options: MobileSealedTransportOptions,
): MobileSealedTransport {
  const origin = new URL(options.serverUrl).origin;
  const WebSocketImpl =
    options.WebSocketImpl ?? (WebSocket as unknown as WebSocketConstructorLike);
  const plaintextFetch = options.plaintextFetch ?? fetch;
  let trust = options.trust;
  let deviceCode = options.deviceCode ?? null;
  let state: MobileSealedState = { kind: "idle" };
  let client: SealedChannelClient | null = null;
  let connecting: Promise<SealedChannelClient> | null = null;
  let policy: "sealed" | "plaintext" | null = trust === null ? null : "sealed";
  let plaintextAccepted = false;
  let plaintextConsent: Promise<void> | null = null;
  let grantPlaintextConsent: (() => void) | null = null;
  let firstContactConsent: Promise<void> | null = null;
  let grantFirstContactConsent: (() => void) | null = null;

  const firstContactSettled = (): boolean =>
    trust !== null && (trust.verified || trust.acknowledged === true);

  function awaitFirstContactConsent(): Promise<void> {
    if (firstContactSettled()) return Promise.resolve();
    firstContactConsent ??= new Promise<void>((resolve) => {
      grantFirstContactConsent = resolve;
    });
    return firstContactConsent;
  }

  async function persistTrust(next: SealedServerTrust): Promise<void> {
    await options.onPinned?.(next);
    trust = next;
    if (state.kind === "ready") {
      setState({
        ...state,
        verified: next.verified,
        acknowledged: next.verified || next.acknowledged === true,
      });
    }
    if (firstContactSettled()) grantFirstContactConsent?.();
  }
  let disposed = false;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  const setState = (next: MobileSealedState) => {
    state = next;
    options.onStateChange?.(next);
  };

  async function decidePolicy(): Promise<"sealed" | "plaintext"> {
    if (policy !== null) return policy;
    setState({ kind: "probing" });
    try {
      const probe = options.probeFetch ?? plaintextFetch;
      const response = await probe(`${origin}${SEALED_INFO_PATH}`, {
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });
      if (response.ok) {
        const info = sealedInfoSchema.safeParse(await response.json());
        if (info.success) {
          policy = "sealed";
          return policy;
        }
      }
      if (response.status === 404) {
        policy = "plaintext";
        setState({
          kind: "plaintext",
          reason: "this bb does not offer end-to-end encryption yet",
          accepted: plaintextAccepted,
        });
        return policy;
      }
      throw new Error(`sealed info returned ${response.status}`);
    } catch (error) {
      setState({
        kind: "offline",
        error: error instanceof Error ? error.message : String(error),
        fingerprint: null,
      });
      throw error;
    }
  }

  function awaitPlaintextConsent(): Promise<void> {
    if (plaintextAccepted) return Promise.resolve();
    plaintextConsent ??= new Promise<void>((resolve) => {
      grantPlaintextConsent = resolve;
    });
    return plaintextConsent;
  }

  async function connect(): Promise<SealedChannelClient> {
    setState({ kind: "connecting" });
    const identity = await options.identity();
    const pinned = trust === null ? null : base64UrlDecode(trust.serverKey);
    const socket = createWebSocketSealedSocket(
      sealedEndpointUrl(origin, SEALED_ENDPOINT_PATH),
      WebSocketImpl,
    );
    const seen: { mismatch: { expected: string; actual: string } | null } = {
      mismatch: null,
    };
    try {
      const connection = await SealedChannelClient.connect({
        socket,
        device: identity,
        deviceName: options.deviceName,
        surface: "mobile",
        ...(deviceCode !== null ? { deviceCode } : {}),
        verifyServerKey: (key) => {
          if (pinned !== null && !bytesEqual(pinned, key)) {
            seen.mismatch = {
              expected: keyFingerprint(pinned),
              actual: keyFingerprint(key),
            };
            return "reject";
          }
          return "accept";
        },
        supportsStreaming: false,
      });
      const fingerprint = keyFingerprint(connection.serverPublicKey);
      if (connection.outcome.status === "pending") {
        if (trust === null) {
          const pinned = {
            serverKey: base64UrlEncode(connection.serverPublicKey),
            fingerprint,
            verified: false,
          };
          await options.onPinned?.(pinned);
          trust = pinned;
        }
        setState({
          kind: "pending",
          fingerprint,
          deviceId: connection.outcome.deviceId,
        });
        scheduleRetry();
        throw new Error("sealed device pending approval");
      }
      if (connection.client === null || connection.outcome.status !== "ok") {
        deviceCode = null;
        setState({
          kind: "rejected",
          reason:
            connection.outcome.status === "rejected"
              ? connection.outcome.reason
              : "protocol",
          fingerprint,
        });
        throw new Error("sealed device rejected");
      }
      const usedCode = deviceCode !== null;
      deviceCode = null;
      if (trust === null || usedCode || trust.deviceCode !== undefined) {
        const pinned: SealedServerTrust = {
          serverKey: base64UrlEncode(connection.serverPublicKey),
          fingerprint,
          verified: usedCode || (trust?.verified ?? false),
          ...(trust?.acknowledged === true ? { acknowledged: true } : {}),
        };
        try {
          await options.onPinned?.(pinned);
        } catch (error) {
          connection.client.close(1011, "could not persist the server key");
          throw new Error(
            `could not save this server's key: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
        trust = pinned;
      }
      const ready = connection.client;
      ready.onClose((code, reason) => {
        if (client !== ready) return;
        client = null;
        if (!disposed) {
          setState({
            kind: "offline",
            error: reason || `closed (${code})`,
            fingerprint,
          });
        }
      });
      setState({
        kind: "ready",
        fingerprint,
        verified: trust.verified,
        acknowledged: trust.verified || trust.acknowledged === true,
        deviceId: connection.outcome.deviceId,
      });
      if (firstContactSettled()) grantFirstContactConsent?.();
      return ready;
    } catch (error) {
      if (error instanceof SealedDeviceCodeError) {
        deviceCode = null;
        setState({
          kind: "rejected",
          reason: "invalid-code",
          fingerprint: trust?.fingerprint ?? null,
        });
      } else if (
        error instanceof SealedServerKeyMismatchError &&
        seen.mismatch !== null
      ) {
        setState({ kind: "key-mismatch", ...seen.mismatch });
      } else if (state.kind === "connecting") {
        setState({
          kind: "offline",
          error: error instanceof Error ? error.message : String(error),
          fingerprint: trust?.fingerprint ?? null,
        });
      }
      throw error;
    }
  }

  function scheduleRetry(): void {
    if (retryTimer !== null || disposed) return;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      void ensure().catch(() => {});
    }, PENDING_RETRY_MS);
  }

  function ensure(): Promise<SealedChannelClient> {
    if (client !== null && client.isOpen) return Promise.resolve(client);
    connecting ??= connect()
      .then((connected) => {
        client = connected;
        return connected;
      })
      .finally(() => {
        connecting = null;
      });
    return connecting;
  }

  const sealedFetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
    );
    if (url.origin !== origin) return plaintextFetch(input, init);
    const chosen = await decidePolicy();
    if (chosen === "plaintext") {
      await awaitPlaintextConsent();
      return plaintextFetch(input, init);
    }
    const connected = await ensure();
    await awaitFirstContactConsent();
    const normalized =
      input instanceof Request ? new Request(input, init) : null;
    const method = (init?.method ?? normalized?.method ?? "GET").toUpperCase();
    const headers = headerPairs(init?.headers ?? normalized?.headers);
    headers.push(["accept-encoding", "identity"]);
    const body =
      init?.body !== undefined || normalized === null
        ? encodeBody(init?.body)
        : method === "GET" || method === "HEAD"
          ? null
          : new Uint8Array(await normalized.arrayBuffer());
    const request: SealedRequest = {
      method,
      path: `${url.pathname}${url.search}`,
      headers,
      body,
    };
    const signal = init?.signal ?? normalized?.signal;
    if (signal) request.signal = signal;
    const response = await connected.request(request);
    return toResponse(response, url.href);
  };

  const socketFactory: RealtimeSocketFactory = (rawUrl) => {
    const url = new URL(rawUrl);
    const httpOrigin = `${url.protocol === "wss:" ? "https:" : "http:"}//${url.host}`;
    if (httpOrigin !== origin) {
      return (options.plaintextSocketFactory ?? defaultPlaintextSocket)(rawUrl);
    }
    return new SealedRealtimeSocket(
      decidePolicy().then((chosen) => {
        if (chosen === "plaintext") {
          throw new Error("sealed policy is plaintext");
        }
        return ensure()
          .then(async (connected) => {
            await awaitFirstContactConsent();
            return connected;
          })
          .then((connected) =>
            connected.openWebSocket({ path: `${url.pathname}${url.search}` }),
          );
      }),
    );
  };

  const defaultPlaintextSocket: RealtimeSocketFactory = (url) => {
    const socket = new WebSocket(url);
    const adapter: RealtimeSocketLike = {
      onclose: null,
      onerror: null,
      onmessage: null,
      onopen: null,
      get readyState() {
        return socket.readyState;
      },
      send: (data) => socket.send(data),
      close: (code, reason) => socket.close(code, reason),
    };
    socket.onopen = () => adapter.onopen?.();
    socket.onmessage = (event) => adapter.onmessage?.({ data: event.data });
    socket.onclose = (event) =>
      adapter.onclose?.({ code: event.code, reason: event.reason });
    socket.onerror = () => adapter.onerror?.({ message: null });
    return adapter;
  };

  const socketFactoryWithPolicy: RealtimeSocketFactory = (rawUrl) => {
    if (policy === "plaintext" && plaintextAccepted) {
      return (options.plaintextSocketFactory ?? defaultPlaintextSocket)(rawUrl);
    }
    return socketFactory(rawUrl);
  };

  return {
    fetch: sealedFetchImpl,
    socketFactory: socketFactoryWithPolicy,
    getState: () => state,
    probe: () => decidePolicy(),
    async markVerified() {
      if (trust === null) return;
      await persistTrust({ ...trust, verified: true, acknowledged: true });
    },
    async acceptUnverified() {
      if (trust === null) return;
      await persistTrust({ ...trust, acknowledged: true });
    },
    acceptPlaintext() {
      plaintextAccepted = true;
      if (state.kind === "plaintext") setState({ ...state, accepted: true });
      grantPlaintextConsent?.();
    },
    useDeviceCode(code) {
      deviceCode = code;
      policy = "sealed";
      client?.close(1000, "re-enrolling with a device code");
      client = null;
      void ensure().catch(() => {});
    },
    dispose() {
      disposed = true;
      if (retryTimer !== null) clearTimeout(retryTimer);
      client?.close(1000, "disposed");
      client = null;
    },
  };
}
