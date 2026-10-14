import { HEARTBEAT_REQUEST, HEARTBEAT_RESPONSE } from "@bb/tunnel-contract";
import { toUint8Array } from "./bytes.js";
import {
  MESSAGE_KIND,
  SealedProtocolError,
  ServerHandshake,
  messageKind,
  type ClientAuthRequest,
  type HandshakeOutcome,
  type SealedSession,
} from "./protocol.js";
import type { SigningKeyPair } from "./crypto.js";
import { decodeControl, encodeControl } from "./transport.js";

export interface SealedServerSocket {
  send(data: Uint8Array): void;
  close(code?: number, reason?: string): void;
  readonly readyState: number;
}

type TransportListener =
  | ((data: Uint8Array, isBinary: boolean) => void)
  | (() => void);

export interface SealedServerTransport {
  readonly readyState: number;
  send(data: Uint8Array | string): void;
  on(
    event: "message",
    listener: (data: Uint8Array, isBinary: boolean) => void,
  ): void;
  on(event: "close", listener: () => void): void;
  terminate(): void;
}

export interface EstablishedSealedChannel {
  deviceId: string;
  transport: SealedServerTransport;
  close(code?: number, reason?: string): void;
}

export interface AcceptSealedChannelOptions {
  socket: SealedServerSocket;
  identity: SigningKeyPair;
  authorize(request: ClientAuthRequest): Promise<HandshakeOutcome>;
  onEstablished(channel: EstablishedSealedChannel): void;
  onRejected?(request: ClientAuthRequest, outcome: HandshakeOutcome): void;
  onProtocolError?(error: Error): void;
}

export interface SealedChannelAcceptor {
  onMessage(data: Uint8Array | string): Promise<void>;
  onClose(code: number, reason: string): void;
  readonly established: boolean;
}

const WS_OPEN = 1;
const textEncoder = new TextEncoder();

class ServerTransport implements SealedServerTransport {
  private readonly messageListeners = new Set<
    (data: Uint8Array, isBinary: boolean) => void
  >();
  private readonly closeListeners = new Set<() => void>();
  private readonly buffered: Array<[Uint8Array, boolean]> = [];
  private closed = false;

  constructor(
    private readonly socket: SealedServerSocket,
    private readonly session: SealedSession,
  ) {}

  get readyState(): number {
    return this.closed ? 3 : this.socket.readyState;
  }

  send(data: Uint8Array | string): void {
    if (this.closed) return;
    if (typeof data === "string") {
      if (data === HEARTBEAT_REQUEST) {
        this.socket.send(this.session.seal(encodeControl({ type: "ping" })));
      }
      return;
    }
    this.socket.send(this.session.seal(data));
  }

  on(event: "message" | "close", listener: TransportListener): void {
    if (event === "message") {
      this.messageListeners.add(
        listener as (data: Uint8Array, isBinary: boolean) => void,
      );
      const queued = this.buffered.splice(0);
      for (const [data, isBinary] of queued) this.emitMessage(data, isBinary);
    } else {
      this.closeListeners.add(listener as () => void);
    }
  }

  terminate(): void {
    this.socket.close(1011, "terminated");
    this.markClosed();
  }

  deliver(message: Uint8Array): void {
    if (this.closed) return;
    let plaintext: Uint8Array;
    try {
      plaintext = this.session.open(message);
    } catch {
      this.socket.close(1002, "sealed data failed authentication");
      this.markClosed();
      return;
    }
    const control = decodeControl(plaintext);
    if (control !== null) {
      if (control.type === "ping") {
        this.socket.send(this.session.seal(encodeControl({ type: "pong" })));
        return;
      }
      this.emitMessage(textEncoder.encode(HEARTBEAT_RESPONSE), false);
      return;
    }
    this.emitMessage(plaintext, true);
  }

  private emitMessage(data: Uint8Array, isBinary: boolean): void {
    if (this.messageListeners.size === 0) {
      this.buffered.push([data, isBinary]);
      return;
    }
    for (const listener of this.messageListeners) listener(data, isBinary);
  }

  markClosed(): void {
    if (this.closed) return;
    this.closed = true;
    for (const listener of [...this.closeListeners]) listener();
  }
}

export function acceptSealedChannel(
  options: AcceptSealedChannelOptions,
): SealedChannelAcceptor {
  const handshake = new ServerHandshake(options.identity);
  let stage: "hello" | "auth" | "authorizing" | "established" | "closed" =
    "hello";
  let transport: ServerTransport | null = null;
  let queue = Promise.resolve();

  const fail = (error: unknown): void => {
    const wrapped =
      error instanceof Error ? error : new SealedProtocolError(String(error));
    options.onProtocolError?.(wrapped);
    stage = "closed";
    try {
      options.socket.close(1002, "sealed handshake failed");
    } catch {}
  };

  const handle = async (raw: Uint8Array | string): Promise<void> => {
    if (stage === "closed") return;
    if (typeof raw === "string") {
      fail(new SealedProtocolError("unexpected text message"));
      return;
    }
    const data = toUint8Array(raw);
    if (stage === "established") {
      transport?.deliver(data);
      return;
    }
    if (stage === "hello") {
      if (messageKind(data) !== MESSAGE_KIND.clientHello) {
        fail(new SealedProtocolError("expected client hello"));
        return;
      }
      options.socket.send(handshake.onClientHello(data));
      stage = "auth";
      return;
    }
    const request = handshake.onClientAuth(data);
    stage = "authorizing";
    const outcome = await options.authorize(request);
    if (stage !== "authorizing" || options.socket.readyState !== WS_OPEN) {
      stage = "closed";
      return;
    }
    const result = handshake.createServerResult(outcome);
    options.socket.send(result.message);
    if (result.session === null || outcome.status !== "ok") {
      stage = "closed";
      options.onRejected?.(request, outcome);
      options.socket.close(1000, `sealed handshake ${outcome.status}`);
      return;
    }
    stage = "established";
    transport = new ServerTransport(options.socket, result.session);
    const established = transport;
    options.onEstablished({
      deviceId: outcome.deviceId,
      transport: established,
      close(code = 1000, reason = "closed") {
        options.socket.close(code, reason);
        established.markClosed();
      },
    });
  };

  return {
    get established() {
      return stage === "established";
    },
    onMessage(data) {
      queue = queue.then(() => handle(data)).catch(fail);
      return queue;
    },
    onClose() {
      stage = "closed";
      transport?.markClosed();
    },
  };
}
