import { createServer, type Server } from "node:http";
import { connect } from "node:net";
import { Writable, type Duplex } from "node:stream";
import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
});

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Expected a TCP server address");
  }
  return address.port;
}

it.each([
  { name: "HTTP_PROXY", proxyKey: "HTTP_PROXY", bypassKey: undefined },
  { name: "http_proxy", proxyKey: "http_proxy", bypassKey: undefined },
  { name: "NO_PROXY", proxyKey: "HTTP_PROXY", bypassKey: "NO_PROXY" },
  { name: "no_proxy", proxyKey: "http_proxy", bypassKey: "no_proxy" },
  { name: "no proxy configured", proxyKey: undefined, bypassKey: undefined },
])(
  "routes plugin command POSTs according to $name",
  async ({ proxyKey, bypassKey }) => {
    vi.resetModules();
    for (const key of [
      "HTTP_PROXY",
      "HTTPS_PROXY",
      "http_proxy",
      "https_proxy",
      "NO_PROXY",
      "no_proxy",
    ]) {
      vi.stubEnv(key, undefined);
    }
    const requests: string[] = [];
    const tunnels: string[] = [];
    const sockets = new Set<Duplex>();
    const origin = createServer((request, response) => {
      requests.push(`${request.method} ${request.url}`);
      request.resume();
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({ exitCode: 0, stdout: "proxied command result" }),
      );
    });
    const proxy = createServer();
    try {
      const originPort = await listen(origin);
      proxy.on("connect", (request, downstream, head) => {
        tunnels.push(request.url ?? "");
        const upstream = connect(originPort, "127.0.0.1", () => {
          downstream.write("HTTP/1.1 200 Connection Established\r\n\r\n");
          upstream.write(head);
          upstream.pipe(downstream);
          downstream.pipe(upstream);
        });
        sockets.add(downstream);
        sockets.add(upstream);
        downstream.on("error", () => upstream.destroy());
        upstream.on("error", () => downstream.destroy());
      });
      const proxyPort = await listen(proxy);
      if (proxyKey !== undefined) {
        vi.stubEnv(proxyKey, `http://127.0.0.1:${proxyPort}`);
      }
      if (bypassKey !== undefined) {
        vi.stubEnv(bypassKey, "127.0.0.1");
      }
      const shouldProxy = proxyKey !== undefined && bypassKey === undefined;
      const hostname = shouldProxy
        ? "bb-proxy-regression.invalid"
        : "127.0.0.1";
      const writes: string[] = [];
      const stream = new Writable({
        write(chunk, _encoding, callback) {
          writes.push(chunk.toString());
          callback();
        },
      });
      const { runPluginCliCommand } = await import("../plugin-cli-proxy.js");

      await expect(
        runPluginCliCommand(
          `http://${hostname}:${originPort}`,
          "transport-fixture",
          ["inspect"],
          { stdout: stream, stderr: stream },
        ),
      ).resolves.toBe(0);
      expect(writes).toEqual(["proxied command result\n"]);
      expect(requests).toEqual(["POST /api/v1/plugins/transport-fixture/cli"]);
      expect(tunnels).toEqual(shouldProxy ? [`${hostname}:${originPort}`] : []);
    } finally {
      for (const socket of sockets) socket.destroy();
      origin.closeAllConnections();
      proxy.closeAllConnections();
      await Promise.all(
        [origin, proxy].map(
          (server) =>
            new Promise<void>((resolve) => server.close(() => resolve())),
        ),
      );
    }
  },
);
