import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { registerSearchTool, registerSourceTools } from "fumadocs-core/mcp";
import { createFromSource } from "fumadocs-core/search/server";

import { docsLlms, source } from "./source";

export const docsSearch = createFromSource(source, { language: "english" });

let mcpHandler: ReturnType<typeof createMcpHandler> | null = null;

export function docsMcpHandler(): ReturnType<typeof createMcpHandler> {
  mcpHandler ??= createMcpHandler(
    () => {
      const mcp = new McpServer({ name: "bb-docs", version: "0.0.1" });
      registerSourceTools(mcp, source, docsLlms);
      registerSearchTool(mcp, docsSearch);
      return mcp;
    },
    { responseMode: "json" },
  );
  return mcpHandler;
}
