import { access } from "node:fs/promises";

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

export async function strictMcpConfigUnlessManaged(): Promise<{
  strictMcpConfig?: true;
}> {
  try {
    await access(claudeManagedMcpConfigPath());
    return {};
  } catch {
    return { strictMcpConfig: true };
  }
}
