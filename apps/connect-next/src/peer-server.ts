import * as http from "node:http";
import * as net from "node:net";
import type { Duplex } from "node:stream";
import type { TunnelDirectory } from "./directory.js";
import { single } from "./headers.js";
import { errorText, type Log } from "./log.js";
import {
  PEER_FORWARD_HEADER,
  PEER_MISS_HEADER,
  PEER_PATH,
  isPeerLabel,
  parseAnnouncement,
  parseGoodbye,
  parseHello,
  type Regions,
} from "./regions.js";
import { withoutPort } from "./visitor.js";

const MAX_PEER_BODY_BYTES = 16 * 1024;
const HOP_HEADERS: ReadonlySet<string> = new Set([
  "connection",
  "keep-alive",
  "proxy-connection",
  "transfer-encoding",
  "upgrade",
  PEER_FORWARD_HEADER,
]);

export interface PeerServerOptions {
  regions: Regions;
  directory: TunnelDirectory;
  baseDomain: string;
  vhost: { host: string; port: number };
  log: Log;
}

function readBody(request: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size <= MAX_PEER_BODY_BYTES) chunks.push(chunk);
    });
    request.on("end", () => {
      if (size > MAX_PEER_BODY_BYTES) {
        resolve(null);
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString()));
      } catch {
        resolve(null);
      }
    });
    request.on("error", () => resolve(null));
  });
}

function rawLines(raw: readonly string[], keep: (name: string) => boolean) {
  const lines: string[] = [];
  for (let index = 0; index + 1 < raw.length; index += 2) {
    const name = raw[index] ?? "";
    if (keep(name.toLowerCase())) lines.push(`${name}: ${raw[index + 1]}`);
  }
  return lines;
}

export function createPeerServer(options: PeerServerOptions) {
  const { regions, directory, log } = options;
  const suffix = `.${options.baseDomain}`;
  const agent = new http.Agent({ keepAlive: true, maxSockets: Infinity });

  function subdomainOf(request: http.IncomingMessage): string | null {
    const host = withoutPort(
      (single(request.headers, "host") ?? "").toLowerCase(),
    );
    if (!host.endsWith(suffix)) return null;
    const subdomain = host.slice(0, -suffix.length);
    return subdomain === "" || subdomain.includes(".") ? null : subdomain;
  }

  function held(request: http.IncomingMessage): string | null {
    const subdomain = subdomainOf(request);
    if (subdomain === null) return null;
    return directory.locate(subdomain).kind === "here" ? subdomain : null;
  }

  function forward(
    request: http.IncomingMessage,
    response: http.ServerResponse,
  ): void {
    if (!regions.authorized(single(request.headers, PEER_FORWARD_HEADER))) {
      request.resume();
      response.writeHead(401).end();
      return;
    }
    const subdomain = held(request);
    if (subdomain === null) {
      request.resume();
      response.writeHead(503, { [PEER_MISS_HEADER]: "1" }).end();
      return;
    }
    const headers: http.OutgoingHttpHeaders = {};
    for (const [name, value] of Object.entries(request.headers)) {
      if (value !== undefined && !HOP_HEADERS.has(name)) headers[name] = value;
    }
    const outgoing = http.request({
      ...options.vhost,
      method: request.method ?? "GET",
      path: request.url ?? "/",
      headers,
      agent,
    });
    outgoing.on("response", (answer) => {
      const pairs: string[] = [];
      const raw = answer.rawHeaders;
      for (let index = 0; index + 1 < raw.length; index += 2) {
        const name = raw[index] ?? "";
        if (HOP_HEADERS.has(name.toLowerCase())) continue;
        pairs.push(name, raw[index + 1] ?? "");
      }
      response.writeHead(answer.statusCode ?? 502, pairs);
      answer.on("error", () => response.destroy());
      answer.pipe(response);
    });
    outgoing.on("error", (error) => {
      log("warn", "peer_forward_failed", {
        subdomain,
        error: errorText(error),
      });
      if (!response.headersSent) response.writeHead(502).end();
      else response.destroy();
    });
    response.on("close", () => {
      if (!response.writableFinished) outgoing.destroy();
    });
    request.pipe(outgoing);
  }

  async function control(
    request: http.IncomingMessage,
    response: http.ServerResponse,
  ): Promise<void> {
    const answer = (status: number, body?: unknown) => {
      if (body === undefined) {
        response.writeHead(status).end();
        return;
      }
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(body));
    };
    const path = (request.url ?? "/").split("?")[0] ?? "/";
    if (!path.startsWith(`${PEER_PATH}/`)) {
      request.resume();
      answer(404);
      return;
    }
    if (!regions.authorized(single(request.headers, "authorization"))) {
      request.resume();
      log("warn", "peer_refused", { path });
      answer(401);
      return;
    }
    const route = path.slice(PEER_PATH.length);
    if (request.method === "GET" && route.startsWith("/labels/")) {
      request.resume();
      const label = route.slice("/labels/".length);
      if (!isPeerLabel(label)) {
        answer(400);
        return;
      }
      answer(200, regions.answerLabel(label));
      return;
    }
    if (request.method === "POST" && route === "/announce") {
      const announcement = parseAnnouncement(await readBody(request));
      if (announcement === null) {
        answer(400);
        return;
      }
      regions.receive(announcement);
      answer(204);
      return;
    }
    if (request.method === "POST" && route === "/goodbye") {
      const goodbye = parseGoodbye(await readBody(request));
      if (goodbye === null) {
        answer(400);
        return;
      }
      regions.receiveGoodbye(goodbye);
      answer(204);
      return;
    }
    if (request.method === "POST" && route === "/hello") {
      const hello = parseHello(await readBody(request));
      if (hello === null) {
        answer(400);
        return;
      }
      answer(200, regions.answerHello(hello));
      return;
    }
    request.resume();
    answer(404);
  }

  function refuse(socket: Duplex, status: number, extra: string[] = []) {
    const lines = [
      `HTTP/1.1 ${status} ${http.STATUS_CODES[status] ?? ""}`,
      "content-length: 0",
      "connection: close",
      ...extra,
    ];
    socket.end(`${lines.join("\r\n")}\r\n\r\n`);
  }

  function upgrade(
    request: http.IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): void {
    socket.on("error", () => {});
    if (!regions.authorized(single(request.headers, PEER_FORWARD_HEADER))) {
      refuse(socket, 401);
      return;
    }
    if (held(request) === null) {
      refuse(socket, 503, [`${PEER_MISS_HEADER}: 1`]);
      return;
    }
    const vhost = net.connect(options.vhost.port, options.vhost.host);
    vhost.on("error", () => socket.destroy());
    socket.on("error", () => vhost.destroy());
    vhost.on("connect", () => {
      const lines = [
        `${request.method} ${request.url} HTTP/1.1`,
        ...rawLines(request.rawHeaders, (name) => name !== PEER_FORWARD_HEADER),
      ];
      vhost.write(`${lines.join("\r\n")}\r\n\r\n`);
      if (head.length > 0) vhost.write(head);
      vhost.pipe(socket);
      socket.pipe(vhost);
    });
    vhost.on("close", () => socket.destroy());
    socket.on("close", () => vhost.destroy());
  }

  const server = http.createServer((request, response) => {
    if (request.headers[PEER_FORWARD_HEADER] !== undefined) {
      forward(request, response);
      return;
    }
    control(request, response).catch((error: unknown) => {
      log("error", "peer_request_failed", { error: errorText(error) });
      response.destroy();
    });
  });
  server.on("upgrade", upgrade);
  server.on("clientError", (_error, socket) => socket.destroy());
  return { server, close: () => agent.destroy() };
}
