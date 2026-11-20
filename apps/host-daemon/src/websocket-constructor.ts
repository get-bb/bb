import http from "node:http";
import https from "node:https";
import { constants } from "node:zlib";
import { WebSocket as NodeWebSocket, type PerMessageDeflateOptions } from "ws";

const SERVER_WEB_SOCKET_COMPRESSION: PerMessageDeflateOptions = {
  threshold: 1024,
  zlibDeflateOptions: { level: constants.Z_BEST_SPEED },
};

interface NodeWebSocketConstructor {
  new (address: string | URL, protocols?: string | string[]): object;
}

export function webSocketAgent(address: string | URL): http.Agent {
  const { protocol } = new URL(address);
  return protocol === "wss:" || protocol === "https:"
    ? https.globalAgent
    : http.globalAgent;
}

export function createNodeWebSocketConstructor(
  headers: Record<string, string> | undefined,
  onCreated: (socket: NodeWebSocket) => void,
): NodeWebSocketConstructor {
  return class EnvProxyWebSocket extends NodeWebSocket {
    constructor(address: string | URL, protocols?: string | string[]) {
      super(address, protocols, {
        agent: webSocketAgent(address),
        headers,
        perMessageDeflate: SERVER_WEB_SOCKET_COMPRESSION,
      });
      onCreated(this);
    }
  };
}
