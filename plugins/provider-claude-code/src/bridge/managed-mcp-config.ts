import { existsSync } from "node:fs";

function claudeManagedMcpConfigPath(): string {
  switch (process.platform) {
    case "darwin":
      return "/Library/Application Support/ClaudeCode/managed-mcp.json";
    case "win32":
      return "C:\\Program Files\\ClaudeCode\\managed-mcp.json";
    default:
      return "/etc/claude-code/managed-mcp.json";
  }
}

export function strictMcpConfigUnlessManaged(): { strictMcpConfig?: true } {
  return existsSync(claudeManagedMcpConfigPath())
    ? {}
    : { strictMcpConfig: true };
}
