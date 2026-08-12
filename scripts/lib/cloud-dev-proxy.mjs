import { createProxyServer } from "http-proxy-3";

function isClosedConnectionError(error) {
  return (
    error instanceof Error &&
    "code" in error &&
    (error.code === "EPIPE" || error.code === "ECONNRESET")
  );
}

export function createCloudDevProxy({ reportError = console.error } = {}) {
  const proxy = createProxyServer({ ws: true });
  proxy.on("error", (error, _request, connection) => {
    connection?.destroy?.();
    if (!isClosedConnectionError(error)) {
      reportError(
        `bb Cloud dev proxy: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });
  return proxy;
}
