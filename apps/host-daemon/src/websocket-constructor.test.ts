import { spawn } from "node:child_process";
import http from "node:http";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocketServer } from "ws";

const moduleUrl = new URL("./websocket-constructor.ts", import.meta.url).href;
const envProxySupported =
  process.allowedNodeEnvironmentFlags.has("--use-env-proxy");

interface Fixture {
  proxyPort: number;
  targetPort: number;
  proxyLog: string[];
  close(): Promise<void>;
}

const fixtures: Fixture[] = [];

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.close()));
});

async function listen(server: http.Server | net.Server): Promise<number> {
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("expected a TCP address");
  }
  return address.port;
}

async function startFixture(): Promise<Fixture> {
  const proxyLog: string[] = [];
  const sockets = new Set<net.Socket>();
  const target = http.createServer();
  const websocketServer = new WebSocketServer({ noServer: true });
  target.on("upgrade", (request, socket, head) => {
    websocketServer.handleUpgrade(request, socket, head, (websocket) => {
      websocket.send(`header=${request.headers["x-bb-test"] ?? "none"}`);
    });
  });
  const targetPort = await listen(target);

  const proxy = http.createServer((request, response) => {
    proxyLog.push(`GET ${request.url}`);
    response.writeHead(502).end();
  });
  proxy.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  proxy.on("upgrade", (request, client, head) => {
    const url = new URL(request.url ?? "");
    proxyLog.push(`UPGRADE ${url.host}`);
    const upstream = net.connect(targetPort, "127.0.0.1", () => {
      const headerLines: string[] = [];
      for (let index = 0; index < request.rawHeaders.length; index += 2) {
        headerLines.push(
          `${request.rawHeaders[index]}: ${request.rawHeaders[index + 1]}`,
        );
      }
      upstream.write(
        `GET ${url.pathname}${url.search} HTTP/1.1\r\n${headerLines.join("\r\n")}\r\n\r\n`,
      );
      upstream.write(head);
      upstream.pipe(client);
      client.pipe(upstream);
    });
    sockets.add(upstream);
    upstream.once("close", () => sockets.delete(upstream));
    upstream.on("error", () => client.destroy());
    client.on("error", () => upstream.destroy());
  });
  proxy.on("connect", (request, client) => {
    proxyLog.push(`CONNECT ${request.url}`);
    client.end("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n");
  });
  const proxyPort = await listen(proxy);

  return {
    proxyPort,
    targetPort,
    proxyLog,
    async close() {
      for (const socket of sockets) socket.destroy();
      for (const client of websocketServer.clients) client.terminate();
      await new Promise<void>((resolve) =>
        websocketServer.close(() => resolve()),
      );
      await Promise.all(
        [proxy, target].map(
          (server) =>
            new Promise<void>((resolve) => server.close(() => resolve())),
        ),
      );
    },
  };
}

async function dialInChild(
  fixture: Fixture,
  dials: { name: string; url: string; headers?: Record<string, string> }[],
): Promise<Record<string, string>> {
  const script = `
    const { createNodeWebSocketConstructor } = await import(${JSON.stringify(moduleUrl)});
    const dials = ${JSON.stringify(dials)};
    const results = {};
    for (const dial of dials) {
      const WebSocket = createNodeWebSocketConstructor(dial.headers);
      results[dial.name] = await new Promise((resolve) => {
        const socket = new WebSocket(dial.url);
        const timer = setTimeout(() => { socket.terminate(); resolve("timeout"); }, 5000);
        socket.on("message", (data) => { clearTimeout(timer); socket.close(); resolve(String(data)); });
        socket.on("error", (error) => { clearTimeout(timer); resolve("error " + (error.code ?? error.message)); });
      });
    }
    console.log(JSON.stringify(results));
  `;
  const proxyUrl = `http://127.0.0.1:${fixture.proxyPort}`;
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HTTP_PROXY: proxyUrl,
    HTTPS_PROXY: proxyUrl,
    NO_PROXY: "localhost,127.0.0.1,::1",
  };
  for (const key of ["http_proxy", "https_proxy", "no_proxy", "ALL_PROXY"]) {
    delete env[key];
  }
  delete env.NODE_OPTIONS;
  delete env.VITEST;

  const child = spawn(
    process.execPath,
    [
      "--use-env-proxy",
      "--conditions=source",
      "--import",
      "tsx",
      "--input-type=module",
      "-e",
      script,
    ],
    {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      env,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  if (exitCode !== 0) {
    throw new Error(`child exited with ${exitCode}: ${stderr}`);
  }
  return JSON.parse(stdout.trim().split("\n").at(-1) ?? "");
}

describe.skipIf(!envProxySupported)("createNodeWebSocketConstructor", () => {
  it("routes WebSocket dials through the environment proxy and bypasses it for NO_PROXY loopback", async () => {
    const fixture = await startFixture();
    fixtures.push(fixture);
    const { targetPort } = fixture;

    const results = await dialInChild(fixture, [
      {
        name: "proxied",
        url: `ws://proxy-only.invalid:${targetPort}/socket`,
        headers: { "x-bb-test": "sent" },
      },
      {
        name: "proxiedWithoutHeaders",
        url: `ws://proxy-only-bare.invalid:${targetPort}/socket`,
      },
      {
        name: "secure",
        url: `wss://proxy-only-secure.invalid:${targetPort}/socket`,
      },
      { name: "loopback", url: `ws://127.0.0.1:${targetPort}/socket` },
    ]);

    expect(results).toEqual({
      proxied: "header=sent",
      proxiedWithoutHeaders: "header=none",
      secure: expect.stringMatching(/^error /u),
      loopback: "header=none",
    });
    expect(fixture.proxyLog).toEqual([
      `UPGRADE proxy-only.invalid:${targetPort}`,
      `UPGRADE proxy-only-bare.invalid:${targetPort}`,
      `CONNECT proxy-only-secure.invalid:${targetPort}`,
    ]);
  });
});
