import type { WebSocketServer } from "ws";

const WEB_SOCKET_SHUTDOWN_CODE = 1001;
const WEB_SOCKET_SHUTDOWN_FORCE_CLOSE_MS = 1_000;
const WEB_SOCKET_SHUTDOWN_REASON = "server-shutdown";

export function closeWebSocketServer(server: WebSocketServer): Promise<void> {
  for (const client of server.clients) {
    client.close(WEB_SOCKET_SHUTDOWN_CODE, WEB_SOCKET_SHUTDOWN_REASON);
  }

  return new Promise<void>((resolvePromise, reject) => {
    const forceCloseTimeout = setTimeout(() => {
      for (const client of server.clients) {
        client.terminate();
      }
    }, WEB_SOCKET_SHUTDOWN_FORCE_CLOSE_MS);
    forceCloseTimeout.unref();

    server.close((error) => {
      clearTimeout(forceCloseTimeout);
      if (error) {
        reject(error);
        return;
      }
      resolvePromise();
    });
  });
}
