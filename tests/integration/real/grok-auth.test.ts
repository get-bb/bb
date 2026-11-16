import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

const promptResultSchema = z
  .object({
    stopReason: z.string(),
    _meta: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

describe.sequential("real Grok ACP authentication", () => {
  it("authenticates with an advertised method and runs a Unicode prompt", async () => {
    const workspaceDir = mkdtempSync(join(tmpdir(), "bb-real-grok-auth-"));
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
            { type: "text", text: "Reply with exactly AUTH_OK 😀 مراجعة." },
          ],
        },
        resultSchema: promptResultSchema,
        timeoutMs: 180_000,
      });
      expect(result._meta?.["sessionId"]).toBe(session.sessionId);
      expect(agentText.join("")).toContain("AUTH_OK 😀 مراجعة");
      console.info("Real Grok authentication passed");
    } finally {
      try {
        await connection.kill();
      } catch {}
      rmSync(workspaceDir, { recursive: true, force: true });
    }
  }, 240_000);
});
