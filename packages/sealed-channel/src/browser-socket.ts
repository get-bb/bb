import { toUint8Array } from "./bytes.js";
import type { SealedSocket } from "./transport.js";

export interface WebSocketLike {
  binaryType: string;
  readyState: number;
  send(data: ArrayBuffer | Uint8Array): void;
  close(code?: number, reason?: string): void;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: { code: number; reason: string }) => void) | null;
  onerror: ((event: unknown) => void) | null;
}

export type WebSocketConstructorLike = new (url: string) => WebSocketLike;

export function createWebSocketSealedSocket(
  url: string,
  WebSocketImpl: WebSocketConstructorLike,
): SealedSocket {
  const ws = new WebSocketImpl(url);
  ws.binaryType = "arraybuffer";
  const socket: SealedSocket = {
    send(data) {
      ws.send(
        data.buffer.slice(
          data.byteOffset,
          data.byteOffset + data.byteLength,
        ) as ArrayBuffer,
      );
    },
    close(code = 1000, reason = "") {
      try {
        ws.close(code, reason);
      } catch {}
    },
    onOpen: null,
    onMessage: null,
    onClose: null,
    onError: null,
  };
  ws.onopen = () => socket.onOpen?.();
  ws.onmessage = (event) => {
    const { data } = event;
    if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
      socket.onMessage?.(toUint8Array(data as ArrayBuffer | ArrayBufferView));
    }
  };
  ws.onclose = (event) => socket.onClose?.(event.code, event.reason);
  ws.onerror = () => socket.onError?.(new Error("websocket error"));
  return socket;
}

export function sealedEndpointUrl(origin: string, path: string): string {
  const url = new URL(path, origin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}
