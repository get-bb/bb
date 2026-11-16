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
import {
  buildGrokInterjectParams,
  decodeGrokInterjectResult,
} from "../../../packages/provider-bridge-acp/src/grok-queue.js";
import { isJsonObject } from "../../../packages/provider-bridge-acp/src/session/decode.js";

const INTERJECT_TEXT =
  "INTERJECT_NOW: acknowledge this exact text in your current response.";
const promptResultSchema = z
  .object({
    stopReason: z.string(),
    _meta: z.object({ sessionId: z.string() }).passthrough().optional(),
  })
  .passthrough();

function countOccurrences(text: string, expected: string): number {
  return text.split(expected).length - 1;
}

describe.sequential("real Grok queue and interject", () => {
  it("delivers a native interject before two FIFO follow-ups", async () => {
    const workspaceDir = mkdtempSync(join(tmpdir(), "bb-real-grok-queue-"));
    const agentMessages: string[] = [];
    let notifyFirstOutput: (() => void) | undefined;
    const firstOutput = new Promise<void>((resolve) => {
      notifyFirstOutput = resolve;
    });
    const connection: AcpAgentConnection = createAcpAgentConnection({
      command: "grok",
      args: ["agent", "--no-leader", "stdio"],
      cwd: workspaceDir,
      env: withoutBridgeRuntimeEnv(process.env),
      recordThreadId: null,
      onResponse: () => {},
      onNotification: (method, params) => {
        if (method !== "session/update" || !isJsonObject(params)) {
          return;
        }
        const update = params["update"];
        if (!isJsonObject(update) || !isJsonObject(update["content"])) {
          return;
        }
        const content = update["content"];
        const kind = update["sessionUpdate"];
        if (kind === "agent_thought_chunk") {
          notifyFirstOutput?.();
        }
        if (
          kind === "agent_message_chunk" &&
          content["type"] === "text" &&
          typeof content["text"] === "string"
        ) {
          agentMessages.push(content["text"]);
          notifyFirstOutput?.();
        }
      },
      onRequest: (_method, _params, responder) => {
        responder.error(-32601, "No client requests expected");
      },
      onExit: () => {},
    });

    const prompt = (sessionId: string, text: string) =>
      connection.request({
        method: "session/prompt",
        params: { sessionId, prompt: [{ type: "text", text }] },
        resultSchema: promptResultSchema,
        timeoutMs: 120_000,
      });

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
      const sessionId = session.sessionId;
      const first = prompt(
        sessionId,
        "Write exactly 250 words about the history of telescopes so I can test follow-up input. Do not use tools.",
      );
      await Promise.race([
        firstOutput,
        first.then((result) => {
          throw new Error(
            `Initial prompt ended before interjection: ${result.stopReason}`,
          );
        }),
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error("No initial Grok output within 90 seconds")),
            90_000,
          ),
        ),
      ]);

      const second = prompt(
        sessionId,
        "QUEUE_FIRST: reply with exactly QUEUE_FIRST_DONE when this prompt is reached.",
      );
      const third = prompt(
        sessionId,
        "QUEUE_SECOND: reply with exactly QUEUE_SECOND_DONE when this prompt is reached.",
      );
      const interjectResult = decodeGrokInterjectResult(
        await connection.request({
          method: "_x.ai/interject",
          params: buildGrokInterjectParams({
            sessionId,
            text: INTERJECT_TEXT,
          }),
          resultSchema: z.unknown(),
          timeoutMs: 30_000,
        }),
      );
      expect(interjectResult).toEqual({ status: "queued" });
      const results = await Promise.all([first, second, third]);
      for (const result of results) {
        expect(result.stopReason).toBe("end_turn");
        expect(result._meta?.sessionId).toBe(sessionId);
      }

      const agentText = agentMessages.join("");
      const interjectIndex = agentText.indexOf(INTERJECT_TEXT);
      const firstQueueIndex = agentText.indexOf("QUEUE_FIRST_DONE");
      const secondQueueIndex = agentText.indexOf("QUEUE_SECOND_DONE");
      expect(interjectIndex).toBeGreaterThanOrEqual(0);
      expect(firstQueueIndex).toBeGreaterThan(interjectIndex);
      expect(secondQueueIndex).toBeGreaterThan(firstQueueIndex);
      expect(countOccurrences(agentText, INTERJECT_TEXT)).toBe(1);
      expect(countOccurrences(agentText, "QUEUE_FIRST_DONE")).toBe(1);
      expect(countOccurrences(agentText, "QUEUE_SECOND_DONE")).toBe(1);

      await expect(
        connection.request({
          method: "_x.ai/interject",
          params: { sessionId: "missing-session", text: "missing" },
          resultSchema: z.unknown(),
          timeoutMs: 15_000,
        }),
      ).rejects.toMatchObject({ code: -32602 });
      for (const method of ["_x.ai/queue/interject", "_x.ai/queue/clear"]) {
        await expect(
          connection.request({
            method,
            params: { sessionId },
            resultSchema: z.unknown(),
            timeoutMs: 15_000,
          }),
        ).rejects.toMatchObject({ code: -32601 });
      }
      console.info("Real Grok queue and interject passed");
    } finally {
      try {
        await connection.kill();
      } catch {}
      rmSync(workspaceDir, { recursive: true, force: true });
    }
  }, 240_000);
});
