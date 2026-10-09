---
name: mcp-apps
description: "Use the configured MCP Apps bridge to call a UI-enabled MCP tool and open its interface in BB."
---

# MCP Apps in BB

Run `bb mcp-apps tools --json` to discover tools from the configured MCP server. Use `bb_mcp_app_call` to call a tool when its UI would help the user. If it returns `previewDirective`, copy that directive into the next assistant message exactly once as a standalone line. The user can open the resulting interface beside chat.

Use `bb mcp-apps call <name> '<json-arguments>'` for a direct CLI call. The plugin supports one Streamable HTTP MCP endpoint configured in BB settings.
