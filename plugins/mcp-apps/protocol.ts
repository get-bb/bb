import { getToolUiResourceUri } from "@modelcontextprotocol/ext-apps/app-bridge";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";

export const APP_MIME_TYPE = "text/html;profile=mcp-app";

export function appResourceUri(tool: Tool): string | null {
  const uri = getToolUiResourceUri(tool);
  return uri?.startsWith("ui://") ? uri : null;
}

export function appHtml(contents: Array<{ uri: string; mimeType?: string; text?: string; blob?: string }>, uri: string): string {
  const item = contents.find((candidate) => candidate.uri === uri);
  if (!item || item.mimeType !== APP_MIME_TYPE) {
    throw new Error("MCP App resource has no matching HTML content");
  }
  if (typeof item.text === "string") return item.text;
  if (typeof item.blob === "string") {
    return Buffer.from(item.blob, "base64").toString("utf8");
  }
  throw new Error("MCP App resource has no HTML body");
}
