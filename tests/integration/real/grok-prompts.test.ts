import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { withoutBridgeRuntimeEnv } from "@bb/provider-bridge-protocol/bridge-kit";
import {
  createAcpAgentConnection,
  requestAcpInitialize,
  type AcpAgentConnection,
} from "../../../packages/provider-bridge-acp/src/bridge/agent-connection.js";
import { acpSessionNewResultSchema } from "../../../packages/provider-bridge-acp/src/wire.js";
import { isJsonObject } from "../../../packages/provider-bridge-acp/src/session/decode.js";

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const EMBEDDED_TOKEN = "PROMPT_OK 😀 مراجعة";

const promptResultSchema = z
  .object({
    stopReason: z.string(),
    _meta: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

describe.sequential("real Grok ACP prompts", () => {
  it("accepts an advertised image and embedded text resource", async () => {
    const workspaceDir = mkdtempSync(join(tmpdir(), "bb-real-grok-prompts-"));
    const notePath = join(workspaceDir, "note.txt");
    writeFileSync(notePath, EMBEDDED_TOKEN);
    const agentText: string[] = [];
    const connection: AcpAgentConnection = createAcpAgentConnection({
      command: "grok",
      args: ["agent", "--no-leader", "stdio"],
      cwd: workspaceDir,
      env: withoutBridgeRuntimeEnv(process.env),
      recordThreadId: null,
      onResponse: () => {},
      onNotification: (_method, params) => {
        if (!isJsonObject(params) || !isJsonObject(params["update"])) return;
        const update = params["update"];
        if (
          update["sessionUpdate"] === "agent_message_chunk" &&
          isJsonObject(update["content"]) &&
          typeof update["content"]["text"] === "string"
        ) {
          agentText.push(update["content"]["text"]);
        }
      },
      onRequest: (_method, _params, responder) => {
        responder.error(-32601, "No client requests expected");
      },
      onExit: () => {},
    });
    try {
      const agent = await requestAcpInitialize(connection, {
        parameterizedModelPicker: false,
        fsAccess: false,
        elicitation: true,
      });
      expect(agent.prompt.image).toBe(true);
      expect(agent.prompt.embeddedContext).toBe(true);
      const methodIds = agent.authMethods.map((method) => method.id);
      expect(methodIds.length).toBeGreaterThan(0);
      console.info("Real Grok auth methods", JSON.stringify(methodIds));
      const methodId =
        process.env.XAI_API_KEY && methodIds.includes("xai.api_key")
          ? "xai.api_key"
          : methodIds.includes("cached_token")
            ? "cached_token"
            : undefined;
      expect(methodId).toBeDefined();
      await connection.request({
        method: "authenticate",
        params: { methodId, _meta: { headless: true } },
        resultSchema: z.unknown(),
        timeoutMs: 60_000,
      });
      const session = await connection.request({
        method: "session/new",
        params: { cwd: workspaceDir, mcpServers: [] },
        resultSchema: acpSessionNewResultSchema,
        timeoutMs: 60_000,
      });
      const result = await connection.request({
        method: "session/prompt",
        params: {
          sessionId: session.sessionId,
          prompt: [
            {
              type: "text",
              text: "Reply with exactly the token from the attached text resource.",
            },
            {
              type: "image",
              data: ONE_PIXEL_PNG.toString("base64"),
              mimeType: "image/png",
            },
            {
              type: "resource",
              resource: {
                uri: pathToFileURL(notePath).href,
                mimeType: "text/plain",
                text: EMBEDDED_TOKEN,
              },
            },
          ],
        },
        resultSchema: promptResultSchema,
        timeoutMs: 180_000,
      });
      expect(result._meta?.["sessionId"]).toBe(session.sessionId);
      const reply = agentText.join("");
      expect(reply).toContain(EMBEDDED_TOKEN);
      expect(reply).not.toMatch(/(?<![A-Za-z0-9])xai-[A-Za-z0-9_-]{16,}/u);
      console.info("Real Grok image and embedded prompt passed");
    } finally {
      try {
        await connection.kill();
      } catch {}
      rmSync(workspaceDir, { recursive: true, force: true });
    }
  }, 240_000);
});
