import http, {
  type IncomingHttpHeaders,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import https from "node:https";
import type { AddressInfo, Socket } from "node:net";
import type { Duplex } from "node:stream";

const LOOPBACK_HOST = "127.0.0.1";

interface StartMachineAuthProxyOptions {
  serverHeaders: Record<string, string>;
  serverUrl: string;
  port?: number;
}

export interface MachineAuthProxy {
  serverUrl: string;
  close(): Promise<void>;
}

const BROWSER_REQUEST_HEADERS = ["origin", "sec-fetch-site"] as const;

const REJECTED_SOCKET_MESSAGES = {
  400: "Bad Request",
  403: "Forbidden",
  405: "Method Not Allowed",
} as const;

type RejectedSocketStatus = keyof typeof REJECTED_SOCKET_MESSAGES;

function isBrowserRequest(headers: IncomingHttpHeaders): boolean {
  return BROWSER_REQUEST_HEADERS.some((name) => headers[name] !== undefined);
}

const LOOPBACK_AUTHORITY_HOSTNAMES = new Set([
  "127.0.0.1",
  "localhost",
  "[::1]",
]);

function parseHostAuthority(
  host: string,
): { hostname: string; port: string } | null {
  try {
    const url = new URL(`http://${host}`);
    return url.username.length === 0 &&
      url.password.length === 0 &&
      url.pathname === "/" &&
      url.search.length === 0 &&
      url.hash.length === 0
      ? { hostname: url.hostname, port: url.port }
      : null;
  } catch {
    return null;
  }
}

function isProxyLoopbackAuthority(
  host: string | undefined,
  boundPort: number,
): boolean {
  if (host === undefined) {
    return false;
  }
  const parsed = parseHostAuthority(host);
  if (parsed === null) {
    return false;
  }
  const hostPort = parsed.port.length > 0 ? Number(parsed.port) : 80;
  return (
    hostPort === boundPort && LOOPBACK_AUTHORITY_HOSTNAMES.has(parsed.hostname)
  );
}

function isOriginFormTarget(target: string | undefined): target is string {
  return (
    target !== undefined && target.startsWith("/") && !target.startsWith("//")
  );
}

function writeRejectedSocket(
  socket: Duplex,
  status: RejectedSocketStatus,
): void {
  socket.end(
    `HTTP/1.1 ${status} ${REJECTED_SOCKET_MESSAGES[status]}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
  );
}

function rejectedProxyStatus(
  request: IncomingMessage,
  boundPort: number | null,
): Extract<RejectedSocketStatus, 400 | 403> | null {
  if (
    boundPort === null ||
    isBrowserRequest(request.headers) ||
    !isProxyLoopbackAuthority(request.headers.host, boundPort)
  ) {
    return 403;
  }
  if (!isOriginFormTarget(request.url)) {
    return 400;
  }
  return null;
}

function openUpstreamRequest(
  request: IncomingMessage,
  target: URL,
  serverHeaders: Record<string, string>,
): http.ClientRequest {
  const requestFn = target.protocol === "https:" ? https.request : http.request;
  return requestFn({
    protocol: target.protocol,
    hostname: target.hostname,
    port: target.port,
    method: request.method,
    path: request.url,
    headers: {
      ...request.headers,
      host: target.host,
      ...serverHeaders,
    },
  });
}

function proxyRequest(args: {
  boundPort: number | null;
  serverHeaders: Record<string, string>;
  request: IncomingMessage;
  response: ServerResponse;
  target: URL;
}): void {
  const rejectedStatus = rejectedProxyStatus(args.request, args.boundPort);
  if (rejectedStatus !== null) {
    args.response.writeHead(rejectedStatus).end();
    return;
  }

  const upstream = openUpstreamRequest(
    args.request,
    args.target,
    args.serverHeaders,
  );
  upstream.once("response", (upstreamResponse) => {
    args.response.writeHead(
      upstreamResponse.statusCode ?? 502,
      upstreamResponse.statusMessage,
      upstreamResponse.headers,
    );
    upstreamResponse.pipe(args.response);
  });
  upstream.on("error", () => {
    if (!args.response.headersSent) {
      args.response.writeHead(502);
    }
    args.response.end();
  });
  args.request.pipe(upstream);
}

function proxyUpgrade(args: {
  boundPort: number | null;
  clientSocket: Duplex;
  head: Buffer;
  serverHeaders: Record<string, string>;
  request: IncomingMessage;
  target: URL;
}): void {
  const rejectedStatus = rejectedProxyStatus(args.request, args.boundPort);
  if (rejectedStatus !== null) {
    writeRejectedSocket(args.clientSocket, rejectedStatus);
    return;
  }

  const upstreamRequest = openUpstreamRequest(
    args.request,
    args.target,
    args.serverHeaders,
  );
  upstreamRequest.on("upgrade", (response, upstreamSocket, upstreamHead) => {
    upstreamSocket.on("error", () => upstreamSocket.destroy());
    upstreamSocket.on("close", () => args.clientSocket.destroy());
    args.clientSocket.on("close", () => upstreamSocket.destroy());
    if (args.clientSocket.destroyed) {
      upstreamSocket.destroy();
      return;
    }
    const statusLine = `HTTP/${response.httpVersion} ${response.statusCode ?? 101} ${response.statusMessage ?? "Switching Protocols"}\r\n`;
    const headerLines = response.rawHeaders
      .reduce<string[]>((lines, value, index) => {
        if (index % 2 === 0)
          lines.push(`${value}: ${response.rawHeaders[index + 1] ?? ""}\r\n`);
        return lines;
      }, [])
      .join("");
    args.clientSocket.write(`${statusLine}${headerLines}\r\n`);
    if (upstreamHead.length > 0) args.clientSocket.write(upstreamHead);
    if (args.head.length > 0) upstreamSocket.write(args.head);
    upstreamSocket.pipe(args.clientSocket).pipe(upstreamSocket);
  });
  upstreamRequest.on("response", () =>
    writeRejectedSocket(args.clientSocket, 400),
  );
  upstreamRequest.on("error", () => args.clientSocket.destroy());
  args.clientSocket.on("error", () => args.clientSocket.destroy());
  args.clientSocket.on("close", () => upstreamRequest.destroy());
  upstreamRequest.end();
}

export async function startMachineAuthProxy(
  options: StartMachineAuthProxyOptions,
): Promise<MachineAuthProxy> {
  const target = new URL(options.serverUrl);
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    throw new Error(
      `Unsupported machine proxy server protocol: ${target.protocol}`,
    );
  }
  const sockets = new Set<Socket>();
  let boundPort: number | null = null;
  const server = http.createServer((request, response) =>
    proxyRequest({
      boundPort,
      serverHeaders: options.serverHeaders,
      request,
      response,
      target,
    }),
  );
  server.on("connect", (_request, socket) => writeRejectedSocket(socket, 405));
  server.on("upgrade", (request, socket, head) =>
    proxyUpgrade({
      boundPort,
      clientSocket: socket,
      head,
      serverHeaders: options.serverHeaders,
      request,
      target,
    }),
  );
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(options.port ?? 0, LOOPBACK_HOST);
  });

  const address = server.address() as AddressInfo;
  boundPort = address.port;
  return {
    serverUrl: `http://${LOOPBACK_HOST}:${address.port}`,
    async close(): Promise<void> {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        for (const socket of sockets) socket.destroy();
      });
    },
  };
}
