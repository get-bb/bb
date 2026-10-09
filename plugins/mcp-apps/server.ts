import { randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { appHtml, appResourceUri, APP_MIME_TYPE } from "./protocol.js";

const toolSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  inputSchema: z.record(z.string(), z.unknown()),
  uiResourceUri: z.string().nullable(),
});
const sessionSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  toolName: z.string(),
  arguments: z.record(z.string(), z.unknown()),
  result: z.unknown(),
  html: z.string(),
  resourceUri: z.string(),
});
export type AppSession = z.infer<typeof sessionSchema>;

export const rpcContract = defineRpcContract({
  tools_list: { input: z.null(), output: z.object({ tools: z.array(toolSchema) }) },
  tool_call: {
    input: z.object({ threadId: z.string(), name: z.string(), arguments: z.record(z.string(), z.unknown()) }),
    output: z.object({ result: z.unknown(), sessionId: z.string().nullable() }),
  },
  app_get: { input: z.object({ id: z.string(), threadId: z.string() }), output: sessionSchema },
  app_call_tool: {
    input: z.object({ id: z.string(), threadId: z.string(), name: z.string(), arguments: z.record(z.string(), z.unknown()) }),
    output: z.object({ result: z.unknown() }),
  },
  app_read_resource: {
    input: z.object({ id: z.string(), threadId: z.string(), uri: z.string() }),
    output: z.object({ result: z.unknown() }),
  },
});

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    serverUrl: {
      type: "string",
      label: "MCP server URL",
      description: "A Streamable HTTP MCP endpoint whose Apps appear in BB.",
      default: "",
    },
    bearerToken: {
      type: "string",
      label: "Bearer token",
      description: "Optional access token for the MCP endpoint.",
      secret: true,
      default: "",
    },
  });
  let clientPromise: Promise<Client> | null = null;
  const sessions = new Map<string, AppSession>();

  async function client(): Promise<Client> {
    if (clientPromise) return clientPromise;
    clientPromise = (async () => {
      const config = await settings.get();
      const url = new URL(config.serverUrl);
      if (url.protocol !== "https:" && !(url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1"))) {
        throw new Error("MCP server must use HTTPS except on localhost");
      }
      const headers = config.bearerToken ? { Authorization: `Bearer ${config.bearerToken}` } : undefined;
      const transport = new StreamableHTTPClientTransport(url, { requestInit: { headers } });
      const instance = new Client(
        { name: "bb-mcp-apps", version: "0.1.0" },
        { capabilities: { extensions: { "io.modelcontextprotocol/ui": { mimeTypes: [APP_MIME_TYPE] } } } as NonNullable<ConstructorParameters<typeof Client>[1]>["capabilities"] },
      );
      await instance.connect(transport);
      return instance;
    })().catch((error: unknown) => {
      clientPromise = null;
      throw error;
    });
    return clientPromise;
  }

  async function listedTools() {
    const response = await (await client()).listTools();
    return response.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      uiResourceUri: appResourceUri(tool),
    }));
  }

  async function runTool(threadId: string, name: string, arguments_: Record<string, unknown>) {
    const mcp = await client();
    const tool = (await mcp.listTools()).tools.find((candidate) => candidate.name === name);
    if (!tool) throw new Error(`Unknown MCP tool: ${name}`);
    const result = await mcp.callTool({ name, arguments: arguments_ });
    const resourceUri = appResourceUri(tool);
    let sessionId: string | null = null;
    if (resourceUri) {
      const resource = await mcp.readResource({ uri: resourceUri });
      const html = appHtml(resource.contents, resourceUri);
      if (html.length > 1_000_000) throw new Error("MCP App HTML exceeds 1 MB");
      sessionId = randomUUID();
      sessions.set(sessionId, { id: sessionId, threadId, toolName: name, arguments: arguments_, result, html, resourceUri });
      while (sessions.size > 16) sessions.delete(sessions.keys().next().value!);
    }
    return { result, sessionId };
  }

  function session(id: string, threadId: string): AppSession {
    const value = sessions.get(id);
    if (!value || value.threadId !== threadId) throw new Error("MCP App session unavailable");
    return value;
  }

  bb.rpc.register(rpcContract, {
    tools_list: async () => ({ tools: await listedTools() }),
    tool_call: ({ threadId, name, arguments: args }) => runTool(threadId, name, args),
    app_get: ({ id, threadId }) => session(id, threadId),
    app_call_tool: async ({ id, threadId, name, arguments: args }) => {
      session(id, threadId);
      const result = await (await client()).callTool({ name, arguments: args });
      return { result };
    },
    app_read_resource: async ({ id, threadId, uri }) => {
      session(id, threadId);
      const result = await (await client()).readResource({ uri });
      return { result };
    },
  });

  bb.agents.registerTool({
    name: "bb_mcp_app_call",
    description: "Call a tool on the MCP server configured in BB's MCP Apps settings. If the tool provides an MCP App, the result contains a previewDirective. Emit that directive once on its own line so the user can open the interactive UI in BB.",
    parameters: z.object({ name: z.string(), arguments: z.record(z.string(), z.unknown()).default({}) }),
    async execute(input, context) {
      try {
        const { result, sessionId } = await runTool(context.threadId, input.name, input.arguments);
        const previewDirective = sessionId ? `::mcp-app{session="${sessionId}"}` : null;
        const texts = Array.isArray(result.content)
          ? result.content.filter((part): part is { type: "text"; text: string } => part.type === "text").map((part) => part.text)
          : [];
        const answer = texts.join("\n");
        return JSON.stringify({ summary: answer.slice(0, 12_000), previewDirective, truncated: answer.length > 12_000 });
      } catch (error) {
        return { content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }], isError: true };
      }
    },
  });

  bb.cli.register({
    name: "mcp-apps",
    summary: "Inspect and call the configured MCP server",
    commands: [
      { name: "tools", summary: "List tools and UI resources", usage: "bb mcp-apps tools [--json]" },
      { name: "call", summary: "Call a tool", usage: "bb mcp-apps call <name> [json-arguments]" },
    ],
    async run(argv, context) {
      try {
        const [command, name, argText] = argv.filter((arg) => arg !== "--json");
        if (command === "tools") {
          const tools = await listedTools();
          return { exitCode: 0, stdout: JSON.stringify(tools, null, 2) };
        }
        if (command === "call" && name) {
          const args = argText ? z.record(z.string(), z.unknown()).parse(JSON.parse(argText)) : {};
          if (context.threadId) {
            const result = await runTool(context.threadId, name, args);
            const previewDirective = result.sessionId ? `::mcp-app{session="${result.sessionId}"}` : null;
            return { exitCode: 0, stdout: JSON.stringify({ ...result, previewDirective }, null, 2) };
          }
          const result = await (await client()).callTool({ name, arguments: args });
          return { exitCode: 0, stdout: JSON.stringify(result, null, 2) };
        }
        return { exitCode: 1, stderr: "Usage: bb mcp-apps tools | call <name> [json-arguments]" };
      } catch (error) {
        return { exitCode: 1, stderr: error instanceof Error ? error.message : String(error) };
      }
    },
  });

  bb.onDispose(async () => {
    const connected = clientPromise;
    clientPromise = null;
    sessions.clear();
    if (connected) await (await connected).close();
  });
}
