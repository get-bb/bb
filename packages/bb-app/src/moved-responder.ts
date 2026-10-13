import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type {
  SERVER_MOVED_ERROR_CODE,
  ServerMovedErrorDetails,
} from "@bb/host-daemon-contract";
import type { ServerMovedFile } from "@bb/server-archive";

const MOVED_ERROR_CODE: typeof SERVER_MOVED_ERROR_CODE = "server_moved";
const MOVED_STATUS = 410;
const REDIRECT_STATUS = 302;
const REQUEST_URL_BASE = "http://moved.invalid";

export interface StartMovedResponderArgs {
  bindHost: string;
  movedFile: ServerMovedFile;
  onError: (error: Error) => void;
  port: number;
}

export interface MovedResponder {
  close(): Promise<void>;
  port: number;
}

interface ServerMovedErrorBody {
  code: typeof SERVER_MOVED_ERROR_CODE;
  details: ServerMovedErrorDetails;
  message: string;
}

export function formatServerMovedNotice(movedFile: ServerMovedFile): string {
  return `This bb server moved to ${movedFile.toHostName} (${movedFile.serverUrl}). This computer now runs as a regular machine.`;
}

function createServerMovedErrorBody(
  movedFile: ServerMovedFile,
): ServerMovedErrorBody {
  return {
    code: MOVED_ERROR_CODE,
    message: `This bb server moved to ${movedFile.toHostName} (${movedFile.serverUrl}).`,
    details: {
      serverUrl: movedFile.serverUrl,
      toHostName: movedFile.toHostName,
      movedAt: movedFile.movedAt,
    },
  };
}

function parseHttpUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

function parseRequestUrl(requestUrl: string | undefined): URL | null {
  try {
    return new URL(requestUrl ?? "/", REQUEST_URL_BASE);
  } catch {
    return null;
  }
}

function isApiPath(pathname: string): boolean {
  return (
    pathname === "/health" ||
    pathname === "/api" ||
    pathname.startsWith("/api/") ||
    pathname === "/internal" ||
    pathname.startsWith("/internal/")
  );
}

function isPageRequest(request: IncomingMessage): boolean {
  const method = request.method ?? "GET";
  return (
    (method === "GET" || method === "HEAD") &&
    request.headers.accept?.toLowerCase().includes("text/html") === true
  );
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function resolveMovedRedirectUrl(serverUrl: URL, requestUrl: URL): string {
  const target = new URL(serverUrl.href);
  target.pathname = `${target.pathname.replace(/\/+$/u, "")}${requestUrl.pathname}`;
  target.search = requestUrl.search;
  return target.href;
}

function renderMovedPage(movedFile: ServerMovedFile, serverUrl: URL): string {
  const hostName = escapeHtml(movedFile.toHostName);
  const href = escapeHtml(serverUrl.href);
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    "<title>bb moved</title>",
    "</head>",
    "<body>",
    `<h1>This bb server moved to ${hostName}</h1>`,
    `<p><a href="${href}">Open bb at ${href}</a></p>`,
    "</body>",
    "</html>",
    "",
  ].join("\n");
}

function writeMovedError(
  response: ServerResponse,
  body: ServerMovedErrorBody,
): void {
  const text = JSON.stringify(body);
  response.writeHead(MOVED_STATUS, {
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(text),
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
  });
  response.end(text);
}

function writeMovedPage(response: ServerResponse, html: string): void {
  response.writeHead(MOVED_STATUS, {
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(html),
    "content-security-policy": "default-src 'none'",
    "content-type": "text/html; charset=utf-8",
    "x-content-type-options": "nosniff",
  });
  response.end(html);
}

function createMovedRequestHandler(
  movedFile: ServerMovedFile,
): (request: IncomingMessage, response: ServerResponse) => void {
  const errorBody = createServerMovedErrorBody(movedFile);
  const serverUrl = parseHttpUrl(movedFile.serverUrl);
  return (request, response) => {
    const requestUrl = parseRequestUrl(request.url);
    if (
      requestUrl === null ||
      serverUrl === null ||
      isApiPath(requestUrl.pathname) ||
      !isPageRequest(request)
    ) {
      writeMovedError(response, errorBody);
      return;
    }
    if (movedFile.mode === "direct") {
      response.writeHead(REDIRECT_STATUS, {
        "cache-control": "no-store",
        location: resolveMovedRedirectUrl(serverUrl, requestUrl),
      });
      response.end();
      return;
    }
    writeMovedPage(response, renderMovedPage(movedFile, serverUrl));
  };
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolvePromise) => {
    server.close(() => {
      resolvePromise();
    });
    server.closeAllConnections();
  });
}

export function startMovedResponder(
  args: StartMovedResponderArgs,
): Promise<MovedResponder | null> {
  const server = createServer(createMovedRequestHandler(args.movedFile));
  return new Promise((resolvePromise) => {
    const onListenError = (error: Error): void => {
      args.onError(error);
      resolvePromise(null);
    };
    server.once("error", onListenError);
    server.listen(args.port, args.bindHost, () => {
      server.off("error", onListenError);
      server.on("error", args.onError);
      const address = server.address();
      resolvePromise({
        close: () => closeServer(server),
        port:
          address !== null && typeof address === "object"
            ? address.port
            : args.port,
      });
    });
  });
}
