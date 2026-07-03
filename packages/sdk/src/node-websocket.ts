import { WebSocket as NodeWsWebSocket, type RawData } from "ws";
import { wrapStandardWebsocket } from "./realtime-client.js";
import type { BbRealtimeSocket, BbRealtimeSocketFactory } from "./transport.js";

function decodeWsMessageData(data: RawData): string {
  if (typeof data === "string") {
    return data;
  }
  if (Array.isArray(data)) {
    return Buffer.concat(data).toString("utf8");
  }
  if (Buffer.isBuffer(data)) {
    return data.toString("utf8");
  }
  // Remaining case is an ArrayBuffer; go through Uint8Array so every
  // @types/node Buffer.from overload set accepts it.
  return Buffer.from(new Uint8Array(data)).toString("utf8");
}

/**
 * Adapts a `ws`-package WebSocket to the runtime-agnostic socket shape the
 * realtime client consumes.
 */
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

/**
 * Node 22+ ships a global WebSocket; older supported Node versions (20.x)
 * fall back to the `ws` package so bb.on works out of the box everywhere.
 */
export function createNodeWebsocketFactory(): BbRealtimeSocketFactory {
  return (url) => {
    if (typeof WebSocket !== "undefined") {
      return wrapStandardWebsocket(new WebSocket(url));
    }
    return wrapNodeWsWebsocket(url);
  };
}
