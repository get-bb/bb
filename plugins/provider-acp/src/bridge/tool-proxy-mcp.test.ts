/**
 * The `bb-bridge` MCP server proxies bb's dynamic tools (AskUserQuestion and
 * friends) to ACP agents such as OpenCode. Those agents use the MCP TypeScript
 * SDK client, whose `callTool` request times out after 60 seconds unless the
 * server sends `notifications/progress` for the call's `progressToken`
 * (OpenCode passes `resetTimeoutOnProgress: true`). A user answering a
 * question takes longer than that, so the server must keep the call alive.
 *
 * This test drives the MCP server exactly the way OpenCode does: the real SDK
 * client over stdio, a short request timeout, `resetTimeoutOnProgress`, and an
 * `onprogress` hook (which is what makes the SDK attach a progress token).
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { createServer, type Server } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { buildAcpMcpServerConfig } from "./tool-proxy-mcp.js";

const here = dirname(fileURLToPath(import.meta.url));
const BRIDGE_MODULE = resolve(here, "bridge.ts");
const TSX_LOADER = import.meta.resolve("tsx");

const cleanups: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    await cleanup();
  }
});

/** A stand-in for the bridge's TCP dynamic-tool socket that answers late. */
async function listenFakeBridge(args: {
  responseDelayMs: number;
}): Promise<{ port: number; server: Server; requests: unknown[] }> {
  const requests: unknown[] = [];
  const server = createServer((socket) => {
    let buffer = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => {
      buffer += chunk;
      const newline = buffer.indexOf("\n");
      if (newline === -1) return;
      requests.push(JSON.parse(buffer.slice(0, newline)));
      setTimeout(() => {
        socket.end(
          `${JSON.stringify({ ok: true, content: '{"answers":{"Which?":"B"}}' })}\n`,
        );
      }, args.responseDelayMs);
    });
  });
  await new Promise<void>((resolveListen) =>
    server.listen(0, "127.0.0.1", () => resolveListen()),
  );
  cleanups.push(
    () =>
      new Promise<void>((resolveClose) => server.close(() => resolveClose())),
  );
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("fake bridge did not bind a port");
  }
  return { port: address.port, server, requests };
}

async function connectLikeOpenCode(port: number): Promise<Client> {
  const config = buildAcpMcpServerConfig({
    bridgeArgs: [
      "--conditions=source",
      "--import",
      TSX_LOADER,
      BRIDGE_MODULE,
      "--mcp-stdio",
    ],
    command: process.execPath,
    dynamicTools: [
      {
        name: "AskUserQuestion",
        description: "Ask the user a question.",
        inputSchema: { type: "object", properties: {} },
      },
    ],
    host: "127.0.0.1",
    port,
    runtimeEnv: [],
    threadId: "thread-ask",
    token: "secret-token",
  });
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  for (const { name, value } of config.env) env[name] = value;
  // Heartbeat faster than the scaled-down client timeout below.
  env.BB_ACP_DYNAMIC_TOOL_PROGRESS_INTERVAL_MS = "200";
  const transport = new StdioClientTransport({
    command: config.command,
    args: config.args,
    env,
    stderr: "pipe",
  });
  const client = new Client({ name: "opencode-like", version: "0" });
  await client.connect(transport);
  transport.stderr?.on("data", (chunk: Buffer) => {
    process.stderr.write(`[bb-bridge mcp] ${chunk.toString()}`);
  });
  cleanups.push(() => client.close());
  return client;
}

describe("bb-bridge MCP server keeps long tool calls alive", () => {
  it("sends progress notifications so an OpenCode-style client does not time out while the user answers", async () => {
    const fakeBridge = await listenFakeBridge({ responseDelayMs: 2_500 });
    const client = await connectLikeOpenCode(fakeBridge.port);

    let progressCount = 0;
    const result = await client.callTool(
      {
        name: "AskUserQuestion",
        arguments: { questions: [] },
      },
      CallToolResultSchema,
      {
        // OpenCode's defaults are the SDK's 60s timeout with resets on
        // progress; scale the timeout down so the test stays fast.
        timeout: 1_000,
        resetTimeoutOnProgress: true,
        onprogress: () => {
          progressCount += 1;
        },
      },
    );

    expect(result.isError).toBeFalsy();
    expect(result.content).toEqual([
      { type: "text", text: '{"answers":{"Which?":"B"}}' },
    ]);
    expect(progressCount).toBeGreaterThan(0);
    expect(fakeBridge.requests).toHaveLength(1);
  }, 20_000);
});
