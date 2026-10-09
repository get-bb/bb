Display an MCP server's interactive tools beside a BB thread. When a connected tool advertises a `ui://` resource, BB reads its HTML and opens it in an isolated side panel. Buttons in that interface can call tools and read resources through the same MCP connection. An interface can ask to send a message into the BB chat; BB asks for confirmation first.

Configure a Streamable HTTP endpoint in the plugin settings. The endpoint must use HTTPS, except for localhost. A bearer token is optional and stored as a secret setting. The plugin starts disabled until configured.

Agents can call `bb_mcp_app_call`, or people can run `bb mcp-apps tools` and `bb mcp-apps call`. A UI tool call returns a directive that opens its panel beside chat.

This initial bridge supports one configured HTTP server, bearer authentication, and single-file HTML Apps. It does not yet import MCP servers configured directly in Codex or Claude, handle OAuth or stdio servers, or allow network requests from the embedded HTML. Those require BB-owned connection management and a reviewed sandbox policy.
