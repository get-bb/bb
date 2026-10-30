import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { registerSearchTool, registerSourceTools } from "fumadocs-core/mcp";
import { createFromSource } from "fumadocs-core/search/server";

import { navSectionOf } from "./nav";
import { pageStructuredData } from "./page-view";
import { docsLlms, source } from "./source";

export const docsSearch = createFromSource(source, {
  language: "english",
  buildIndex: async (page) => {
    const section = navSectionOf(page.slugs.join("/"));
    return {
      id: page.url,
      url: page.url,
      title: page.data.title,
      description: page.data.description,
      breadcrumbs: section === null ? [] : [section],
      structuredData: await pageStructuredData(page),
    };
  },
});

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
