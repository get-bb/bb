import { createServer, request as httpRequest } from "node:http";
import type {
  IncomingHttpHeaders,
  IncomingMessage,
  OutgoingHttpHeaders,
  Server,
  ServerResponse,
} from "node:http";
import { request as httpsRequest } from "node:https";
import {
  isClaudeCodeMockCliTrafficEndpoint,
  type JsonObject,
  type JsonValue,
} from "@bb/domain";

export interface ClaudeCodeMockCliTrafficProxy {
  baseUrl: string;
  close(): Promise<void>;
}

export interface StartClaudeCodeMockCliTrafficProxyArgs {
  endpoint: string;
  threadId: string;
}

interface RewriteRequestBodyArgs {
  body: Buffer;
  headers: IncomingHttpHeaders;
}

interface RewriteRequestBodyResult {
  body: Buffer;
  contentType?: string;
}

interface ForwardRequestArgs {
  body: Buffer;
  headers: OutgoingHttpHeaders;
  method: string;
  response: ServerResponse;
  upstreamUrl: URL;
}

interface WriteForwardLogArgs {
  billingHeaderPresent: boolean;
  method: string;
  threadId: string;
  upstreamUrl: URL;
}

const CLI_USER_AGENT_FALLBACK = "claude-cli/0.0.0 (external, cli)";
const JSON_CONTENT_TYPE_PATTERN = /\bapplication\/json\b/iu;
const BILLING_HEADER_ENTRYPOINT_PATTERN = /^cc_entrypoint\s*=/iu;

function isJsonObject(value: JsonValue): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isJsonValue(value: unknown): value is JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }
  if (typeof value !== "object") {
    return false;
  }
  return Object.values(value).every(isJsonValue);
}

function rewriteIdentityString(value: string): string {
  return value
    .replaceAll("sdk-cli", "cli")
    .replaceAll("sdk-ts", "cli")
    .replaceAll("agent-sdk/", "cli-mock-agent-sdk/");
}

function rewriteBillingHeader(value: string): string {
  const segments = value
    .split(";")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
  let foundEntrypoint = false;
  const rewrittenSegments = segments.map((segment) => {
    if (BILLING_HEADER_ENTRYPOINT_PATTERN.test(segment)) {
      foundEntrypoint = true;
      return "cc_entrypoint=cli";
    }
    return rewriteIdentityString(segment);
  });
  if (!foundEntrypoint) {
    rewrittenSegments.push("cc_entrypoint=cli");
  }
  return rewrittenSegments.join("; ");
}

function rewriteJsonIdentity(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return value.map(rewriteJsonIdentity);
  }
  if (!isJsonObject(value)) {
    return typeof value === "string" ? rewriteIdentityString(value) : value;
  }

  const nextValue: JsonObject = {};
  for (const [key, entry] of Object.entries(value)) {
    nextValue[key] =
      key === "cc_entrypoint" ? "cli" : rewriteJsonIdentity(entry);
  }
  return nextValue;
}

function rewriteUserAgent(value: string | undefined): string {
  if (!value) {
    return CLI_USER_AGENT_FALLBACK;
  }
  const match = /^claude-cli\/([^\s]+)\b/u.exec(value);
  return match
    ? `claude-cli/${match[1]} (external, cli)`
    : CLI_USER_AGENT_FALLBACK;
}

function rewriteHeaders(headers: IncomingHttpHeaders): OutgoingHttpHeaders {
  const nextHeaders: OutgoingHttpHeaders = {};
  for (const [key, value] of Object.entries(headers)) {
    if (
      key === "host" ||
      key === "content-length" ||
      key === "connection" ||
      value === undefined
    ) {
      continue;
    }
    nextHeaders[key] = Array.isArray(value)
      ? value.map(rewriteIdentityString)
      : rewriteIdentityString(value);
  }
  nextHeaders["user-agent"] = rewriteUserAgent(headers["user-agent"]);
  const billingHeader = headers["x-anthropic-billing-header"];
  if (billingHeader !== undefined) {
    nextHeaders["x-anthropic-billing-header"] = Array.isArray(billingHeader)
      ? billingHeader.map(rewriteBillingHeader)
      : rewriteBillingHeader(billingHeader);
  }
  return nextHeaders;
}

function writeForwardLog(args: WriteForwardLogArgs): void {
  process.stderr.write(
    `${JSON.stringify({
      component: "claude-code-mock-cli-traffic-proxy",
      event: "forward",
      method: args.method,
      path: args.upstreamUrl.pathname,
      billingHeader: args.billingHeaderPresent ? "rewritten-to-cli" : "absent",
      threadId: args.threadId,
      upstreamOrigin: args.upstreamUrl.origin,
    })}\n`,
  );
}

function rewriteRequestBody(
  args: RewriteRequestBodyArgs,
): RewriteRequestBodyResult {
  const contentType = args.headers["content-type"];
  if (
    typeof contentType !== "string" ||
    !JSON_CONTENT_TYPE_PATTERN.test(contentType)
  ) {
    return { body: args.body };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(args.body.toString("utf8"));
  } catch {
    return { body: args.body };
  }
  if (!isJsonValue(parsed)) {
    return { body: args.body };
  }

  return {
    body: Buffer.from(JSON.stringify(rewriteJsonIdentity(parsed))),
    contentType,
  };
}

function readIncomingBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  return new Promise((resolve, reject) => {
    request.on("data", (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

function pipeUpstreamResponse(
  upstreamResponse: IncomingMessage,
  response: ServerResponse,
): void {
  response.writeHead(
    upstreamResponse.statusCode ?? 502,
    upstreamResponse.statusMessage,
    upstreamResponse.headers,
  );
  upstreamResponse.pipe(response);
}

function forwardRequest(args: ForwardRequestArgs): void {
  const request =
    args.upstreamUrl.protocol === "https:" ? httpsRequest : httpRequest;
  const upstreamRequest = request(
    args.upstreamUrl,
    {
      headers: {
        ...args.headers,
        "content-length": String(args.body.byteLength),
      },
      method: args.method,
    },
    (upstreamResponse) => pipeUpstreamResponse(upstreamResponse, args.response),
  );
  upstreamRequest.on("error", (error) => {
    if (!args.response.headersSent) {
      args.response.writeHead(502, { "content-type": "text/plain" });
    }
    args.response.end(error.message);
  });
  upstreamRequest.end(args.body);
}

function buildUpstreamUrl(
  endpoint: string,
  requestUrl: string | undefined,
): URL {
  if (!requestUrl || !requestUrl.startsWith("/")) {
    throw new Error("Mock CLI traffic proxy only accepts origin-form paths");
  }
  const upstreamBaseUrl = new URL(endpoint);
  const upstreamUrl = new URL(requestUrl, upstreamBaseUrl);
  if (upstreamUrl.origin !== upstreamBaseUrl.origin) {
    throw new Error("Mock CLI traffic proxy refused cross-origin target");
  }
  return upstreamUrl;
}

function listen(server: Server): Promise<string> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Mock CLI traffic proxy did not bind to a TCP port"));
        return;
      }
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

export async function startClaudeCodeMockCliTrafficProxy(
  args: StartClaudeCodeMockCliTrafficProxyArgs,
): Promise<ClaudeCodeMockCliTrafficProxy> {
  if (!isClaudeCodeMockCliTrafficEndpoint(args.endpoint)) {
    throw new Error(
      "Mock CLI traffic endpoint must be an http:// loopback URL or https://api.anthropic.com",
    );
  }

  const server = createServer(async (request, response) => {
    try {
      const upstreamUrl = buildUpstreamUrl(args.endpoint, request.url);
      const body = await readIncomingBody(request);
      const rewrittenBody = rewriteRequestBody({
        body,
        headers: request.headers,
      });
      const headers = rewriteHeaders(request.headers);
      if (rewrittenBody.contentType) {
        headers["content-type"] = rewrittenBody.contentType;
      }
      writeForwardLog({
        billingHeaderPresent:
          request.headers["x-anthropic-billing-header"] !== undefined,
        method: request.method ?? "GET",
        threadId: args.threadId,
        upstreamUrl,
      });
      forwardRequest({
        body: rewrittenBody.body,
        headers,
        method: request.method ?? "GET",
        response,
        upstreamUrl,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      response.writeHead(400, { "content-type": "text/plain" });
      response.end(message);
    }
  });

  const baseUrl = await listen(server);
  return {
    baseUrl,
    close: () => closeServer(server),
  };
}
