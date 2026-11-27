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
import { isJsonObject } from "../../../packages/provider-bridge-acp/src/session/decode.js";

interface PromptResult {
  label: string;
  result: {
    stopReason: string;
    _meta?: Record<string, unknown>;
  };
}

const promptResultSchema = z
  .object({
    stopReason: z.string(),
    _meta: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

function usage(result: PromptResult["result"]): Record<string, unknown> {
  const meta = result._meta;
  if (!isJsonObject(meta) || !isJsonObject(meta["usage"])) {
    throw new Error("Missing usage metadata");
  }
  return meta["usage"];
}

describe.sequential("real Grok usage", () => {
  it("reports per-model tokens and cost across cached, reasoning, compacted, and second-model turns", async () => {
    const workspaceDir = mkdtempSync(join(tmpdir(), "bb-real-grok-usage-"));
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
    const results: PromptResult[] = [];
    const prompt = async (sessionId: string, label: string, text: string) => {
      const result = await connection.request({
        method: "session/prompt",
        params: { sessionId, prompt: [{ type: "text", text }] },
        resultSchema: promptResultSchema,
        timeoutMs: 180_000,
      });
      results.push({ label, result });
      return result;
    };
    try {
      const agent = await requestAcpInitialize(connection, {
        parameterizedModelPicker: false,
        fsAccess: false,
        elicitation: true,
      });
      const methodIds = agent.authMethods.map((method) => method.id);
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
        resultSchema: z.object({ sessionId: z.string().min(1) }).passthrough(),
        timeoutMs: 60_000,
      });
      const instruction =
        "Remember USAGE_MARKER 😀 مراجعة and reply with exactly USAGE_OK.";
      await prompt(session.sessionId, "ordinary", instruction);
      await prompt(session.sessionId, "cached-repeat", instruction);
      await connection.request({
        method: "session/set_config_option",
        params: {
          sessionId: session.sessionId,
          configId: "reasoning_effort",
          value: "low",
        },
        resultSchema: z.unknown(),
        timeoutMs: 60_000,
      });
      await prompt(
        session.sessionId,
        "low-reasoning",
        "Reply with exactly LOW_OK.",
      );
      await prompt(session.sessionId, "compaction", "/compact");
      await connection.request({
        method: "session/set_config_option",
        params: {
          sessionId: session.sessionId,
          configId: "model",
          value: "grok-4.5",
        },
        resultSchema: z.unknown(),
        timeoutMs: 60_000,
      });
      await prompt(
        session.sessionId,
        "second-model",
        "Reply with exactly MODEL_OK.",
      );
      await prompt(
        session.sessionId,
        "continuity",
        "Reply with USAGE_MARKER 😀 مراجعة and AFTER_COMPACTION only.",
      );

      const byLabel = new Map(results.map((result) => [result.label, result]));
      for (const [label, result] of byLabel) {
        expect(result.result._meta?.["sessionId"]).toBe(session.sessionId);
        if (label === "compaction" || label === "continuity") continue;
        const currentUsage = usage(result.result);
        for (const field of [
          "inputTokens",
          "outputTokens",
          "totalTokens",
          "cachedReadTokens",
          "cacheCreationTokens",
          "reasoningTokens",
          "modelCalls",
          "apiDurationMs",
          "costUsdTicks",
          "numTurns",
        ]) {
          expect(currentUsage[field], `${label}.${field}`).toEqual(
            expect.any(Number),
          );
        }
        const modelUsage = currentUsage["modelUsage"];
        expect(isJsonObject(modelUsage)).toBe(true);
        if (!isJsonObject(modelUsage)) continue;
        const entries = Object.entries(modelUsage);
        expect(entries).toHaveLength(1);
        const [, perModel] = entries[0]!;
        const {
          modelUsage: _nested,
          numTurns: _turns,
          ...aggregate
        } = currentUsage;
        expect(perModel).toMatchObject(aggregate);
      }
      const cached = usage(byLabel.get("cached-repeat")!.result);
      expect(cached["cachedReadTokens"]).toBeGreaterThan(0);
      expect(cached["cacheCreationTokens"]).toBe(0);
      expect(
        usage(byLabel.get("low-reasoning")!.result)["reasoningTokens"],
      ).toBeGreaterThan(0);
      expect(
        usage(byLabel.get("second-model")!.result)["modelUsage"],
      ).toHaveProperty("grok-4.5-build");
      expect(byLabel.get("second-model")!.result._meta?.["modelId"]).toBe(
        "grok-4.5",
      );
      expect(byLabel.get("compaction")!.result._meta?.["totalTokens"]).toBe(0);
      expect(byLabel.get("compaction")!.result._meta).not.toHaveProperty(
        "usage",
      );
      expect(agentText.join("")).toContain("USAGE_MARKER 😀 مراجعة");
      expect(agentText.join("")).toContain("AFTER_COMPACTION");
      console.info("Real Grok usage and cost metadata passed");
    } finally {
      try {
        await connection.kill();
      } catch {}
      rmSync(workspaceDir, { recursive: true, force: true });
    }
  }, 300_000);
});
