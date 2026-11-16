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
  acpConfigStateResultSchema,
  acpSessionNewResultSchema,
} from "../../../packages/provider-bridge-acp/src/wire.js";
import { isJsonObject } from "../../../packages/provider-bridge-acp/src/session/decode.js";

const sessionListSchema = z.object({
  sessions: z.array(
    z
      .object({
        sessionId: z.string().min(1),
        title: z.string().nullable().optional(),
        updatedAt: z.string().optional(),
      })
      .passthrough(),
  ),
  nextCursor: z.string().nullable().optional(),
});

const promptResultSchema = z
  .object({
    stopReason: z.string(),
    _meta: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

function closeOutcome(result: unknown): unknown {
  if (!isJsonObject(result) || !isJsonObject(result["_meta"])) return undefined;
  return result["_meta"]["x.ai/closeOutcome"];
}

describe.sequential("real Grok session metadata", () => {
  it("preserves identity through Unicode rename, list, close, and resume", async () => {
    const workspaceDir = mkdtempSync(join(tmpdir(), "bb-real-grok-metadata-"));
    const agentText: string[] = [];
    const infoUpdates: Record<string, unknown>[] = [];
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
        if (update["sessionUpdate"] === "session_info_update") {
          infoUpdates.push(update);
        }
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
    const newSession = async () =>
      connection.request({
        method: "session/new",
        params: { cwd: workspaceDir, mcpServers: [] },
        resultSchema: acpSessionNewResultSchema,
        timeoutMs: 60_000,
      });
    const listSessions = async () =>
      connection.request({
        method: "session/list",
        params: {},
        resultSchema: sessionListSchema,
        timeoutMs: 60_000,
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
      const first = await newSession();
      const second = await newSession();
      expect(first.sessionId).not.toBe(second.sessionId);
      await connection.request({
        method: "session/prompt",
        params: {
          sessionId: first.sessionId,
          prompt: [
            { type: "text", text: "Reply with exactly FIRST 😀 مراجعة." },
          ],
        },
        resultSchema: promptResultSchema,
        timeoutMs: 180_000,
      });
      const beforeClose = await listSessions();
      expect(beforeClose.sessions).toContainEqual(
        expect.objectContaining({ sessionId: first.sessionId }),
      );
      expect(beforeClose.sessions).toContainEqual(
        expect.objectContaining({ sessionId: second.sessionId }),
      );
      console.info("Real Grok session list", JSON.stringify(beforeClose));
      await connection.request({
        method: "session/close",
        params: { sessionId: second.sessionId },
        resultSchema: z.unknown(),
        timeoutMs: 60_000,
      });
      const afterClose = await listSessions();
      console.info(
        "Real Grok closed session entry",
        JSON.stringify(
          afterClose.sessions.find(
            (session) => session.sessionId === second.sessionId,
          ),
        ),
      );
      expect(afterClose.sessions).toContainEqual(
        expect.objectContaining({ sessionId: second.sessionId }),
      );
      expect(afterClose.sessions).toContainEqual(
        expect.objectContaining({ sessionId: first.sessionId }),
      );
      const unknownClose = await connection.request({
        method: "session/close",
        params: { sessionId: "bb-unknown-session" },
        resultSchema: z.unknown(),
        timeoutMs: 60_000,
      });
      const repeatedClose = await connection.request({
        method: "session/close",
        params: { sessionId: second.sessionId },
        resultSchema: z.unknown(),
        timeoutMs: 60_000,
      });
      expect(closeOutcome(unknownClose)).toBe("notResident");
      expect(closeOutcome(repeatedClose)).toBe("notResident");
      console.info(
        "Real Grok close outcomes",
        JSON.stringify({ unknownClose, repeatedClose }),
      );
      await connection.request({
        method: "session/load",
        params: {
          sessionId: first.sessionId,
          cwd: workspaceDir,
          mcpServers: [],
        },
        resultSchema: acpConfigStateResultSchema,
        timeoutMs: 60_000,
      });
      const continuity = await connection.request({
        method: "session/prompt",
        params: {
          sessionId: first.sessionId,
          prompt: [{ type: "text", text: "Reply with exactly METADATA_OK." }],
        },
        resultSchema: promptResultSchema,
        timeoutMs: 180_000,
      });
      expect(continuity._meta?.["sessionId"]).toBe(first.sessionId);
      expect(agentText.join("")).toContain("METADATA_OK");
      for (const update of infoUpdates) {
        if (typeof update["updatedAt"] === "string") {
          expect(z.iso.datetime().safeParse(update["updatedAt"]).success).toBe(
            true,
          );
        }
      }
      console.info(
        "Real Grok session metadata passed",
        JSON.stringify({ infoUpdates: infoUpdates.length }),
      );
    } finally {
      try {
        await connection.kill();
      } catch {}
      rmSync(workspaceDir, { recursive: true, force: true });
    }
  }, 300_000);
});
