import { createServer, type Server } from "node:http";
import { connect } from "node:net";
import { Writable, type Duplex } from "node:stream";
import { afterEach, expect, it, vi } from "vitest";
import {
  Agent,
  EnvHttpProxyAgent,
  getGlobalDispatcher,
  setGlobalDispatcher,
} from "undici";

import { cliFetch } from "../client.js";
import { runPluginCliCommand } from "../plugin-cli-proxy.js";

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
  {
    name: "Node's environment proxy is on",
    nodeEnvProxy: true,
    hostname: "bb-proxy-regression.invalid",
  },
  {
    name: "a proxy variable is set but Node's environment proxy is off",
    nodeEnvProxy: false,
    hostname: "127.0.0.1",
  },
])(
  "routes plugin command POSTs like core requests when $name",
  async ({ nodeEnvProxy, hostname }) => {
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
    const tunnels = new Set<string>();
    const sockets = new Set<Duplex>();
    const origin = createServer((request, response) => {
      requests.push(`${request.method} ${request.url}`);
      request.resume();
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ exitCode: 0, stdout: "command result" }));
    });
    const proxy = createServer();
    const previousDispatcher = getGlobalDispatcher();
    try {
      const originPort = await listen(origin);
      proxy.on("connect", (request, downstream, head) => {
        tunnels.add(request.url ?? "");
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
      vi.stubEnv("HTTP_PROXY", `http://127.0.0.1:${proxyPort}`);
      setGlobalDispatcher(nodeEnvProxy ? new EnvHttpProxyAgent() : new Agent());
      const baseUrl = `http://${hostname}:${originPort}`;
      const writes: string[] = [];
      const stream = new Writable({
        write(chunk, _encoding, callback) {
          writes.push(chunk.toString());
          callback();
        },
      });

      const coreResponse = await cliFetch(`${baseUrl}/api/v1/machines`);
      await coreResponse.arrayBuffer();
      await expect(
        runPluginCliCommand(baseUrl, "transport-fixture", ["inspect"], {
          stdout: stream,
          stderr: stream,
        }),
      ).resolves.toBe(0);

      expect(writes).toEqual(["command result\n"]);
      expect(requests).toEqual([
        "GET /api/v1/machines",
        "POST /api/v1/plugins/transport-fixture/cli",
      ]);
      expect([...tunnels]).toEqual(
        nodeEnvProxy ? [`${hostname}:${originPort}`] : [],
      );
    } finally {
      setGlobalDispatcher(previousDispatcher);
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
