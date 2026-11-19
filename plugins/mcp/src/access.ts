import type { BbPluginApi } from "@get-bb/plugin-sdk";

export const GATE_OAUTH_SCOPE_HEADER = "x-bb-gate-oauth-scope";
export const MCP_SCOPE = "bb";

export type McpRequestAccess = ReturnType<
  BbPluginApi["http"]["internal_DO_NOT_USE_requestAccess"]
>;

export interface McpAccessProblem {
  status: 401 | 403;
  message: string;
}

function refuse(message: string): McpAccessProblem {
  return { status: 403, message };
}

export function mcpAccessProblem(
  headers: Headers,
  access: McpRequestAccess,
): McpAccessProblem | null {
  switch (access) {
    case "server-machine":
    case "signed-in-device":
      return headers.get("origin") === null
        ? null
        : refuse(
            "The bb MCP endpoint does not accept requests from web pages.",
          );
    case "oauth": {
      const scopes = (headers.get(GATE_OAUTH_SCOPE_HEADER) ?? "")
        .split(/\s+/u)
        .filter(Boolean);
      return scopes.includes(MCP_SCOPE)
        ? null
        : refuse("This access token carries no bb scope.");
    }
    case "anonymous":
      return {
        status: 401,
        message:
          "Sign in first: send a bb sign-in token (`bb access login`) as Authorization: Bearer, or reach the endpoint through bb connect with an OAuth access token.",
      };
    case "connect-session":
    case "machine":
      return refuse(
        "Reach the bb MCP endpoint at /mcp with an OAuth access token.",
      );
  }
}
