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

interface NodeWebSocketConstructorOptions {
  headers: (() => Record<string, string>) | undefined;
  onFrameWritten: () => void;
}

export function createNodeWebSocketConstructor(
  options: NodeWebSocketConstructorOptions,
): NodeWebSocketConstructor {
  const { headers, onFrameWritten } = options;
  return class EnvProxyWebSocket extends NodeWebSocket {
    constructor(address: string | URL, protocols?: string | string[]) {
      super(address, protocols, {
        agent: webSocketAgent(address),
        headers: headers?.(),
        perMessageDeflate: SERVER_WEB_SOCKET_COMPRESSION,
      });
    }

    override send(data: string | Uint8Array): void {
      super.send(data, { compress: typeof data === "string" }, onFrameWritten);
    }
  };
}
