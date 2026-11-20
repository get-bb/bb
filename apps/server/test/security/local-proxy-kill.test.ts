import http from "node:http";
import net from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import {
  startTestServer,
  type RunningTestServer,
} from "../helpers/test-app.js";

let server: RunningTestServer | undefined;
const closers: (() => Promise<void>)[] = [];

afterEach(async () => {
  while (closers.length > 0) await closers.pop()!();
  await server?.close();
  server = undefined;
});

function listen(target: http.Server | net.Server): Promise<number> {
  return new Promise((resolve) => {
    target.listen(0, "127.0.0.1", () => {
      const address = target.address();
      if (address === null || typeof address === "string") {
        throw new Error("expected a TCP listener");
      }
      closers.push(
        () => new Promise<void>((done) => target.close(() => done())),
      );
      resolve(address.port);
    });
  });
}

function startNginxDefaultProxy(upstreamPort: number): Promise<number> {
  const proxy = http.createServer((request, response) => {
    const headers = { ...request.headers, host: `127.0.0.1:${upstreamPort}` };
    const upstream = http.request(
      {
        host: "127.0.0.1",
        port: upstreamPort,
        method: request.method,
        path: request.url,
        headers: { ...headers, connection: "close" },
      },
      (upstreamResponse) => {
        response.writeHead(
          upstreamResponse.statusCode ?? 502,
          upstreamResponse.headers,
        );
        upstreamResponse.pipe(response);
      },
    );
    request.pipe(upstream);
  });
  return listen(proxy);
}

function startSocatForwarder(upstreamPort: number): Promise<number> {
  const forwarder = net.createServer((client) => {
    const upstream = net.connect(upstreamPort, "127.0.0.1");
    client.pipe(upstream);
    upstream.pipe(client);
    client.on("error", () => upstream.destroy());
    upstream.on("error", () => client.destroy());
  });
  return listen(forwarder);
}

function get(
  port: number,
  path: string,
  headers: Record<string, string>,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const request = http.request(
      { host: "127.0.0.1", port, path, headers, method: "GET" },
      (response) => {
        response.resume();
        resolve(response.statusCode ?? 0);
      },
    );
    request.once("error", reject);
    request.end();
  });
}

describe("nothing on the server machine is trusted for its address", () => {
  it("refuses a remote client that nginx's default proxy_pass hides behind loopback", async () => {
    server = await startTestServer();
    const serverPort = Number(new URL(server.baseUrl).port);
    const proxyPort = await startNginxDefaultProxy(serverPort);
    expect(
      await get(proxyPort, "/api/v1/projects", { host: "bb.example.com" }),
    ).toBe(401);
  });

  it("refuses a remote client that a TCP forwarder relays with its own loopback Host", async () => {
    server = await startTestServer();
    const serverPort = Number(new URL(server.baseUrl).port);
    const forwarderPort = await startSocatForwarder(serverPort);
    expect(
      await get(forwarderPort, "/api/v1/projects", {
        host: `127.0.0.1:${serverPort}`,
      }),
    ).toBe(401);
  });

  it("refuses a bare loopback request with no credential", async () => {
    server = await startTestServer();
    const serverPort = Number(new URL(server.baseUrl).port);
    expect(
      await get(serverPort, "/api/v1/projects", {
        host: `127.0.0.1:${serverPort}`,
      }),
    ).toBe(401);
  });
});
