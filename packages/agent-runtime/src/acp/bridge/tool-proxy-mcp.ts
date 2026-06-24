import { createConnection } from "node:net";
import { createInterface } from "node:readline";
import { dynamicToolSchema, type DynamicTool } from "@bb/domain";
import { z } from "zod";

export const ACP_BRIDGE_MCP_SERVER_NAME = "bb-bridge";

const ENV_HOST = "BB_ACP_DYNAMIC_TOOL_HOST";
const ENV_PORT = "BB_ACP_DYNAMIC_TOOL_PORT";
const ENV_TOKEN = "BB_ACP_DYNAMIC_TOOL_TOKEN";
const ENV_THREAD_ID = "BB_ACP_DYNAMIC_TOOL_THREAD_ID";
const ENV_TOOLS = "BB_ACP_DYNAMIC_TOOLS";

export interface AcpMcpServerConfig {
  name: string;
  command: string;
  args: string[];
  env: { name: string; value: string }[];
}

export interface BuildAcpMcpServerConfigArgs {
  bridgeArgs: string[];
  command: string;
  dynamicTools: readonly DynamicTool[];
  host: string;
  port: number;
  threadId: string;
  token: string;
}

interface BridgeToolCallRequest {
  arguments: Record<string, unknown>;
  callId: string;
  threadId: string;
  token: string;
  tool: string;
}

type BridgeToolCallResponse =
  | { ok: true; content: string; isError?: boolean }
  | { ok: false; error: string };

const bridgeToolCallResponseSchema = z.union([
  z.object({
    ok: z.literal(true),
    content: z.string(),
    isError: z.boolean().optional(),
  }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);

interface JsonRpcMessage {
  id?: string | number;
  method?: string;
  params?: unknown;
}

interface McpServerEnvironment {
  host: string;
  port: number;
  threadId: string;
  token: string;
  tools: DynamicTool[];
}

let nextMcpToolCallId = 0;

export function buildAcpMcpServerConfig(
  args: BuildAcpMcpServerConfigArgs,
): AcpMcpServerConfig {
  return {
    name: ACP_BRIDGE_MCP_SERVER_NAME,
    command: args.command,
    args: args.bridgeArgs,
    env: [
      { name: ENV_HOST, value: args.host },
      { name: ENV_PORT, value: String(args.port) },
      { name: ENV_TOKEN, value: args.token },
      { name: ENV_THREAD_ID, value: args.threadId },
      { name: ENV_TOOLS, value: JSON.stringify(args.dynamicTools) },
    ],
  };
}

function readEnvironment(): McpServerEnvironment {
  const port = Number(process.env[ENV_PORT]);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`${ENV_PORT} must be a positive integer`);
  }
  const host = process.env[ENV_HOST];
  const token = process.env[ENV_TOKEN];
  const threadId = process.env[ENV_THREAD_ID];
  const toolsJson = process.env[ENV_TOOLS];
  if (!host || !token || !threadId || !toolsJson) {
    throw new Error("Missing ACP dynamic tool MCP server environment");
  }
  const parsedTools = JSON.parse(toolsJson) as unknown;
  const tools = dynamicToolSchema.array().parse(parsedTools);
  return {
    host,
    port,
    threadId,
    token,
    tools,
  };
}

function writeJson(message: unknown): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function writeResult(id: string | number, result: unknown): void {
  writeJson({ jsonrpc: "2.0", id, result });
}

function writeError(id: string | number, code: number, message: string): void {
  writeJson({ jsonrpc: "2.0", id, error: { code, message } });
}

function mcpToolCallId(toolName: string): string {
  nextMcpToolCallId += 1;
  return `acp-mcp-${toolName}-${Date.now()}-${nextMcpToolCallId}`;
}

function callBridge(
  env: McpServerEnvironment,
  request: Omit<BridgeToolCallRequest, "threadId" | "token">,
): Promise<BridgeToolCallResponse> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: env.host, port: env.port });
    let buffer = "";
    socket.setEncoding("utf8");
    socket.on("connect", () => {
      const payload: BridgeToolCallRequest = {
        ...request,
        threadId: env.threadId,
        token: env.token,
      };
      socket.write(`${JSON.stringify(payload)}\n`);
    });
    socket.on("data", (chunk) => {
      buffer += chunk;
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex === -1) {
        return;
      }
      const line = buffer.slice(0, newlineIndex);
      socket.end();
      try {
        resolve(bridgeToolCallResponseSchema.parse(JSON.parse(line)));
      } catch (error) {
        reject(error);
      }
    });
    socket.on("error", reject);
    socket.on("end", () => {
      if (!buffer.includes("\n")) {
        reject(new Error("ACP dynamic tool bridge closed without a response"));
      }
    });
  });
}

function objectParams(params: unknown): Record<string, unknown> {
  return params && typeof params === "object" && !Array.isArray(params)
    ? (params as Record<string, unknown>)
    : {};
}

async function handleRequest(
  env: McpServerEnvironment,
  message: JsonRpcMessage,
): Promise<void> {
  if (message.id === undefined || message.method === undefined) {
    return;
  }

  switch (message.method) {
    case "initialize":
      writeResult(message.id, {
        protocolVersion:
          typeof objectParams(message.params).protocolVersion === "string"
            ? objectParams(message.params).protocolVersion
            : "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: ACP_BRIDGE_MCP_SERVER_NAME, version: "1.0.0" },
      });
      return;

    case "tools/list":
      writeResult(message.id, {
        tools: env.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        })),
      });
      return;

    case "tools/call": {
      const params = objectParams(message.params);
      const name = typeof params.name === "string" ? params.name : "";
      const tool = env.tools.find((candidate) => candidate.name === name);
      if (!tool) {
        writeError(message.id, -32602, `Unknown tool: ${name}`);
        return;
      }
      const rawArguments = params.arguments;
      const toolArguments =
        rawArguments &&
        typeof rawArguments === "object" &&
        !Array.isArray(rawArguments)
          ? (rawArguments as Record<string, unknown>)
          : {};
      try {
        const result = await callBridge(env, {
          arguments: toolArguments,
          callId: mcpToolCallId(tool.name),
          tool: tool.name,
        });
        if (!result.ok) {
          writeResult(message.id, {
            content: [{ type: "text", text: result.error }],
            isError: true,
          });
          return;
        }
        writeResult(message.id, {
          content: [{ type: "text", text: result.content }],
          ...(result.isError ? { isError: true } : {}),
        });
      } catch (error) {
        writeResult(message.id, {
          content: [
            {
              type: "text",
              text: error instanceof Error ? error.message : String(error),
            },
          ],
          isError: true,
        });
      }
      return;
    }

    default:
      writeError(
        message.id,
        -32601,
        `Unsupported MCP method: ${message.method}`,
      );
  }
}

export function runAcpDynamicToolMcpServer(): void {
  const env = readEnvironment();
  const rl = createInterface({ input: process.stdin, terminal: false });
  rl.on("line", (line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }
    let message: JsonRpcMessage;
    try {
      message = JSON.parse(trimmed) as JsonRpcMessage;
    } catch {
      return;
    }
    void handleRequest(env, message);
  });
}
