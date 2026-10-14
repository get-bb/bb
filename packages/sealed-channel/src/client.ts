import {
  MAX_CHUNK_BYTES,
  chunkBody,
  decodeFrame,
  encodeFrame,
  type Frame,
  type HeaderPair,
} from "@bb/tunnel-contract";
import { toUint8Array, utf8Decode, utf8Encode } from "./bytes.js";
import {
  ClientHandshake,
  MESSAGE_KIND,
  SealedProtocolError,
  messageKind,
  type DelegationProvider,
  type DeviceIdentity,
  type DeviceSurface,
  type HandshakeOutcome,
  type SealedSession,
} from "./protocol.js";
import {
  decodeControl,
  encodeControl,
  type SealedSocket,
} from "./transport.js";

export class SealedChannelClosedError extends Error {
  constructor(
    readonly code: number,
    readonly reason: string,
  ) {
    super(
      `sealed-channel: channel closed (${code}${reason ? `: ${reason}` : ""})`,
    );
    this.name = "SealedChannelClosedError";
  }
}

export class SealedServerKeyMismatchError extends Error {
  constructor(readonly serverPublicKey: Uint8Array) {
    super("sealed-channel: server identity key does not match the pinned key");
    this.name = "SealedServerKeyMismatchError";
  }
}

export interface SealedRequest {
  method: string;
  path: string;
  headers: HeaderPair[];
  body: Uint8Array | null;
  signal?: AbortSignal;
}

export interface SealedResponse {
  status: number;
  headers: HeaderPair[];
  body: ReadableStream<Uint8Array> | Uint8Array | null;
}

export interface SealedWebSocketStream {
  readonly readyState: number;
  readonly protocol: string;
  send(data: string | Uint8Array): void;
  close(code?: number, reason?: string): void;
  onOpen: (() => void) | null;
  onMessage: ((data: string | Uint8Array) => void) | null;
  onClose: ((code: number, reason: string) => void) | null;
  onError: ((error: Error) => void) | null;
}

export interface OpenSealedWebSocketArgs {
  path: string;
  headers?: HeaderPair[];
  protocols?: string[];
}

export type ServerKeyDecision = "accept" | "reject";

export interface ConnectSealedChannelOptions {
  socket: SealedSocket;
  device: DeviceIdentity;
  deviceName: string;
  surface: DeviceSurface;
  deviceCode?: string;
  delegation?: DelegationProvider;
  verifyServerKey: (
    serverPublicKey: Uint8Array,
  ) => ServerKeyDecision | Promise<ServerKeyDecision>;
  handshakeTimeoutMs?: number;
  supportsStreaming?: boolean;
}

export interface SealedChannelConnection {
  outcome: HandshakeOutcome;
  serverPublicKey: Uint8Array;
  client: SealedChannelClient | null;
}

const WS_CONNECTING = 0;
const WS_OPEN = 1;
const WS_CLOSING = 2;
const WS_CLOSED = 3;
const DEFAULT_HANDSHAKE_TIMEOUT_MS = 15_000;
const NULL_BODY_STATUSES = new Set([101, 204, 205, 304]);

interface PendingHttp {
  method: string;
  resolve: (response: SealedResponse) => void;
  reject: (error: Error) => void;
  controller: ReadableStreamDefaultController<Uint8Array> | null;
  head: { status: number; headers: HeaderPair[] } | null;
  chunks: Uint8Array[];
  onAbort: (() => void) | null;
  signal: AbortSignal | undefined;
}

interface WsStream {
  stream: SealedWebSocketStreamImpl;
}

class SealedWebSocketStreamImpl implements SealedWebSocketStream {
  readyState = WS_CONNECTING;
  protocol = "";
  onOpen: (() => void) | null = null;
  onMessage: ((data: string | Uint8Array) => void) | null = null;
  onClose: ((code: number, reason: string) => void) | null = null;
  onError: ((error: Error) => void) | null = null;

  constructor(
    private readonly streamId: number,
    private readonly owner: SealedChannelClient,
  ) {}

  send(data: string | Uint8Array): void {
    if (this.readyState !== WS_OPEN) {
      throw new Error("sealed-channel: websocket stream is not open");
    }
    const isBinary = typeof data !== "string";
    this.owner.sendFrame({
      type: "ws-data",
      streamId: this.streamId,
      isBinary,
      data: isBinary ? data : utf8Encode(data),
    });
  }

  close(code = 1000, reason = ""): void {
    if (this.readyState === WS_CLOSING || this.readyState === WS_CLOSED) return;
    this.readyState = WS_CLOSING;
    this.owner.closeWsStream(this.streamId, code, reason);
  }

  markOpen(protocol: string | null): void {
    this.readyState = WS_OPEN;
    this.protocol = protocol ?? "";
    this.onOpen?.();
  }

  markClosed(code: number, reason: string): void {
    if (this.readyState === WS_CLOSED) return;
    this.readyState = WS_CLOSED;
    this.onClose?.(code, reason);
  }
}

function supportsStreamingResponses(): boolean {
  if (
    typeof ReadableStream === "undefined" ||
    typeof Response === "undefined"
  ) {
    return false;
  }
  try {
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.close();
        },
      }),
    );
    return response.body !== null;
  } catch {
    return false;
  }
}

export class SealedChannelClient {
  private readonly pendingHttp = new Map<number, PendingHttp>();
  private readonly wsStreams = new Map<number, WsStream>();
  private readonly closeListeners = new Set<
    (code: number, reason: string) => void
  >();
  private nextStreamId = 1;
  private closed: { code: number; reason: string } | null = null;

  private constructor(
    private readonly socket: SealedSocket,
    private readonly session: SealedSession,
    readonly serverPublicKey: Uint8Array,
    readonly deviceId: string,
    private readonly streaming: boolean,
  ) {
    socket.onMessage = (data) => this.onSocketMessage(data);
    socket.onClose = (code, reason) => this.onSocketClose(code, reason);
    socket.onError = (error) => this.onSocketClose(1006, error.message);
  }

  static async connect(
    options: ConnectSealedChannelOptions,
  ): Promise<SealedChannelConnection> {
    const { socket } = options;
    const handshake = new ClientHandshake({
      device: options.device,
      deviceName: options.deviceName,
      surface: options.surface,
      ...(options.deviceCode !== undefined
        ? { deviceCode: options.deviceCode }
        : {}),
      ...(options.delegation !== undefined
        ? { delegation: options.delegation }
        : {}),
    });
    const timeoutMs =
      options.handshakeTimeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS;
    return new Promise<SealedChannelConnection>((resolve, reject) => {
      let settled = false;
      let serverPublicKey: Uint8Array | null = null;
      const timer = setTimeout(() => {
        fail(new SealedProtocolError("handshake timed out"));
        socket.close(1002, "handshake timed out");
      }, timeoutMs);
      const finish = (connection: SealedChannelConnection) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(connection);
      };
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.onMessage = null;
        socket.onClose = null;
        socket.onError = null;
        reject(error);
      };
      let stage: "hello" | "verifying" | "result" = "hello";
      socket.onOpen = () => {
        try {
          socket.send(handshake.start());
        } catch (error) {
          fail(error instanceof Error ? error : new Error(String(error)));
        }
      };
      socket.onError = (error) => fail(error);
      socket.onClose = (code, reason) =>
        fail(new SealedChannelClosedError(code, reason));
      socket.onMessage = (data) => {
        void (async () => {
          try {
            if (stage === "verifying") {
              throw new SealedProtocolError(
                "unexpected message while verifying the server key",
              );
            }
            if (stage === "hello") {
              const identity = handshake.onServerHello(data);
              serverPublicKey = identity.publicKey;
              stage = "verifying";
              const decision = await options.verifyServerKey(
                identity.publicKey,
              );
              if (decision !== "accept") {
                socket.close(4003, "server key rejected");
                fail(new SealedServerKeyMismatchError(identity.publicKey));
                return;
              }
              stage = "result";
              socket.send(await handshake.createClientAuth());
              return;
            }
            const { outcome, session } = handshake.onServerResult(data);
            if (session === null || outcome.status !== "ok") {
              socket.onMessage = null;
              socket.onClose = null;
              socket.onError = null;
              socket.close(1000, `handshake ${outcome.status}`);
              finish({
                outcome,
                serverPublicKey: serverPublicKey!,
                client: null,
              });
              return;
            }
            const client = new SealedChannelClient(
              socket,
              session,
              serverPublicKey!,
              outcome.deviceId,
              options.supportsStreaming ?? supportsStreamingResponses(),
            );
            finish({ outcome, serverPublicKey: serverPublicKey!, client });
          } catch (error) {
            socket.close(1002, "handshake failed");
            fail(error instanceof Error ? error : new Error(String(error)));
          }
        })();
      };
    });
  }

  get isOpen(): boolean {
    return this.closed === null;
  }

  onClose(listener: (code: number, reason: string) => void): () => void {
    this.closeListeners.add(listener);
    return () => {
      this.closeListeners.delete(listener);
    };
  }

  close(code = 1000, reason = "client closed"): void {
    if (this.closed !== null) return;
    this.socket.close(code, reason);
    this.onSocketClose(code, reason);
  }

  request(args: SealedRequest): Promise<SealedResponse> {
    if (this.closed !== null) {
      return Promise.reject(
        new SealedChannelClosedError(this.closed.code, this.closed.reason),
      );
    }
    if (args.signal?.aborted) {
      return Promise.reject(abortError());
    }
    const streamId = this.nextStreamId++;
    return new Promise<SealedResponse>((resolve, reject) => {
      const pending: PendingHttp = {
        method: args.method.toUpperCase(),
        resolve,
        reject,
        controller: null,
        head: null,
        chunks: [],
        onAbort: null,
        signal: args.signal,
      };
      this.pendingHttp.set(streamId, pending);
      if (args.signal !== undefined) {
        pending.onAbort = () => {
          if (!this.pendingHttp.has(streamId)) return;
          this.pendingHttp.delete(streamId);
          this.sendFrame({
            type: "close-stream",
            streamId,
            code: 1000,
            reason: "aborted",
          });
          this.failPending(pending, abortError());
        };
        args.signal.addEventListener("abort", pending.onAbort, { once: true });
      }
      const hasBody = args.body !== null && args.body.length > 0;
      this.sendFrame({
        type: "open-http",
        streamId,
        method: pending.method,
        path: args.path,
        headers: args.headers,
        hasBody,
      });
      if (hasBody) {
        for (const chunk of chunkBody(streamId, args.body!))
          this.sendFrame(chunk);
        this.sendFrame({ type: "body-end", streamId });
      }
    });
  }

  openWebSocket(args: OpenSealedWebSocketArgs): SealedWebSocketStream {
    const streamId = this.nextStreamId++;
    const stream = new SealedWebSocketStreamImpl(streamId, this);
    if (this.closed !== null) {
      queueMicrotask(() =>
        stream.markClosed(this.closed!.code, this.closed!.reason),
      );
      return stream;
    }
    this.wsStreams.set(streamId, { stream });
    this.sendFrame({
      type: "open-ws",
      streamId,
      path: args.path,
      headers: args.headers ?? [],
      protocols: args.protocols ?? [],
    });
    return stream;
  }

  sendFrame(frame: Frame): void {
    if (this.closed !== null) return;
    try {
      this.socket.send(this.session.seal(encodeFrame(frame)));
    } catch (error) {
      this.onSocketClose(
        1006,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  closeWsStream(streamId: number, code: number, reason: string): void {
    const entry = this.wsStreams.get(streamId);
    if (!entry) return;
    this.wsStreams.delete(streamId);
    this.sendFrame({ type: "close-stream", streamId, code, reason });
    entry.stream.markClosed(code, reason);
  }

  private onSocketMessage(data: Uint8Array): void {
    if (this.closed !== null) return;
    if (messageKind(data) !== MESSAGE_KIND.data) {
      this.close(1002, "unexpected message");
      return;
    }
    let plaintext: Uint8Array;
    try {
      plaintext = this.session.open(data);
    } catch (error) {
      this.close(1002, error instanceof Error ? error.message : String(error));
      return;
    }
    const control = decodeControl(plaintext);
    if (control !== null) {
      if (control.type === "ping") {
        this.socket.send(this.session.seal(encodeControl({ type: "pong" })));
      }
      return;
    }
    let frame: Frame;
    try {
      frame = decodeFrame(plaintext);
    } catch {
      this.close(1002, "malformed frame");
      return;
    }
    this.onFrame(frame);
  }

  private onFrame(frame: Frame): void {
    switch (frame.type) {
      case "resp-head": {
        const pending = this.pendingHttp.get(frame.streamId);
        if (!pending || pending.head !== null) return;
        pending.head = { status: frame.status, headers: frame.headers };
        const bodiless =
          NULL_BODY_STATUSES.has(frame.status) || pending.method === "HEAD";
        if (bodiless) {
          this.finishPending(frame.streamId, pending);
          pending.resolve({
            status: frame.status,
            headers: frame.headers,
            body: null,
          });
          return;
        }
        if (!this.streaming) return;
        const body = new ReadableStream<Uint8Array>({
          start: (controller) => {
            pending.controller = controller;
          },
          cancel: () => {
            if (!this.pendingHttp.has(frame.streamId)) return;
            this.finishPending(frame.streamId, pending);
            this.sendFrame({
              type: "close-stream",
              streamId: frame.streamId,
              code: 1000,
              reason: "response body canceled",
            });
          },
        });
        pending.resolve({ status: frame.status, headers: frame.headers, body });
        return;
      }
      case "body-chunk": {
        const pending = this.pendingHttp.get(frame.streamId);
        if (!pending) return;
        const copy = frame.data.slice();
        if (pending.controller !== null) {
          try {
            pending.controller.enqueue(copy);
          } catch {}
        } else {
          pending.chunks.push(copy);
        }
        return;
      }
      case "body-end": {
        const pending = this.pendingHttp.get(frame.streamId);
        if (!pending) return;
        this.finishPending(frame.streamId, pending);
        if (pending.controller !== null) {
          try {
            pending.controller.close();
          } catch {}
          return;
        }
        if (pending.head === null) {
          pending.reject(
            new Error("sealed-channel: response ended before its head"),
          );
          return;
        }
        const total = pending.chunks.reduce(
          (sum, chunk) => sum + chunk.length,
          0,
        );
        const body = new Uint8Array(total);
        let offset = 0;
        for (const chunk of pending.chunks) {
          body.set(chunk, offset);
          offset += chunk.length;
        }
        pending.resolve({
          status: pending.head.status,
          headers: pending.head.headers,
          body,
        });
        return;
      }
      case "close-stream": {
        const pending = this.pendingHttp.get(frame.streamId);
        if (pending) {
          this.finishPending(frame.streamId, pending);
          this.failPending(
            pending,
            new Error(`sealed-channel: request failed: ${frame.reason}`),
          );
          return;
        }
        const ws = this.wsStreams.get(frame.streamId);
        if (ws) {
          this.wsStreams.delete(frame.streamId);
          ws.stream.markClosed(frame.code, frame.reason);
        }
        return;
      }
      case "ws-open-ack": {
        const ws = this.wsStreams.get(frame.streamId);
        ws?.stream.markOpen(frame.protocol);
        return;
      }
      case "ws-data": {
        const ws = this.wsStreams.get(frame.streamId);
        if (!ws) return;
        ws.stream.onMessage?.(
          frame.isBinary ? frame.data.slice() : utf8Decode(frame.data),
        );
        return;
      }
      case "open-http":
      case "open-ws":
        return;
    }
  }

  private finishPending(streamId: number, pending: PendingHttp): void {
    this.pendingHttp.delete(streamId);
    if (pending.onAbort !== null && pending.signal !== undefined) {
      pending.signal.removeEventListener("abort", pending.onAbort);
      pending.onAbort = null;
    }
  }

  private failPending(pending: PendingHttp, error: Error): void {
    if (pending.controller !== null) {
      try {
        pending.controller.error(error);
      } catch {}
      return;
    }
    pending.reject(error);
  }

  private onSocketClose(code: number, reason: string): void {
    if (this.closed !== null) return;
    this.closed = { code, reason };
    const error = new SealedChannelClosedError(code, reason);
    for (const [streamId, pending] of [...this.pendingHttp]) {
      this.finishPending(streamId, pending);
      this.failPending(pending, error);
    }
    for (const [, ws] of [...this.wsStreams]) {
      ws.stream.markClosed(1006, reason);
    }
    this.wsStreams.clear();
    for (const listener of [...this.closeListeners]) listener(code, reason);
  }
}

function abortError(): Error {
  const error = new Error("sealed-channel: request aborted");
  error.name = "AbortError";
  return error;
}

export { MAX_CHUNK_BYTES, toUint8Array };
