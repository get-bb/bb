import { WebSocket as NodeWsWebSocket, type RawData } from "ws";
import {
  createRealtimeSocketAdapter,
  wrapStandardWebsocket,
} from "./realtime-client.js";
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
  return Buffer.from(new Uint8Array(data)).toString("utf8");
}

export function wrapNodeWsWebsocket(
  url: string,
  headers: Readonly<Record<string, string>> = {},
): BbRealtimeSocket {
  const socket = new NodeWsWebSocket(url, { headers });
  const adapter = createRealtimeSocketAdapter(socket);
  socket.on("open", () => adapter.onopen?.());
  socket.on("message", (data) =>
    adapter.onmessage?.({ data: decodeWsMessageData(data) }),
  );
  socket.on("close", () => adapter.onclose?.());
  socket.on("error", () => adapter.onerror?.());
  return adapter;
}

type WebsocketHeaders = Readonly<Record<string, string>>;

export interface CreateNodeWebsocketFactoryArgs {
  headers?: (url: string) => WebsocketHeaders | Promise<WebsocketHeaders>;
}

const WEBSOCKET_CONNECTING = 0;
const WEBSOCKET_CLOSED = 3;

function deferredNodeWsWebsocket(
  url: string,
  headers: Promise<WebsocketHeaders>,
): BbRealtimeSocket {
  let socket: BbRealtimeSocket | null = null;
  let closed = false;
  const adapter: BbRealtimeSocket = {
    close: () => {
      closed = true;
      socket?.close();
    },
    onclose: null,
    onerror: null,
    onmessage: null,
    onopen: null,
    get readyState() {
      return (
        socket?.readyState ?? (closed ? WEBSOCKET_CLOSED : WEBSOCKET_CONNECTING)
      );
    },
    send: (data) => {
      if (socket === null) throw new Error("websocket is not open yet");
      socket.send(data);
    },
  };
  void headers.then(
    (resolved) => {
      if (closed) return;
      const inner = wrapNodeWsWebsocket(url, resolved);
      socket = inner;
      inner.onopen = () => adapter.onopen?.();
      inner.onmessage = (event) => adapter.onmessage?.(event);
      inner.onclose = () => adapter.onclose?.();
      inner.onerror = () => adapter.onerror?.();
    },
    () => {
      closed = true;
      adapter.onerror?.();
      adapter.onclose?.();
    },
  );
  return adapter;
}

export function createNodeWebsocketFactory(
  args: CreateNodeWebsocketFactoryArgs = {},
): BbRealtimeSocketFactory {
  return (url) => {
    const headers = args.headers?.(url) ?? {};
    if (headers instanceof Promise)
      return deferredNodeWsWebsocket(url, headers);
    if (Object.keys(headers).length > 0) {
      return wrapNodeWsWebsocket(url, headers);
    }
    if (typeof WebSocket !== "undefined") {
      return wrapStandardWebsocket(new WebSocket(url));
    }
    return wrapNodeWsWebsocket(url);
  };
}
