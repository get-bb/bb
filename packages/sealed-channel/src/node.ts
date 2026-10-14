import { WebSocket as NodeWebSocket } from "ws";
import { toUint8Array } from "./bytes.js";
import type { SealedSocket } from "./transport.js";

export interface NodeSealedSocketOptions {
  headers?: Record<string, string>;
  handshakeTimeoutMs?: number;
}

export function createNodeSealedSocket(
  url: string,
  options: NodeSealedSocketOptions = {},
): SealedSocket {
  const ws = new NodeWebSocket(url, {
    headers: options.headers ?? {},
    handshakeTimeout: options.handshakeTimeoutMs ?? 15_000,
  });
  const socket: SealedSocket = {
    send(data) {
      ws.send(data);
    },
    close(code = 1000, reason = "") {
      if (
        ws.readyState === NodeWebSocket.OPEN ||
        ws.readyState === NodeWebSocket.CONNECTING
      ) {
        try {
          ws.close(code, reason);
        } catch {
          ws.terminate();
        }
      }
    },
    onOpen: null,
    onMessage: null,
    onClose: null,
    onError: null,
  };
  ws.on("open", () => socket.onOpen?.());
  ws.on(
    "message",
    (data: Buffer | ArrayBuffer | Buffer[], isBinary: boolean) => {
      if (!isBinary) return;
      const bytes = Array.isArray(data)
        ? Buffer.concat(data)
        : data instanceof ArrayBuffer
          ? new Uint8Array(data)
          : data;
      socket.onMessage?.(toUint8Array(bytes));
    },
  );
  ws.on("close", (code: number, reason: Buffer) =>
    socket.onClose?.(code, reason.toString()),
  );
  ws.on("error", (error: Error) => socket.onError?.(error));
  ws.on("unexpected-response", (_request, response) => {
    response.resume();
    socket.onError?.(
      new Error(
        `sealed-channel: websocket rejected with HTTP ${response.statusCode ?? 0}`,
      ),
    );
    ws.terminate();
  });
  return socket;
}
