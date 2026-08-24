import {
  type DynamicTool,
  experimental_buildBridgeToolCallContent,
} from "@get-bb/plugin-sdk/provider-bridge";
import type { McpSdkServerConfigWithInstance } from "@anthropic-ai/claude-agent-sdk";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { BB_BRIDGE_MCP_SERVER_NAME } from "../tool-classification.js";

export const BRIDGE_MCP_SERVER_NAME = BB_BRIDGE_MCP_SERVER_NAME;

type BridgeToolCallContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

export type ToolCallForwarder = (
  toolName: string,
  args: Record<string, unknown>,
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
  // Low-level handlers instead of McpServer.registerTool: registerTool only
  // accepts zod schemas, and rebuilding zod from the plugin's JSON Schema
  // loses nested types, enums, and required-ness. The wire format is JSON
  // Schema, so serve the registered schema verbatim. Argument validation
  // stays server-side where the plugin's own parse runs on execution.
  instance.server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: dynamicTools.map((def) => ({
      name: def.name,
      description: def.description,
      inputSchema: normalizeInputSchema(def.inputSchema),
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
    const result = await forwardToolCall(
      def.name,
      request.params.arguments ?? {},
    );
    return {
      content: experimental_buildBridgeToolCallContent(result),
      ...(result.isError ? { isError: true } : {}),
    };
  });
  return { type: "sdk", name: BRIDGE_MCP_SERVER_NAME, instance };
}

export function getAllowedToolNames(dynamicTools: DynamicTool[]): string[] {
  return dynamicTools.map(
    (def) => `mcp__${BRIDGE_MCP_SERVER_NAME}__${def.name}`,
  );
}

function normalizeInputSchema(
  inputSchema: unknown,
): Record<string, unknown> & { type: "object" } {
  if (
    inputSchema !== null &&
    typeof inputSchema === "object" &&
    !Array.isArray(inputSchema) &&
    (inputSchema as { type?: unknown }).type === "object"
  ) {
    return inputSchema as Record<string, unknown> & { type: "object" };
  }
  return { type: "object" };
}
