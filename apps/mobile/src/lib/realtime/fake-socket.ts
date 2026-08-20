import type {
  RealtimeSocketErrorEvent,
  RealtimeSocketFactory,
  RealtimeSocketLike,
  RealtimeSocketOptions,
} from "./socket";

/** Test double for the realtime socket. Not shipped in the app. */
export class FakeSocket implements RealtimeSocketLike {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 3;

  readyState = FakeSocket.CONNECTING;
  readonly sent: string[] = [];
  readonly closes: { code?: number; reason?: string }[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  onerror: ((event: RealtimeSocketErrorEvent) => void) | null = null;

  constructor(
    readonly url: string,
    readonly options: RealtimeSocketOptions,
  ) {}

  send(data: string): void {
    if (this.readyState !== FakeSocket.OPEN) throw new Error("not open");
    this.sent.push(data);
  }

  close(code?: number, reason?: string): void {
    this.closes.push({ code, reason });
    this.readyState = FakeSocket.CLOSED;
  }

  /** Server accepted the upgrade. */
  open(): void {
    this.readyState = FakeSocket.OPEN;
    this.onopen?.();
  }

  /** Server sent a frame. */
  receive(data: unknown): void {
    this.onmessage?.({ data });
  }

  /** Connection dropped (server restart, network loss). */
  drop(code = 1006, reason = ""): void {
    this.readyState = FakeSocket.CLOSED;
    this.onerror?.({ message: null });
    this.onclose?.({ code, reason });
  }

  /**
   * The upgrade was refused. Like React Native ≥ 0.86, the platform's reason
   * rides on the close event; `viaErrorMessage` mimics the older shape where
   * the error event carries it instead.
   */
  reject(message: string, viaErrorMessage = false): void {
    this.readyState = FakeSocket.CLOSED;
    this.onerror?.({ message: viaErrorMessage ? message : null });
    this.onclose?.({ code: 1006, reason: viaErrorMessage ? "" : message });
  }

  sentMessages(): unknown[] {
    return this.sent.map((raw) => JSON.parse(raw) as unknown);
  }
}

export interface FakeSocketFactory extends RealtimeSocketFactory {
  sockets: FakeSocket[];
  latest(): FakeSocket;
}

export function createFakeSocketFactory(): FakeSocketFactory {
  const sockets: FakeSocket[] = [];
  return Object.assign(
    (url: string, options: RealtimeSocketOptions) => {
      const socket = new FakeSocket(url, options);
      sockets.push(socket);
      return socket;
    },
    {
      sockets,
      latest(): FakeSocket {
        const socket = sockets[sockets.length - 1];
        if (!socket) throw new Error("no socket created yet");
        return socket;
      },
    },
  );
}
