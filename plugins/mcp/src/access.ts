export const GATE_AUTH_HEADER = "x-bb-gate-auth";
export const GATE_OAUTH_AUTH_KIND = "oauth";
export const GATE_OAUTH_SCOPE_HEADER = "x-bb-gate-oauth-scope";
export const MCP_SCOPE = "bb";

export interface McpAccessProblem {
  status: 403;
  message: string;
}

function refuse(message: string): McpAccessProblem {
  return { status: 403, message };
}

export function mcpAccessProblem(headers: Headers): McpAccessProblem | null {
  const gateAuth = headers.get(GATE_AUTH_HEADER);
  if (gateAuth === null) {
    return headers.get("origin") === null
      ? null
      : refuse("The bb MCP endpoint does not accept requests from web pages.");
  }
  if (gateAuth !== GATE_OAUTH_AUTH_KIND) {
    return refuse(
      "Reach the bb MCP endpoint at /mcp with an OAuth access token.",
    );
  }
  const scopes = (headers.get(GATE_OAUTH_SCOPE_HEADER) ?? "")
    .split(/\s+/u)
    .filter(Boolean);
  return scopes.includes(MCP_SCOPE)
    ? null
    : refuse("This access token carries no bb scope.");
}
