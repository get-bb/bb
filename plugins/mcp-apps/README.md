# MCP Apps in BB

This first-party plugin hosts MCP Apps in a thread's right panel. It uses the standard tool `_meta.ui.resourceUri` and `resources/read` contract.

## Configure

Enable MCP Apps in BB's plugin settings. Set **MCP server URL** to a Streamable HTTP endpoint. Set **Bearer token** when the server uses one. Reload the plugin after changing either setting.

`bb mcp-apps tools --json` lists tools and their UI resource URIs. `bb mcp-apps call <name> '<json-arguments>'` calls a tool through the configured connection. Agents can use `bb_mcp_app_call`; when the result contains `previewDirective`, emit it once as a standalone line. The directive card opens the App beside the chat.

The panel runs the server's HTML in an opaque-origin iframe. A restrictive content security policy blocks external network and asset requests. App-initiated tool calls and resource reads go through the BB plugin backend. App-initiated chat messages require a user confirmation.

The first slice connects to one Streamable HTTP server with optional bearer authentication. It does not reuse provider-owned MCP sessions. OAuth, stdio, multi-server configuration, external assets permitted by the MCP App CSP, and automatic handling of ordinary provider MCP tool calls remain to be implemented for general host support.
