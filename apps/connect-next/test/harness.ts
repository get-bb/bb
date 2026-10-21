import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import * as http from "node:http";
import * as net from "node:net";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocketServer } from "ws";
import {
  GATE_ASSERTION_HEADER,
  FRP_CREDENTIAL_META,
  gateAudienceForMachine,
  gateAudienceForServer,
  generateGateKeyPair,
  verifyGateAssertion,
  type GateAssertionResult,
  type GatePresenceRequest,
  type GateResolveRequest,
  type GateResolveResponse,
  type GateResolvedLabel,
} from "@bb/tunnel-contract/next";

export const BASE_DOMAIN = "next.test";
export const GATE_SECRET = "test-gate-secret";

export async function freePort(): Promise<number> {
  const server = net.createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

export async function listen(server: net.Server): Promise<number> {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return (server.address() as AddressInfo).port;
}

export function closeServer(server: net.Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
    if (server instanceof http.Server) server.closeAllConnections();
  });
}

function readJson(request: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString()));
      } catch (error) {
        reject(error);
      }
    });
  });
}

export interface AccountFixture {
  labels: Record<string, GateResolvedLabel & { credential: string }>;
  sessions: Record<string, { userId: string; needsRefresh: boolean }>;
  desktopSessions: Record<string, { userId: string; setCookie: string | null }>;
  machines: Record<string, { machineId: string; userId: string }>;
  oauth: Record<
    string,
    {
      resource: string;
      grant: { scope: string; grantId: string; clientName: string };
    }
  >;
  refreshSetCookie: string;
}

const RESOLVE_KEYS = [
  "label",
  "session",
  "desktopSession",
  "credential",
  "machineCredential",
  "oauth",
];
const PRESENCE_KEYS = ["label", "state", "region", "gateMachineId", "at"];

function exactKeys(value: unknown, keys: string[]): boolean {
  if (typeof value !== "object" || value === null) return false;
  const own = Object.keys(value);
  return own.length === keys.length && keys.every((key) => own.includes(key));
}

export async function startAccountApi(fixture: AccountFixture) {
  const resolves: GateResolveRequest[] = [];
  const resolveBatches: number[] = [];
  const presence: GatePresenceRequest[] = [];
  const presenceBatches: number[] = [];
  const refreshes: string[] = [];
  let failing = false;
  let failuresLeft = 0;
  let delayMs = 0;
  const answerFor = (asked: GateResolveRequest): GateResolveResponse => {
    resolves.push(asked);
    const entry = fixture.labels[asked.label];
    const label: GateResolvedLabel | null =
      entry === undefined
        ? null
        : entry.kind === "server"
          ? {
              kind: "server",
              serverId: entry.serverId,
              userId: entry.userId,
              revoked: entry.revoked,
              lastSeenAt: entry.lastSeenAt,
            }
          : {
              kind: "machine",
              machineId: entry.machineId,
              userId: entry.userId,
              accountHandle: entry.accountHandle,
              routingKey: entry.routingKey,
              revoked: entry.revoked,
              lastSeenAt: entry.lastSeenAt,
            };
    const grant =
      asked.oauth === null ? undefined : fixture.oauth[asked.oauth.token];
    return {
      label,
      session:
        asked.session === null
          ? null
          : (fixture.sessions[asked.session] ?? null),
      desktopSession:
        asked.desktopSession === null
          ? null
          : (fixture.desktopSessions[asked.desktopSession] ?? null),
      credential:
        asked.credential === null
          ? null
          : entry !== undefined &&
            !entry.revoked &&
            entry.credential === asked.credential,
      machine:
        asked.machineCredential === null
          ? null
          : (fixture.machines[asked.machineCredential] ?? null),
      oauth:
        grant !== undefined &&
        asked.oauth !== null &&
        grant.resource === asked.oauth.resource &&
        label?.kind === "server" &&
        !label.revoked
          ? grant.grant
          : null,
    };
  };
  const server = http.createServer(async (request, response) => {
    const reply = (
      status: number,
      body: unknown,
      headers: http.OutgoingHttpHeaders = {},
    ) => {
      response.writeHead(status, {
        "content-type": "application/json",
        ...headers,
      });
      response.end(JSON.stringify(body));
    };
    const url = new URL(request.url ?? "/", "http://account.test");
    if (url.pathname === "/api/auth/get-session") {
      refreshes.push(request.headers.cookie ?? "");
      reply(
        200,
        { session: {}, user: {} },
        { "set-cookie": [fixture.refreshSetCookie] },
      );
      return;
    }
    if (request.headers.authorization !== `Bearer ${GATE_SECRET}`) {
      request.resume();
      response.writeHead(404).end("bb connect: not found\n");
      return;
    }
    if (request.method !== "POST") {
      request.resume();
      response.writeHead(405).end();
      return;
    }
    const body = await readJson(request).catch(() => null);
    if (failing) return reply(500, { error: "down" });
    if (failuresLeft > 0) {
      failuresLeft -= 1;
      return reply(502, { error: "bad gateway" });
    }
    if (delayMs > 0)
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    const isReport = (value: unknown): value is GatePresenceRequest =>
      exactKeys(value, PRESENCE_KEYS);
    const isAsk = (value: unknown): value is GateResolveRequest =>
      exactKeys(value, RESOLVE_KEYS);
    if (url.pathname === "/api/gate/presence") {
      if (!isReport(body)) return reply(400, { error: "invalid_request" });
      if (fixture.labels[body.label] === undefined) {
        return reply(404, { error: "unknown_label" });
      }
      presence.push(body);
      return reply(200, { recorded: true });
    }
    if (url.pathname === "/api/gate/presence/batch") {
      const reports =
        typeof body === "object" && body !== null && "reports" in body
          ? body.reports
          : null;
      if (!Array.isArray(reports) || !reports.every(isReport)) {
        return reply(400, { error: "invalid_request" });
      }
      presenceBatches.push(reports.length);
      const results = reports.map((report) => {
        if (fixture.labels[report.label] === undefined) return "unknown_label";
        presence.push(report);
        return "recorded";
      });
      return reply(200, { results });
    }
    if (url.pathname === "/api/gate/resolve/batch") {
      const requests =
        typeof body === "object" && body !== null && "requests" in body
          ? body.requests
          : null;
      if (!Array.isArray(requests) || !requests.every(isAsk)) {
        return reply(400, { error: "invalid_request" });
      }
      resolveBatches.push(requests.length);
      return reply(200, { answers: requests.map(answerFor) });
    }
    if (url.pathname !== "/api/gate/resolve" || !isAsk(body)) {
      return reply(400, { error: "invalid_request" });
    }
    reply(200, answerFor(body));
  });
  const port = await listen(server);
  return {
    url: `http://127.0.0.1:${port}`,
    resolves,
    resolveBatches,
    presence,
    presenceBatches,
    refreshes,
    setFailing(value: boolean) {
      failing = value;
    },
    failNext(count: number) {
      failuresLeft = count;
    },
    setDelay(ms: number) {
      delayMs = ms;
    },
    close: () => closeServer(server),
  };
}

export interface SeenRequest {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  assertion: GateAssertionResult | null;
  body: string;
}

export interface OriginOptions {
  keys: ReadonlyMap<string, CryptoKey>;
  audience: string;
}

const BIG_JSON = JSON.stringify({
  items: Array.from({ length: 200 }, (_, index) => ({
    index,
    text: "the quick brown fox jumps over the lazy dog",
  })),
});

export async function startOrigin(options: OriginOptions) {
  const seen: SeenRequest[] = [];
  const counts = new Map<string, number>();
  const verify = (request: http.IncomingMessage) => {
    const token = request.headers[GATE_ASSERTION_HEADER];
    if (typeof token !== "string") return Promise.resolve(null);
    return verifyGateAssertion(token, {
      keys: options.keys,
      audience: options.audience,
      method: request.method ?? "GET",
      pathAndQuery: request.url ?? "/",
      nowSeconds: Math.floor(Date.now() / 1000),
    });
  };
  const server = http.createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    const assertion = await verify(request);
    const entry: SeenRequest = {
      method: request.method ?? "GET",
      url: request.url ?? "/",
      headers: request.headers,
      assertion,
      body: Buffer.concat(chunks).toString(),
    };
    seen.push(entry);
    const path = (request.url ?? "/").split("?")[0] ?? "/";
    counts.set(path, (counts.get(path) ?? 0) + 1);
    if (assertion === null || !assertion.ok) {
      response.writeHead(401, { "content-type": "text/plain" });
      response.end(
        `assertion refused: ${assertion?.ok === false ? assertion.reason : "missing"}`,
      );
      return;
    }
    if (path === "/slow") return;
    if (path === "/refuse" || path === "/plain-401") {
      const body = JSON.stringify(
        path === "/refuse"
          ? { code: "gate_assertion_invalid", reason: "wrong_path" }
          : { code: "nope" },
      );
      response.writeHead(401, {
        "content-type": "application/json",
        "content-length": String(Buffer.byteLength(body)),
      });
      response.end(body);
      return;
    }
    if (path === "/set-cookies") {
      response.writeHead(200, {
        "content-type": "text/plain",
        "set-cookie": [
          "better-auth.session_token=stolen; Path=/",
          "__Secure-better-auth.session_data=x; Path=/",
          "wide=1; Domain=next.test; Path=/",
          "kept=1; Path=/",
        ],
      });
      response.end("cookies");
      return;
    }
    if (path === "/asset.js") {
      response.writeHead(200, {
        "content-type": "text/javascript",
        "cache-control": "public, max-age=31536000, immutable",
        etag: '"asset-1"',
      });
      response.end(`console.log(${JSON.stringify(BIG_JSON)});`);
      return;
    }
    if (path === "/short.js") {
      response.writeHead(200, {
        "content-type": "text/javascript",
        "cache-control": "public, max-age=60",
      });
      response.end("short");
      return;
    }
    if (path === "/shell") {
      if (request.headers["if-none-match"] === '"shell-1"') {
        response.writeHead(304, {
          etag: '"shell-1"',
          "cache-control": "no-cache",
        });
        response.end();
        return;
      }
      response.writeHead(200, {
        "content-type": "text/html",
        "cache-control": "no-cache",
        etag: '"shell-1"',
      });
      response.end("<!doctype html><title>shell</title>");
      return;
    }
    if (path === "/big.json") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(BIG_JSON);
      return;
    }
    if (path === "/install.sh") {
      response.writeHead(200, {
        "content-type": "text/html",
        "content-disposition": "inline",
      });
      response.end("#!/bin/sh\necho install\n");
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true, url: request.url }));
  });
  const sockets = new WebSocketServer({ noServer: true });
  server.on("upgrade", (request, socket, head) => {
    void verify(request).then((assertion) => {
      seen.push({
        method: request.method ?? "GET",
        url: request.url ?? "/",
        headers: request.headers,
        assertion,
        body: "",
      });
      if (assertion === null || !assertion.ok) {
        socket.end("HTTP/1.1 401 Unauthorized\r\ncontent-length: 0\r\n\r\n");
        return;
      }
      sockets.handleUpgrade(request, socket, head, (ws) => {
        ws.on("message", (data) => ws.send(`echo:${String(data)}`));
      });
    });
  });
  const port = await listen(server);
  return {
    port,
    seen,
    counts,
    BIG_JSON,
    close: async () => {
      for (const client of sockets.clients) client.terminate();
      sockets.close();
      await closeServer(server);
    },
  };
}

function dialFirst(
  ports: number[],
  onConnect: (socket: net.Socket) => void,
  onFail: () => void,
): void {
  const [port, ...rest] = ports;
  if (port === undefined) {
    onFail();
    return;
  }
  const socket = net.connect(port, "127.0.0.1");
  let connected = false;
  socket.once("connect", () => {
    connected = true;
    onConnect(socket);
  });
  socket.once("error", () => {
    if (!connected) dialFirst(rest, onConnect, onFail);
  });
}

export interface EdgeOptions {
  header?: { name: string; value: () => string };
  holdClient?: boolean;
}

function withHeader(
  first: Buffer,
  header: { name: string; value: () => string },
): Buffer | null {
  const end = first.indexOf("\r\n\r\n");
  const lineEnd = first.indexOf("\r\n");
  if (end === -1 || lineEnd === -1) return null;
  return Buffer.concat([
    first.subarray(0, lineEnd + 2),
    Buffer.from(`${header.name}: ${header.value()}\r\n`),
    first.subarray(lineEnd + 2),
  ]);
}

export async function startEdge(
  gatePorts: number | (() => number[]),
  options: EdgeOptions = {},
) {
  const connects: string[] = [];
  const open = new Set<net.Socket>();
  const targets = () =>
    typeof gatePorts === "number" ? [gatePorts] : gatePorts();
  const server = net.createServer((client) => {
    open.add(client);
    client.once("close", () => open.delete(client));
    client.once("data", (first: Buffer) => {
      const head = first.toString("latin1");
      const match = /^CONNECT (\S+) HTTP\/1\.[01]\r\n/u.exec(head);
      if (match === null) {
        client.destroy();
        return;
      }
      connects.push(match[1] ?? "");
      client.on("error", () => {});
      dialFirst(
        targets(),
        (upstream) => {
          client.write("HTTP/1.1 200 Connection established\r\n\r\n");
          const end = first.indexOf("\r\n\r\n");
          const rest = first.subarray(end + 4);
          const { header } = options;
          if (header === undefined) {
            if (rest.length > 0) upstream.write(rest);
            client.pipe(upstream).pipe(client);
          } else {
            let pending = rest;
            const onHead = (chunk: Buffer) => {
              pending = Buffer.concat([pending, chunk]);
              const rewritten = withHeader(pending, header);
              if (rewritten === null) return;
              client.off("data", onHead);
              upstream.write(rewritten);
              client.pipe(upstream);
            };
            upstream.pipe(client, { end: options.holdClient !== true });
            client.on("data", onHead);
            if (rest.length > 0) onHead(Buffer.alloc(0));
          }
          if (options.holdClient === true) {
            upstream.on("error", () => {});
          } else {
            upstream.on("error", () => client.destroy());
            upstream.on("close", () => client.destroy());
          }
          client.on("close", () => upstream.destroy());
        },
        () => client.destroy(),
      );
    });
  });
  const port = await listen(server);
  return {
    port,
    connects,
    close: () => {
      for (const socket of open) socket.destroy();
      return closeServer(server);
    },
  };
}

export interface FrpcOptions {
  binary: string;
  edgePort: number;
  label: string;
  credential: string;
  localPort: number;
  subdomains: string[];
  loginFailExit: boolean;
}

export interface FrpcProcess {
  child: ChildProcess;
  output(): string;
  stop(): Promise<void>;
  kill(): Promise<void>;
}

export async function startFrpc(options: FrpcOptions): Promise<FrpcProcess> {
  const dir = await mkdtemp(join(tmpdir(), "bb-frpc-test-"));
  const config = {
    serverAddr: `tunnel.${BASE_DOMAIN}`,
    serverPort: 80,
    user: options.label,
    loginFailExit: options.loginFailExit,
    metadatas: { [FRP_CREDENTIAL_META]: options.credential },
    log: { level: "info", disablePrintColor: true },
    transport: {
      protocol: "websocket",
      proxyURL: `http://127.0.0.1:${options.edgePort}`,
      poolCount: 1,
    },
    proxies: options.subdomains.map((subdomain) => ({
      name: subdomain,
      type: "http",
      localIP: "127.0.0.1",
      localPort: options.localPort,
      subdomain,
    })),
  };
  const file = join(dir, "frpc.json");
  await writeFile(file, JSON.stringify(config));
  const child = spawn(options.binary, ["-c", file], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout?.on("data", (chunk: Buffer) => (output += chunk.toString()));
  child.stderr?.on("data", (chunk: Buffer) => (output += chunk.toString()));
  const exited = new Promise<void>((resolve) =>
    child.once("exit", () => resolve()),
  );
  const halt = async (signal: NodeJS.Signals) => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill(signal);
      await exited;
    }
    await rm(dir, { recursive: true, force: true });
  };
  return {
    child,
    output: () => output,
    stop: () => halt("SIGTERM"),
    kill: () => halt("SIGKILL"),
  };
}

export async function waitFor(
  check: () => boolean,
  timeoutMs: number,
  what: string,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

export interface Visited {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
  text: string;
}

export function visit(
  gatePort: number,
  host: string,
  path: string,
  init: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  } = {},
): Promise<Visited> {
  return new Promise((resolve, reject) => {
    const sent = http.request(
      {
        host: "127.0.0.1",
        port: gatePort,
        path,
        method: init.method ?? "GET",
        headers: { ...init.headers, host },
        agent: false,
      },
      (answer) => {
        const chunks: Buffer[] = [];
        answer.on("data", (chunk: Buffer) => chunks.push(chunk));
        answer.on("end", () => {
          const body = Buffer.concat(chunks);
          resolve({
            status: answer.statusCode ?? 0,
            headers: answer.headers,
            body,
            text: body.toString(),
          });
        });
        answer.on("error", reject);
      },
    );
    sent.on("error", reject);
    sent.end(init.body);
  });
}

export async function testKeys() {
  const pair = await generateGateKeyPair("test-kid");
  const keys = new Map<string, CryptoKey>();
  const imported = await crypto.subtle.importKey(
    "jwk",
    { kty: "OKP", crv: "Ed25519", x: pair.publicKey.x },
    { name: "Ed25519" },
    false,
    ["verify"],
  );
  keys.set(pair.publicKey.kid, imported);
  return { privateJwk: pair.privateJwk, keys };
}

export { gateAudienceForMachine, gateAudienceForServer };
