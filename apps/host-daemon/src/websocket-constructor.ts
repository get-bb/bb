import http from "node:http";
import https from "node:https";
import { WebSocket as NodeWebSocket } from "ws";

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
): NodeWebSocketConstructor {
  return class EnvProxyWebSocket extends NodeWebSocket {
    constructor(address: string | URL, protocols?: string | string[]) {
      super(address, protocols, { agent: webSocketAgent(address), headers });
    }
  };
}
