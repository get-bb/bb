import { createRequire } from "node:module";

import type { RemoteConfig } from "../config.js";
import { RemoteError } from "../types.js";

interface McpTransport {
  close(): Promise<void>;
}

interface McpClient {
  connect(transport: McpTransport): Promise<void>;
  ping(options?: { signal?: AbortSignal }): Promise<unknown>;
  callTool(
    input: { name: string; arguments: Record<string, unknown> },
    schema?: undefined,
    options?: { signal?: AbortSignal },
  ): Promise<unknown>;
  close(): Promise<void>;
}

interface ClientModule {
  Client: new (info: { name: string; version: string }) => McpClient;
}
interface StdioModule {
  StdioClientTransport: new (options: { command: string; stderr: "pipe" }) => McpTransport;
}
interface StreamableHttpModule {
  StreamableHTTPClientTransport: new (
    url: URL,
    options: { requestInit?: RequestInit },
  ) => McpTransport;
}
interface LegacySseModule {
  SSEClientTransport: new (
    url: URL,
    options: {
      requestInit?: RequestInit;
      eventSourceInit?: {
        fetch?: (input: string | URL, init?: RequestInit) => Promise<Response>;
      };
    },
  ) => McpTransport;
}

const requireSdk = createRequire(import.meta.url);

function hasConstructor(value: unknown, name: string): boolean {
  return value !== null && typeof value === "object" &&
    typeof (value as Record<string, unknown>)[name] === "function";
}
function clientModule(value: unknown): value is ClientModule { return hasConstructor(value, "Client"); }
function stdioModule(value: unknown): value is StdioModule { return hasConstructor(value, "StdioClientTransport"); }
function streamableModule(value: unknown): value is StreamableHttpModule { return hasConstructor(value, "StreamableHTTPClientTransport"); }
function legacySseModule(value: unknown): value is LegacySseModule { return hasConstructor(value, "SSEClientTransport"); }

function sdkError(): RemoteError {
  return new RemoteError("Forge MCP SDK transport is unavailable", {
    service: "forge-compute", code: "FORGE_MCP_SDK_UNAVAILABLE", status: null,
    retryable: false, retryAfterMs: null, details: null,
  });
}

export interface ForgeComputeTransport {
  health(signal?: AbortSignal): Promise<void>;
  verifyDynamic(arguments_: Record<string, unknown>, signal?: AbortSignal): Promise<Record<string, unknown>>;
  penTestRun(arguments_: Record<string, unknown>, signal?: AbortSignal): Promise<Record<string, unknown>>;
  getJobStatus(arguments_: Record<string, unknown>, signal?: AbortSignal): Promise<Record<string, unknown>>;
  listJobs(arguments_: Record<string, unknown>, signal?: AbortSignal): Promise<Record<string, unknown>>;
  close(): Promise<void>;
}

function headers(token: string | null): HeadersInit | undefined {
  return token === null ? undefined : { Authorization: `Bearer ${token}` };
}

function makeTransport(config: RemoteConfig): McpTransport {
  if (config.forgeTransport === "stdio") {
    if (config.forgeCommand === null) throw new RemoteError("Forge stdio command is not configured", {
      service: "forge-compute", code: "FORGE_UNAVAILABLE", status: null,
      retryable: false, retryAfterMs: null, details: null,
    });
    const loaded: unknown = requireSdk("@modelcontextprotocol/sdk/client/stdio.js");
    if (!stdioModule(loaded)) throw sdkError();
    return new loaded.StdioClientTransport({ command: config.forgeCommand, stderr: "pipe" });
  }
  if (config.forgeUrl === null) throw new RemoteError("Forge URL is not configured", {
    service: "forge-compute", code: "FORGE_UNAVAILABLE", status: null,
    retryable: false, retryAfterMs: null, details: null,
  });
  const url = new URL(config.forgeUrl);
  if (config.forgeTransport === "streamable-http") {
    const loaded: unknown = requireSdk("@modelcontextprotocol/sdk/client/streamableHttp.js");
    if (!streamableModule(loaded)) throw sdkError();
    return new loaded.StreamableHTTPClientTransport(url, {
      requestInit: { headers: headers(config.forgeAuthToken) },
    });
  }
  const loaded: unknown = requireSdk("@modelcontextprotocol/sdk/client/sse.js");
  if (!legacySseModule(loaded)) throw sdkError();
  return new loaded.SSEClientTransport(url, {
    requestInit: { headers: headers(config.forgeAuthToken) },
    eventSourceInit: config.forgeAuthToken === null ? undefined : {
      fetch: async (input, init) => await fetch(input, {
        ...init,
        headers: { ...init?.headers, Authorization: `Bearer ${config.forgeAuthToken}` },
      }),
    },
  });
}

function parseResult(result: unknown): Record<string, unknown> {
  if (result === null || typeof result !== "object") throw new RemoteError("Forge returned an invalid MCP envelope", {
    service: "forge-compute", code: "FORGE_INVALID_ENVELOPE", status: null,
    retryable: false, retryAfterMs: null, details: null,
  });
  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content) || content.length !== 1) throw new RemoteError("Forge returned an invalid MCP envelope", {
    service: "forge-compute", code: "FORGE_INVALID_ENVELOPE", status: null,
    retryable: false, retryAfterMs: null, details: null,
  });
  const item: unknown = content[0];
  if (item === null || typeof item !== "object" || (item as { type?: unknown }).type !== "text" || typeof (item as { text?: unknown }).text !== "string") {
    throw new RemoteError("Forge returned an invalid MCP envelope", {
      service: "forge-compute", code: "FORGE_INVALID_ENVELOPE", status: null,
      retryable: false, retryAfterMs: null, details: null,
    });
  }
  try {
    const value: unknown = JSON.parse((item as { text: string }).text);
    if (value === null || Array.isArray(value) || typeof value !== "object") throw new TypeError("object required");
    return value as Record<string, unknown>;
  } catch (error: unknown) {
    if (error instanceof RemoteError) throw error;
    throw new RemoteError("Forge returned invalid JSON", {
      service: "forge-compute", code: "FORGE_INVALID_JSON", status: null,
      retryable: false, retryAfterMs: null, details: null,
    });
  }
}

export async function createForgeMcpTransport(config: RemoteConfig): Promise<ForgeComputeTransport> {
  const loaded: unknown = requireSdk("@modelcontextprotocol/sdk/client/index.js");
  if (!clientModule(loaded)) throw sdkError();
  const transport = makeTransport(config);
  const client = new loaded.Client({ name: "bb-finite-state", version: "0.1.0" });
  await client.connect(transport);
  const call = async (name: "verify_dynamic" | "pen_test_run" | "get_job_status" | "list_jobs", arguments_: Record<string, unknown>, signal?: AbortSignal) => {
    try {
      return parseResult(await client.callTool({ name, arguments: arguments_ }, undefined, signal ? { signal } : undefined));
    } catch (error: unknown) {
      if (error instanceof RemoteError) throw error;
      throw new RemoteError("Forge transport failed", {
        service: "forge-compute", code: "FORGE_TRANSPORT_ERROR", status: null,
        retryable: true, retryAfterMs: null, details: null,
      });
    }
  };
  return {
    async health(signal) { await client.ping(signal ? { signal } : undefined); },
    verifyDynamic: (arguments_, signal) => call("verify_dynamic", arguments_, signal),
    penTestRun: (arguments_, signal) => call("pen_test_run", arguments_, signal),
    getJobStatus: (arguments_, signal) => call("get_job_status", arguments_, signal),
    listJobs: (arguments_, signal) => call("list_jobs", arguments_, signal),
    close: () => client.close(),
  };
}
