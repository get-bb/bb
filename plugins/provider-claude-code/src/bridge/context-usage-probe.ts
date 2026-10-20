import { query, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { setTimeout as delay } from "node:timers/promises";
import type { DynamicTool } from "@get-bb/plugin-sdk/provider-bridge";
import type { SdkSessionOptions } from "./sdk-session.js";
import { buildBridgeMcpServer } from "./tool-proxy-mcp.js";
import { BB_BRIDGE_MCP_SERVER_NAME } from "../tool-classification.js";

async function* promptWithoutMessages(
  signal: AbortSignal,
): AsyncGenerator<SDKUserMessage> {
  if (signal.aborted) return;
  await new Promise<void>((resolve) => {
    signal.addEventListener("abort", () => resolve(), { once: true });
  });
}

export async function readIsolatedClaudeContextUsage(args: {
  sessionOptions: SdkSessionOptions;
  providerSessionId: string;
  dynamicTools: DynamicTool[];
  signal: AbortSignal;
}): Promise<unknown> {
  args.signal.throwIfAborted();
  const options = args.sessionOptions;
  const end = new AbortController();
  const session = query({
    prompt: promptWithoutMessages(end.signal),
    options: {
      cwd: options.cwd,
      systemPrompt: options.systemPrompt,
      model: options.model,
      effort: options.effort,
      thinking: options.thinking,
      env: options.env,
      pathToClaudeCodeExecutable: options.pathToClaudeCodeExecutable,
      plugins: options.plugins,
      extraArgs: options.extraArgs,
      additionalDirectories: options.additionalDirectories
        ? [...options.additionalDirectories]
        : [],
      sandbox: options.sandbox,
      settingSources: ["user", "project", "local"],
      settings: {
        ...(typeof options.settings === "object" ? options.settings : {}),
        disableAllHooks: true,
      },
      resume: args.providerSessionId,
      forkSession: true,
      persistSession: false,
      canUseTool: async () => ({
        behavior: "deny",
        message: "Context reporting cannot execute tools.",
      }),
      ...(args.dynamicTools.length > 0
        ? {
            mcpServers: {
              [BB_BRIDGE_MCP_SERVER_NAME]: buildBridgeMcpServer(
                args.dynamicTools,
                async () => ({
                  content: "Context reporting cannot execute tools.",
                  isError: true,
                }),
              ),
            },
            allowedTools: options.allowedTools,
          }
        : {}),
    },
  });
  const close = (): void => {
    end.abort();
    session.close();
  };
  args.signal.addEventListener("abort", close, { once: true });
  try {
    args.signal.throwIfAborted();
    await session.initializationResult();
    while (args.dynamicTools.length > 0) {
      const server = (await session.mcpServerStatus()).find(
        (server) => server.name === BB_BRIDGE_MCP_SERVER_NAME,
      );
      if (server?.status === "connected") break;
      if (server && server.status !== "pending") return null;
      await delay(25, undefined, { signal: args.signal });
    }
    return await session.getContextUsage();
  } finally {
    args.signal.removeEventListener("abort", close);
    close();
  }
}
