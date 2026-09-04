import {
  cockpitActionRequestSchema,
  cockpitDiscoveryQuerySchema,
  type CockpitActionRequest,
} from "@bb/domain";
import type { BbSdk } from "@bb/sdk";
import { resolveBbCliVersion } from "../version.js";

const PROTOCOL_VERSION = "2024-11-05";

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: unknown;
}

interface JsonRpcSuccess {
  jsonrpc: "2.0";
  id: string | number | null;
  result: unknown;
}

interface JsonRpcError {
  jsonrpc: "2.0";
  id: string | number | null;
  error: { code: number; message: string };
}

export const COCKPIT_MCP_TOOLS = [
  {
    name: "cockpit_discover",
    description:
      "Discover BB agents, sessions, attention items, and owner-supported cockpit-control actions",
    inputSchema: {
      type: "object",
      properties: {
        hostId: { type: "string", description: "Execution host to filter by" },
      },
    },
  },
  {
    name: "cockpit_act",
    description:
      "Execute a cockpit-control action against an opaque owner reference and return a typed receipt",
    inputSchema: {
      type: "object",
      required: [
        "ownerRef",
        "action",
        "idempotencyKey",
        "hostId",
        "confirmation",
      ],
      properties: {
        ownerRef: { type: "string" },
        hostId: { type: "string" },
        idempotencyKey: { type: "string" },
        confirmation: { type: "string", enum: ["none", "confirmed"] },
        action: { type: "object" },
      },
    },
  },
] as const;

function jsonRpcError(
  id: string | number | null,
  code: number,
  message: string,
): JsonRpcError {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function jsonRpcResult(
  id: string | number | null,
  result: unknown,
): JsonRpcSuccess {
  return { jsonrpc: "2.0", id, result };
}

function toolResult(payload: unknown): {
  content: Array<{ type: "text"; text: string }>;
} {
  return {
    content: [{ type: "text", text: JSON.stringify(payload) }],
  };
}

export async function handleCockpitMcpRequest(
  request: JsonRpcRequest,
  sdk: BbSdk,
): Promise<JsonRpcSuccess | JsonRpcError | null> {
  const id = request.id ?? null;
  switch (request.method) {
    case "initialize":
      return jsonRpcResult(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: {
          name: "bb-cockpit",
          version: resolveBbCliVersion(),
        },
      });
    case "notifications/initialized":
    case "notifications/cancelled":
      return null;
    case "ping":
      return jsonRpcResult(id, {});
    case "tools/list":
      return jsonRpcResult(id, { tools: COCKPIT_MCP_TOOLS });
    case "tools/call": {
      const params = request.params;
      if (
        typeof params !== "object" ||
        params === null ||
        !("name" in params) ||
        typeof params.name !== "string"
      ) {
        return jsonRpcError(id, -32602, "Invalid tools/call params");
      }
      const args =
        "arguments" in params && params.arguments !== undefined
          ? params.arguments
          : {};
      try {
        if (params.name === "cockpit_discover") {
          const query = cockpitDiscoveryQuerySchema.parse({
            hostId:
              typeof args === "object" &&
              args !== null &&
              "hostId" in args &&
              typeof args.hostId === "string"
                ? args.hostId
                : null,
          });
          return jsonRpcResult(
            id,
            toolResult(await sdk.cockpit.discover({ hostId: query.hostId })),
          );
        }
        if (params.name === "cockpit_act") {
          const actionRequest: CockpitActionRequest =
            cockpitActionRequestSchema.parse(args);
          return jsonRpcResult(
            id,
            toolResult(await sdk.cockpit.act(actionRequest)),
          );
        }
        return jsonRpcError(id, -32601, `Unknown tool ${params.name}`);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Cockpit-control tool failed";
        return jsonRpcError(id, -32000, message);
      }
    }
    default:
      return jsonRpcError(id, -32601, `Unknown method ${request.method}`);
  }
}

function encodeMcpMessage(message: object): string {
  const json = JSON.stringify(message);
  return `Content-Length: ${Buffer.byteLength(json, "utf8")}\r\n\r\n${json}`;
}

export async function runCockpitMcpStdio(sdk: BbSdk): Promise<void> {
  let buffer = Buffer.alloc(0);
  for await (const chunk of process.stdin) {
    buffer = Buffer.concat([buffer, chunk as Buffer]);
    while (true) {
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) {
        break;
      }
      const header = buffer.subarray(0, headerEnd).toString("utf8");
      const match = /Content-Length:\s*(\d+)/i.exec(header);
      if (match === null) {
        buffer = buffer.subarray(headerEnd + 4);
        continue;
      }
      const length = Number(match[1]);
      const bodyStart = headerEnd + 4;
      if (buffer.length < bodyStart + length) {
        break;
      }
      const body = buffer.subarray(bodyStart, bodyStart + length).toString("utf8");
      buffer = buffer.subarray(bodyStart + length);
      let parsed: JsonRpcRequest;
      try {
        parsed = JSON.parse(body) as JsonRpcRequest;
      } catch {
        continue;
      }
      if (typeof parsed.method !== "string") {
        continue;
      }
      const response = await handleCockpitMcpRequest(parsed, sdk);
      if (response !== null) {
        process.stdout.write(encodeMcpMessage(response));
      }
    }
  }
}
