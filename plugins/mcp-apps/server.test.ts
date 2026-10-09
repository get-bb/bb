import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "./server.js";
import { APP_MIME_TYPE } from "./protocol.js";

const openServers: Array<ReturnType<typeof createServer>> = [];
afterEach(async () => {
  await Promise.all(openServers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

describe("MCP Apps bridge", () => {
  it("opens a tool UI and routes subsequent actions through the same MCP server", async () => {
    const requests: Array<{ method: string; params?: Record<string, unknown> }> = [];
    const server = createServer(async (request, response) => {
      if (request.method !== "POST") {
        response.writeHead(405).end();
        return;
      }
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
        id?: number;
        method: string;
        params?: Record<string, unknown>;
      };
      requests.push(body);
      if (body.id === undefined) {
        response.writeHead(202).end();
        return;
      }
      let result: unknown;
      switch (body.method) {
        case "initialize":
          result = { protocolVersion: "2025-06-18", capabilities: { tools: {}, resources: {} }, serverInfo: { name: "test-app", version: "1.0.0" } };
          break;
        case "tools/list":
          result = { tools: [{ name: "edit", inputSchema: { type: "object" }, _meta: { ui: { resourceUri: "ui://edit/view" } } }] };
          break;
        case "tools/call":
          result = { content: [{ type: "text", text: "Saved" }] };
          break;
        case "resources/read":
          result = { contents: [{ uri: "ui://edit/view", mimeType: APP_MIME_TYPE, text: "<html><body>Edit</body></html>" }] };
          break;
        default:
          response.writeHead(404).end();
          return;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }));
    });
    openServers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No test server port");
    const host = createFakePluginHost({
      pluginId: "bb--mcp-apps",
      settings: { serverUrl: `http://127.0.0.1:${address.port}/mcp` },
    });
    await plugin(host.bb);
    const call = await host.harness.callAgentTool("bb_mcp_app_call", { name: "edit", arguments: { value: "a" } }, { threadId: "thread-a" });
    const value = JSON.parse(call as string) as { previewDirective: string };
    const id = value.previewDirective.match(/session="([^"]+)"/)?.[1];
    expect(id).toBeDefined();
    const opened = await host.harness.callRpc("app_get", { id, threadId: "thread-a" }) as { html: string };
    expect(opened.html).toContain("Edit");
    await expect(host.harness.callRpc("app_get", { id, threadId: "thread-b" })).rejects.toThrow();
    await host.harness.callRpc("app_call_tool", { id, threadId: "thread-a", name: "edit", arguments: { value: "b" } });
    expect(requests.filter((item) => item.method === "tools/call")).toHaveLength(2);
    expect(requests.find((item) => item.method === "initialize")?.params?.capabilities).toMatchObject({
      extensions: { "io.modelcontextprotocol/ui": { mimeTypes: [APP_MIME_TYPE] } },
    });
    await host.harness.dispose();
  });
});
