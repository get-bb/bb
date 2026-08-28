import {
  type DynamicTool,
  experimental_buildBridgeToolCallContent,
  jsonValueSchema,
  type JsonObject,
  type JsonValue,
} from "@get-bb/plugin-sdk/provider-bridge";
import type { McpSdkServerConfigWithInstance } from "@anthropic-ai/claude-agent-sdk";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import { BB_BRIDGE_MCP_SERVER_NAME } from "../tool-classification.js";

export const BRIDGE_MCP_SERVER_NAME = BB_BRIDGE_MCP_SERVER_NAME;

const jsonObjectSchema = z.record(z.string(), jsonValueSchema);

type BridgeToolCallContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

export type ToolCallForwarder = (
  toolName: string,
  args: JsonObject,
) => Promise<{
  content: string;
  contentBlocks?: BridgeToolCallContent[];
  isError?: boolean;
}>;

export function buildBridgeMcpServer(
  dynamicTools: DynamicTool[],
  forwardToolCall: ToolCallForwarder,
): McpSdkServerConfigWithInstance {
  const toolsByName = new Map(dynamicTools.map((def) => [def.name, def]));
  const instance = new McpServer(
    { name: BRIDGE_MCP_SERVER_NAME, version: "1.0.0" },
    { capabilities: { tools: {} } },
  );
  instance.server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: dynamicTools.map((def) => ({
      name: def.name,
      description: def.description,
      inputSchema: normalizeInputSchema(jsonValueSchema.parse(def.inputSchema)),
    })),
  }));
  instance.server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const def = toolsByName.get(request.params.name);
    if (def === undefined) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Unknown tool: ${request.params.name}`,
          },
        ],
        isError: true,
      };
    }
    const args = jsonObjectSchema.parse(request.params.arguments ?? {});
    const result = await forwardToolCall(def.name, args);
    const content = experimental_buildBridgeToolCallContent(result);
    if (result.isError) {
      return { content, isError: true };
    }
    return { content };
  });
  return { type: "sdk", name: BRIDGE_MCP_SERVER_NAME, instance };
}

export function getAllowedToolNames(dynamicTools: DynamicTool[]): string[] {
  return dynamicTools.map(
    (def) => `mcp__${BRIDGE_MCP_SERVER_NAME}__${def.name}`,
  );
}

function normalizeInputSchema(
  inputSchema: JsonValue,
): JsonObject & { type: "object" } {
  const parsed = jsonObjectSchema.safeParse(inputSchema);
  if (parsed.success && parsed.data.type === "object") {
    return { ...parsed.data, type: "object" };
  }
  return { type: "object" };
}
