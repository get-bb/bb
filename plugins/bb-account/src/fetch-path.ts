import type { ExperimentalPluginRpcCaller } from "@get-bb/plugin-sdk";
import { CONNECT_PLUGIN_ID } from "./contract.js";

const ALLOWED_PATH = /^\/api\/[A-Za-z0-9._~\-/]*$/u;
const AI_PREFIX = "/api/ai/";
const CONNECT_PREFIX = "/api/connect/";
const MCP_PREFIX = "/api/mcp/";
const MCP_PLUGIN_ID = "bb--mcp";

export class FetchPathError extends Error {
  constructor(path: string, reason: string) {
    super(
      `bb-account.v1.fetch refused path ${JSON.stringify(path)}: ${reason}`,
    );
    this.name = "FetchPathError";
  }
}

export function isConnectPlugin(caller: ExperimentalPluginRpcCaller): boolean {
  return caller.kind === "plugin" && caller.pluginId === CONNECT_PLUGIN_ID;
}

export function assertAllowedFetchPath(
  path: string,
  caller: ExperimentalPluginRpcCaller,
): string {
  if (path.includes("..")) {
    throw new FetchPathError(path, 'it must not contain ".."');
  }
  if (path.includes("//")) {
    throw new FetchPathError(path, 'it must not contain "//"');
  }
  if (path.includes("?") || path.includes("#")) {
    throw new FetchPathError(path, "it must not carry a query or fragment");
  }
  if (!ALLOWED_PATH.test(path)) {
    throw new FetchPathError(
      path,
      'it must start with "/api/" and may only contain letters, digits, and - . _ ~ /',
    );
  }
  if (path.startsWith(AI_PREFIX)) return path;
  if (path.startsWith(CONNECT_PREFIX)) {
    if (isConnectPlugin(caller)) return path;
    throw new FetchPathError(
      path,
      'only the connect plugin may call "/api/connect/"',
    );
  }
  if (path.startsWith(MCP_PREFIX)) {
    if (caller.kind === "plugin" && caller.pluginId === MCP_PLUGIN_ID) {
      return path;
    }
    throw new FetchPathError(
      path,
      'only the MCP server plugin may call "/api/mcp/"',
    );
  }
  throw new FetchPathError(path, 'it must start with "/api/ai/"');
}
