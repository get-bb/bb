import http, {
  type IncomingHttpHeaders,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import https from "node:https";
import type { AddressInfo, Socket } from "node:net";
import type { Duplex } from "node:stream";

const LOOPBACK_HOST = "127.0.0.1";
const MACHINE_HEADER = "x-bb-connect-machine";

export interface StartMachineAuthProxyOptions {
  machineCredential: string;
  serverUrl: string;
  port?: number;
}

export interface MachineAuthProxy {
  serverUrl: string;
  close(): Promise<void>;
}

function isOriginFormTarget(target: string | undefined): target is string {
  return (
    target !== undefined && target.startsWith("/") && !target.startsWith("//")
  );
}

function writeRejectedSocket(socket: Duplex, status: 400 | 405): void {
  const message = status === 405 ? "Method Not Allowed" : "Bad Request";
  socket.end(
    `HTTP/1.1 ${status} ${message}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
  );
}

function upstreamHeaders(
  headers: IncomingHttpHeaders,
  target: URL,
  machineCredential: string,
): IncomingHttpHeaders {
  return {
    ...headers,
    host: target.host,
    [MACHINE_HEADER]: machineCredential,
  };
}

function proxyRequest(args: {
  machineCredential: string;
  request: IncomingMessage;
  response: ServerResponse;
  target: URL;
}): void {
  if (!isOriginFormTarget(args.request.url)) {
    args.response.writeHead(400).end();
    return;
  }

  const requestFn =
    args.target.protocol === "https:" ? https.request : http.request;
  const upstream = requestFn(
    {
      protocol: args.target.protocol,
      hostname: args.target.hostname,
      port: args.target.port,
      method: args.request.method,
      path: args.request.url,
      headers: upstreamHeaders(
        args.request.headers,
        args.target,
        args.machineCredential,
      ),
    },
    (upstreamResponse) => {
      args.response.writeHead(
        upstreamResponse.statusCode ?? 502,
        upstreamResponse.statusMessage,
        upstreamResponse.headers,
      );
      upstreamResponse.pipe(args.response);
    },
  );
  upstream.on("error", () => {
    if (!args.response.headersSent) {
      args.response.writeHead(502);
    }
    args.response.end();
  });
  args.request.pipe(upstream);
}

function proxyUpgrade(args: {
  clientSocket: Duplex;
  head: Buffer;
  machineCredential: string;
  request: IncomingMessage;
  target: URL;
}): void {
  if (!isOriginFormTarget(args.request.url)) {
    writeRejectedSocket(args.clientSocket, 400);
    return;
  }

  const requestFn =
    args.target.protocol === "https:" ? https.request : http.request;
  const upstreamRequest = requestFn({
    protocol: args.target.protocol,
    hostname: args.target.hostname,
    port: args.target.port,
    method: args.request.method,
    path: args.request.url,
    headers: upstreamHeaders(
      args.request.headers,
      args.target,
      args.machineCredential,
    ),
  });
  upstreamRequest.on("upgrade", (response, upstreamSocket, upstreamHead) => {
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
  const server = http.createServer((request, response) =>
    proxyRequest({
      machineCredential: options.machineCredential,
      request,
      response,
      target,
    }),
  );
  server.on("connect", (_request, socket) => writeRejectedSocket(socket, 405));
  server.on("upgrade", (request, socket, head) =>
    proxyUpgrade({
      clientSocket: socket,
      head,
      machineCredential: options.machineCredential,
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
    // Accepted trade-off: any same-user local process can use this proxy while
    // the daemon runs. It is restricted to one server origin and exposes no
    // durable credential that can be exfiltrated from an agent environment.
    server.listen(options.port ?? 0, LOOPBACK_HOST);
  });

  const address = server.address() as AddressInfo;
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
