import type { SealedWebSocketStream } from "@bb/sealed-channel";

export interface SealedTransportSource {
  readonly origin: string;
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  openWebSocket(
    path: string,
    protocols: string[],
  ): Promise<SealedWebSocketStream>;
}

const WS_CONNECTING = 0;
const WS_OPEN = 1;
const WS_CLOSING = 2;
const WS_CLOSED = 3;

function isSameOrigin(url: URL, origin: string): boolean {
  return url.origin === origin;
}

function resolveRequestUrl(input: RequestInfo | URL): URL | null {
  try {
    if (typeof input === "string") return new URL(input, location.href);
    if (input instanceof URL) return input;
    return new URL(input.url, location.href);
  } catch {
    return null;
  }
}

function websocketOrigin(origin: string): string {
  return origin.replace(/^http/u, "ws");
}

class SealedWebSocketShim extends EventTarget {
  static readonly CONNECTING = WS_CONNECTING;
  static readonly OPEN = WS_OPEN;
  static readonly CLOSING = WS_CLOSING;
  static readonly CLOSED = WS_CLOSED;
  readonly CONNECTING = WS_CONNECTING;
  readonly OPEN = WS_OPEN;
  readonly CLOSING = WS_CLOSING;
  readonly CLOSED = WS_CLOSED;

  readonly url: string;
  binaryType: "blob" | "arraybuffer" = "blob";
  readonly extensions = "";
  readonly bufferedAmount = 0;
  protocol = "";
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  private stream: SealedWebSocketStream | null = null;
  private state: number = WS_CONNECTING;
  private closedBeforeOpen: { code: number; reason: string } | null = null;

  constructor(
    url: string,
    protocols: string | string[] | undefined,
    connection: SealedTransportSource,
  ) {
    super();
    this.url = url;
    const parsed = new URL(url);
    const list =
      protocols === undefined
        ? []
        : Array.isArray(protocols)
          ? protocols
          : [protocols];
    void connection
      .openWebSocket(`${parsed.pathname}${parsed.search}`, list)
      .then((stream) => {
        if (this.closedBeforeOpen !== null) {
          stream.close(
            this.closedBeforeOpen.code,
            this.closedBeforeOpen.reason,
          );
          this.finish(
            this.closedBeforeOpen.code,
            this.closedBeforeOpen.reason,
            false,
          );
          return;
        }
        this.stream = stream;
        const markOpen = () => {
          if (this.state !== WS_CONNECTING) return;
          this.state = WS_OPEN;
          this.protocol = stream.protocol;
          this.emit(new Event("open"), this.onopen);
        };
        stream.onOpen = markOpen;
        if (stream.readyState === WS_OPEN) markOpen();
        stream.onMessage = (data) => {
          const payload =
            typeof data === "string"
              ? data
              : this.binaryType === "arraybuffer"
                ? data.buffer.slice(
                    data.byteOffset,
                    data.byteOffset + data.byteLength,
                  )
                : new Blob([data as BlobPart]);
          this.emit(
            new MessageEvent("message", { data: payload }),
            this.onmessage,
          );
        };
        stream.onClose = (code, reason) =>
          this.finish(code, reason, code === 1000);
        stream.onError = () => this.emit(new Event("error"), this.onerror);
      })
      .catch(() => {
        this.emit(new Event("error"), this.onerror);
        this.finish(1006, "sealed channel unavailable", false);
      });
  }

  get readyState(): number {
    return this.state;
  }

  send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
    if (this.state !== WS_OPEN || this.stream === null) {
      throw new DOMException("WebSocket is not open", "InvalidStateError");
    }
    if (typeof data === "string") {
      this.stream.send(data);
      return;
    }
    if (data instanceof Blob) {
      void data
        .arrayBuffer()
        .then((buffer) => this.stream?.send(new Uint8Array(buffer)));
      return;
    }
    if (ArrayBuffer.isView(data)) {
      this.stream.send(
        new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
      );
      return;
    }
    this.stream.send(new Uint8Array(data));
  }

  close(code = 1000, reason = ""): void {
    if (this.state === WS_CLOSING || this.state === WS_CLOSED) return;
    if (this.stream === null) {
      this.closedBeforeOpen = { code, reason };
      this.state = WS_CLOSING;
      return;
    }
    this.state = WS_CLOSING;
    this.stream.close(code, reason);
  }

  private finish(code: number, reason: string, wasClean: boolean): void {
    if (this.state === WS_CLOSED) return;
    this.state = WS_CLOSED;
    this.emit(
      new CloseEvent("close", { code, reason, wasClean }),
      this.onclose,
    );
  }

  private emit<E extends Event>(
    event: E,
    handler: ((event: E) => void) | null,
  ): void {
    handler?.call(this, event);
    this.dispatchEvent(event);
  }
}

export function installSealedTransport(
  connection: SealedTransportSource,
  target: typeof globalThis = globalThis,
): void {
  const origin = connection.origin;
  const originalFetch = target.fetch;
  const OriginalWebSocket = target.WebSocket;

  const patchedFetch: typeof fetch = (input, init) => {
    const url = resolveRequestUrl(input);
    if (url === null || !isSameOrigin(url, origin)) {
      return originalFetch.call(target, input, init);
    }
    return connection.fetch(input, init);
  };

  const wsOrigin = websocketOrigin(origin);
  const PatchedWebSocket = function (
    this: unknown,
    url: string | URL,
    protocols?: string | string[],
  ) {
    const href = url instanceof URL ? url.href : String(url);
    let parsed: URL | null = null;
    try {
      parsed = new URL(href, location.href);
    } catch {}
    if (parsed !== null && parsed.origin === wsOrigin) {
      return new SealedWebSocketShim(parsed.href, protocols, connection);
    }
    return protocols === undefined
      ? new OriginalWebSocket(href)
      : new OriginalWebSocket(href, protocols);
  } as unknown as typeof WebSocket;
  Object.defineProperties(PatchedWebSocket, {
    CONNECTING: { value: WS_CONNECTING },
    OPEN: { value: WS_OPEN },
    CLOSING: { value: WS_CLOSING },
    CLOSED: { value: WS_CLOSED },
    prototype: { value: OriginalWebSocket.prototype },
  });

  target.fetch = patchedFetch;
  target.WebSocket = PatchedWebSocket;
}
