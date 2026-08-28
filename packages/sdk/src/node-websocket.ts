import { WebSocket as NodeWsWebSocket, type RawData } from "ws";
import { z } from "zod";
import { wrapStandardWebsocket } from "./realtime-client.js";
import type { BbRealtimeSocket, BbRealtimeSocketFactory } from "./transport.js";

const websocketMessageDataSchema = z
  .union([
    z.string(),
    z.instanceof(ArrayBuffer),
    z.instanceof(Buffer),
    z.array(z.instanceof(Buffer)),
  ])
  .transform((data) => {
    if (data instanceof ArrayBuffer) {
      return Buffer.from(new Uint8Array(data)).toString("utf8");
    }
    if (Buffer.isBuffer(data)) {
      return data.toString("utf8");
    }
    if (Array.isArray(data)) {
      return Buffer.concat(data).toString("utf8");
    }
    return data;
  });

function decodeWsMessageData(data: RawData): string {
  return websocketMessageDataSchema.parse(data);
}

export function wrapNodeWsWebsocket(url: string): BbRealtimeSocket {
  const socket = new NodeWsWebSocket(url);
  const adapter: BbRealtimeSocket = {
    close: () => socket.close(),
    onclose: null,
    onerror: null,
    onmessage: null,
    onopen: null,
    get readyState() {
      return socket.readyState;
    },
    send: (data) => socket.send(data),
  };
  socket.on("open", () => adapter.onopen?.());
  socket.on("message", (data) =>
    adapter.onmessage?.({ data: decodeWsMessageData(data) }),
  );
  socket.on("close", () => adapter.onclose?.());
  socket.on("error", () => adapter.onerror?.());
  return adapter;
}

export function createNodeWebsocketFactory(): BbRealtimeSocketFactory {
  return (url) => {
    const standardWebSocket = globalThis.WebSocket;
    if (standardWebSocket !== undefined) {
      return wrapStandardWebsocket(new standardWebSocket(url));
    }
    return wrapNodeWsWebsocket(url);
  };
}
