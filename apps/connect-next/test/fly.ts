import * as http from "node:http";
import * as net from "node:net";
import type { Duplex } from "node:stream";
import { closeServer, listen } from "./harness.js";

export const ENTRY_HEADER = "x-test-entry";
const MAX_REPLAY_BODY_BYTES = 1024 * 1024;

function replayTarget(
  header: string | string[] | undefined,
  elsewhere: () => string | null,
) {
  const value = Array.isArray(header) ? header[0] : header;
  if (value === undefined) return null;
  const fields = new Map<string, string>();
  for (const part of value.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    fields.set(
      part.slice(0, separator).trim(),
      part.slice(separator + 1).trim(),
    );
  }
  const instance =
    fields.get("elsewhere") === "true" ? elsewhere() : fields.get("instance");
  if (instance === undefined || instance === null) return null;
  return { instance, state: fields.get("state") ?? null };
}

function source(from: string, state: string | null): string {
  return `instance=${from};region=test;t=${Date.now()}${state === null ? "" : `;state=${state}`}`;
}

export async function startFlyProxy(instances: Map<string, number>) {
  const chains: string[][] = [];
  const failures: string[] = [];

  function portOf(instance: string): number {
    const port = instances.get(instance);
    if (port === undefined) throw new Error(`no instance ${instance}`);
    return port;
  }

  function otherThan(chain: string[]): string | null {
    return [...instances.keys()].find((id) => !chain.includes(id)) ?? null;
  }

  function entryOf(headers: http.IncomingHttpHeaders): string {
    const entry = headers[ENTRY_HEADER];
    if (typeof entry !== "string") throw new Error("no entry instance");
    return entry;
  }

  function send(
    instance: string,
    request: http.IncomingMessage,
    headers: http.OutgoingHttpHeaders,
    body: Buffer,
  ): Promise<http.IncomingMessage> {
    return new Promise((resolve, reject) => {
      const outgoing = http.request({
        host: "127.0.0.1",
        port: portOf(instance),
        method: request.method ?? "GET",
        path: request.url ?? "/",
        headers,
        agent: false,
      });
      outgoing.on("response", resolve);
      outgoing.on("error", reject);
      outgoing.end(body);
    });
  }

  async function serve(
    request: http.IncomingMessage,
    response: http.ServerResponse,
  ) {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    const body = Buffer.concat(chunks);
    const headers: http.OutgoingHttpHeaders = { ...request.headers };
    delete headers[ENTRY_HEADER];
    delete headers["fly-replay-src"];
    const chain = [entryOf(request.headers)];
    chains.push(chain);
    for (;;) {
      const current = chain.at(-1) ?? "";
      const answer = await send(current, request, headers, body);
      const replay = replayTarget(answer.headers["fly-replay"], () =>
        otherThan(chain),
      );
      if (replay === null) {
        response.writeHead(answer.statusCode ?? 502, answer.rawHeaders);
        answer.pipe(response);
        return;
      }
      answer.resume();
      if (chain.includes(replay.instance)) {
        failures.push(`loop: ${[...chain, replay.instance].join(" -> ")}`);
        response.writeHead(508).end("loop");
        return;
      }
      if (body.length > MAX_REPLAY_BODY_BYTES) {
        failures.push(`replayed a ${body.length} byte body`);
        response.writeHead(502).end("body too large to replay");
        return;
      }
      chain.push(replay.instance);
      headers["fly-replay-src"] = source(current, replay.state);
    }
  }

  function upgrade(
    request: http.IncomingMessage,
    socket: Duplex,
    head: Buffer,
    chain: string[],
    replaySource: string | null,
  ): void {
    const current = chain.at(-1) ?? "";
    const upstream = net.connect(portOf(current), "127.0.0.1");
    upstream.on("error", () => socket.destroy());
    socket.on("error", () => upstream.destroy());
    upstream.on("connect", () => {
      const lines = [`${request.method} ${request.url} HTTP/1.1`];
      const raw = request.rawHeaders;
      for (let index = 0; index + 1 < raw.length; index += 2) {
        const name = (raw[index] ?? "").toLowerCase();
        if (name === ENTRY_HEADER || name === "fly-replay-src") continue;
        lines.push(`${raw[index]}: ${raw[index + 1]}`);
      }
      if (replaySource !== null) lines.push(`fly-replay-src: ${replaySource}`);
      upstream.write(`${lines.join("\r\n")}\r\n\r\n`);
      if (head.length > 0) upstream.write(head);
    });
    let buffered = Buffer.alloc(0);
    const onData = (chunk: Buffer) => {
      buffered = Buffer.concat([buffered, chunk]);
      const end = buffered.indexOf("\r\n\r\n");
      if (end === -1) return;
      upstream.off("data", onData);
      const headText = buffered.subarray(0, end).toString("latin1");
      const replayLine = headText
        .split("\r\n")
        .find((line) => line.toLowerCase().startsWith("fly-replay:"));
      const replay =
        replayLine === undefined
          ? null
          : replayTarget(replayLine.slice(replayLine.indexOf(":") + 1), () =>
              otherThan(chain),
            );
      if (replay === null) {
        socket.write(buffered);
        upstream.pipe(socket);
        socket.pipe(upstream);
        upstream.on("close", () => socket.destroy());
        socket.on("close", () => upstream.destroy());
        return;
      }
      upstream.destroy();
      if (chain.includes(replay.instance)) {
        failures.push(`loop: ${[...chain, replay.instance].join(" -> ")}`);
        socket.end("HTTP/1.1 508 Loop Detected\r\ncontent-length: 0\r\n\r\n");
        return;
      }
      chain.push(replay.instance);
      upgrade(request, socket, head, chain, source(current, replay.state));
    };
    upstream.on("data", onData);
  }

  const server = http.createServer((request, response) => {
    serve(request, response).catch((error: unknown) => {
      failures.push(`proxy error: ${String(error)}`);
      response.destroy();
    });
  });
  server.on("upgrade", (request, socket, head) => {
    if (typeof request.headers[ENTRY_HEADER] !== "string") {
      failures.push(`upgrade without ${ENTRY_HEADER}: ${request.url ?? ""}`);
      socket.end("HTTP/1.1 400 Bad Request\r\ncontent-length: 0\r\n\r\n");
      return;
    }
    const chain = [entryOf(request.headers)];
    chains.push(chain);
    upgrade(request, socket, head, chain, null);
  });
  const port = await listen(server);
  return { port, chains, failures, close: () => closeServer(server) };
}

export async function startBlackHole() {
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("error", () => {});
    socket.on("close", () => sockets.delete(socket));
  });
  const port = await listen(server);
  return {
    url: `http://127.0.0.1:${port}`,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await closeServer(server);
    },
  };
}
