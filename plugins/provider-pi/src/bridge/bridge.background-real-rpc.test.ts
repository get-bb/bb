import { spawnSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it, vi } from "vitest";
import { z } from "zod";
import { PI_BRIDGE_ARGS_ENV, PI_BRIDGE_COMMAND_ENV } from "./rpc-child.js";
import {
  FULL_PERMISSION_OPTIONS,
  type FakePiBridgeHarness,
  startFakePiBridge,
} from "./test-support.js";

const cli =
  process.env.PI_TEST_CLI ??
  fileURLToPath(
    new URL("./cli.js", import.meta.resolve("@earendil-works/pi-coding-agent")),
  );
const version = spawnSync(process.execPath, [cli, "--version"], {
  encoding: "utf8",
  timeout: 15000,
}).stdout.trim();
let harness: FakePiBridgeHarness | undefined;
let server: Server | undefined;
const messageSchema = z
  .object({ role: z.string(), content: z.unknown().optional() })
  .passthrough();
const requestSchema = z.object({ messages: z.array(messageSchema) });
function messageText(message: z.infer<typeof messageSchema>): string {
  if (typeof message.content === "string") return message.content;
  const parsed = z
    .array(z.object({ type: z.literal("text"), text: z.string() }))
    .safeParse(message.content);
  return parsed.success
    ? parsed.data.map((block) => block.text).join("\n")
    : "";
}

function chunk(
  response: import("node:http").ServerResponse,
  delta: Record<string, unknown>,
  finish: string | null = null,
) {
  response.write(
    `data: ${JSON.stringify({ id: "chatcmpl-local", object: "chat.completion.chunk", created: 1, model: "background-model", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`,
  );
}

afterEach(async () => {
  if (harness) await harness.teardown();
  harness = undefined;
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server?.close(() => resolve()));
  }
  server = undefined;
});

it.each(["active", "idle"] as const)(
  `real Pi ${version} RPC consumes %s completion and visibly reacts`,
  async (mode) => {
    const marker = `PI_REAL_${mode.toUpperCase()}_DONE`;
    const observedMessages: z.infer<typeof messageSchema>[][] = [];
    const command = `"${process.execPath}" -e "setTimeout(() => console.log('${marker}'), ${mode === "active" ? 150 : 1500})"`;
    server = createServer(async (request, response) => {
      const buffers: Buffer[] = [];
      for await (const buffer of request) buffers.push(Buffer.from(buffer));
      const { messages } = requestSchema.parse(
        JSON.parse(Buffer.concat(buffers).toString("utf8")),
      );
      observedMessages.push(messages);
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      chunk(response, { role: "assistant" });
      const hasToolResult = messages.some((message) => message.role === "tool");
      const hasCompletion = messages.some(
        (message) =>
          messageText(message).includes("Background task '") &&
          messageText(message).includes(marker),
      );
      if (!hasToolResult) {
        chunk(response, {
          tool_calls: [
            {
              index: 0,
              id: "call_background",
              type: "function",
              function: {
                name: "background_task",
                arguments: JSON.stringify({
                  command,
                  description: "real RPC test",
                }),
              },
            },
          ],
        });
        chunk(response, {}, "tool_calls");
      } else {
        if (mode === "active" && !hasCompletion)
          await new Promise((resolve) => setTimeout(resolve, 500));
        chunk(response, {
          content: hasCompletion
            ? `Received ${marker}`
            : "Launched; continuing work.",
        });
        chunk(response, {}, "stop");
      }
      response.end("data: [DONE]\n\n");
    });
    await new Promise<void>((resolve) =>
      server?.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Missing server port");
    harness = await startFakePiBridge({
      prefix: "bb-pi-real-background-",
      initialize: true,
    });
    const agentDir = join(harness.workspaceDir, "pi-agent");
    mkdirSync(agentDir);
    writeFileSync(
      join(agentDir, "models.json"),
      JSON.stringify({
        providers: {
          "local-background": {
            baseUrl: `http://127.0.0.1:${address.port}/v1`,
            api: "openai-completions",
            apiKey: "local-test-key",
            models: [
              {
                id: "background-model",
                name: "Background test",
                reasoning: false,
                input: ["text"],
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                contextWindow: 32000,
                maxTokens: 1024,
              },
            ],
          },
        },
      }),
    );
    vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
    vi.stubEnv(PI_BRIDGE_COMMAND_ENV, process.execPath);
    vi.stubEnv(PI_BRIDGE_ARGS_ENV, JSON.stringify([cli]));
    const threadId = "thr_real_background";
    const started = await harness.startThread(threadId, {
      options: {
        ...FULL_PERMISSION_OPTIONS,
        model: "local-background/background-model",
      },
    });
    expect(started.error).toBeUndefined();
    const providerThreadId = z
      .object({ providerThreadId: z.string() })
      .parse(started.result).providerThreadId;
    const prompted = await harness.request(900, "turn/start", {
      threadId,
      providerThreadId,
      clientRequestId: "creq_bg23456789",
      input: [
        {
          type: "text",
          text: "Start a background task and continue work. React to its completion.",
          mentions: [],
        },
      ],
      options: FULL_PERMISSION_OPTIONS,
    });
    expect(prompted.error).toBeUndefined();
    await harness.waitForDelta(
      threadId,
      (delta) =>
        delta.kind === "input.provider" && String(delta.text).includes(marker),
    );
    await harness.waitForDelta(
      threadId,
      (delta) =>
        delta.kind === "item.textDelta" &&
        String(delta.text).includes(`Received ${marker}`),
    );
    const deltas = harness.deltasOf(threadId);
    const taskItems = deltas.filter(
      (delta) =>
        delta.kind === "item.close" &&
        z.object({ type: z.literal("backgroundTask") }).safeParse(delta.item)
          .success,
    );
    expect(taskItems).toHaveLength(1);
    expect(taskItems[0]?.item).toMatchObject({
      taskStatus: "completed",
      summary: marker + "\n",
    });
    expect(deltas.filter((delta) => delta.kind === "turn.open")).toHaveLength(
      mode === "active" ? 1 : 2,
    );
    expect(
      observedMessages.some((messages) =>
        messages.some(
          (message) =>
            messageText(message).includes("Background task '") &&
            messageText(message).includes(marker),
        ),
      ),
    ).toBe(true);
  },
  30000,
);
