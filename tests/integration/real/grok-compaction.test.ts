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

interface RealGrokSession {
  connection: AcpAgentConnection;
  workspaceDir: string;
  agentText: string[];
  compactEvents: Record<string, unknown>[];
}

const promptResultSchema = z
  .object({
    stopReason: z.string(),
    _meta: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();
const sessionResultSchema = z
  .object({ sessionId: z.string().min(1) })
  .passthrough();

async function createRealGrokSession(): Promise<RealGrokSession> {
  const workspaceDir = mkdtempSync(join(tmpdir(), "bb-real-grok-compaction-"));
  const agentText: string[] = [];
  const compactEvents: Record<string, unknown>[] = [];
  const connection = createAcpAgentConnection({
    command: "grok",
    args: ["agent", "--no-leader", "stdio"],
    cwd: workspaceDir,
    env: withoutBridgeRuntimeEnv(process.env),
    recordThreadId: null,
    onResponse: () => {},
    onNotification: (_method, params) => {
      if (!isJsonObject(params) || !isJsonObject(params["update"])) return;
      const update = params["update"];
      const kind = update["sessionUpdate"];
      if (typeof kind === "string" && kind.includes("compact")) {
        compactEvents.push(update);
      }
      if (kind === "agent_message_chunk" && isJsonObject(update["content"])) {
        const text = update["content"]["text"];
        if (typeof text === "string") agentText.push(text);
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
    return { connection, workspaceDir, agentText, compactEvents };
  } catch (error) {
    await connection.kill();
    rmSync(workspaceDir, { recursive: true, force: true });
    throw error;
  }
}

async function closeRealGrokSession(session: RealGrokSession): Promise<void> {
  try {
    await session.connection.kill();
  } catch {
  } finally {
    rmSync(session.workspaceDir, { recursive: true, force: true });
  }
}

function prompt(
  session: RealGrokSession,
  sessionId: string,
  text: string,
  timeoutMs = 180_000,
) {
  return session.connection.request({
    method: "session/prompt",
    params: { sessionId, prompt: [{ type: "text", text }] },
    resultSchema: promptResultSchema,
    timeoutMs,
  });
}

function newSession(session: RealGrokSession) {
  return session.connection.request({
    method: "session/new",
    params: { cwd: session.workspaceDir, mcpServers: [] },
    resultSchema: sessionResultSchema,
    timeoutMs: 60_000,
  });
}

async function waitFor<T>(
  read: () => T | undefined,
  description: string,
  timeoutMs = 60_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value !== undefined) return value;
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for ${description}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe.sequential("real Grok compaction", () => {
  it("compacts populated and empty sessions while preserving identity and context", async () => {
    const session = await createRealGrokSession();
    try {
      const populated = await newSession(session);
      await prompt(
        session,
        populated.sessionId,
        "Remember this exact token: BEFORE_COMPACTION 😀 مراجعة. Reply with exactly SEED_OK and nothing else.",
      );
      expect(session.compactEvents).toEqual([]);
      const compacted = await prompt(session, populated.sessionId, "/compact");
      expect(compacted.stopReason).toBe("end_turn");
      expect(compacted._meta?.["sessionId"]).toBe(populated.sessionId);
      expect(compacted._meta?.["totalTokens"]).toBe(0);
      await waitFor(
        () =>
          session.compactEvents.some(
            (event) => event["sessionUpdate"] === "auto_compact_completed",
          )
            ? true
            : undefined,
        "manual compaction completion",
      );
      await prompt(
        session,
        populated.sessionId,
        "What exact token did I ask you to remember before compaction? Reply with that token, then AFTER_COMPACTION, and nothing else.",
      );
      expect(session.agentText.join("")).toContain(
        "BEFORE_COMPACTION 😀 مراجعة",
      );
      expect(session.agentText.join("")).toContain("AFTER_COMPACTION");

      const empty = await newSession(session);
      const emptyCompacted = await prompt(session, empty.sessionId, "/compact");
      expect(emptyCompacted.stopReason).toBe("end_turn");
      expect(emptyCompacted._meta?.["sessionId"]).toBe(empty.sessionId);
      await waitFor(
        () =>
          session.compactEvents.filter(
            (event) => event["sessionUpdate"] === "auto_compact_completed",
          ).length >= 2
            ? true
            : undefined,
        "empty-session compaction completion",
      );
      console.info("Real Grok manual and empty compaction passed");
    } finally {
      await closeRealGrokSession(session);
    }
  }, 240_000);

  it("automatically compacts at measured context pressure and remains usable", async () => {
    const session = await createRealGrokSession();
    try {
      const created = await newSession(session);
      await prompt(
        session,
        created.sessionId,
        "Remember BEFORE_PRESSURE 😀 مراجعة and reply with exactly SEED_OK.",
      );
      const block = "CONTEXT_BLOCK_0123456789abcdef\n";
      for (let index = 0; index < 6; index += 1) {
        const result = await prompt(
          session,
          created.sessionId,
          `${block.repeat(30_000)}\nRead synthetic context batch ${index + 1} and reply with exactly PRESSURE_${index + 1}. Do not summarize it.`,
          300_000,
        );
        expect(["end_turn", "cancelled"]).toContain(result.stopReason);
        expect(result._meta?.["sessionId"]).toBe(created.sessionId);
      }
      const started = await waitFor(
        () =>
          session.compactEvents.find(
            (event) => event["sessionUpdate"] === "auto_compact_started",
          ),
        "automatic compaction start",
        120_000,
      );
      expect(started["context_window"]).toBe(256_000);
      const percentage = z.number().parse(started["percentage"]);
      expect(percentage).toBeGreaterThanOrEqual(80);
      expect(percentage).toBeLessThan(100);
      expect(started["reason"]).toBe(`Context window ${percentage}% full`);
      const tokensUsed = z.number().parse(started["tokens_used"]);
      expect(tokensUsed).toBeGreaterThan(200_000);
      expect(tokensUsed).toBeLessThan(220_000);
      const completed = await waitFor(
        () =>
          session.compactEvents.find(
            (event) => event["sessionUpdate"] === "auto_compact_completed",
          ),
        "automatic compaction completion",
        120_000,
      );
      expect(completed["tokens_before"]).toBe(tokensUsed);
      const tokensAfter = z.number().parse(completed["tokens_after"]);
      expect(tokensAfter).toBeGreaterThan(0);
      expect(tokensAfter).toBeLessThan(tokensUsed);
      expect(completed["summary_preview"]).toBeNull();
      await prompt(
        session,
        created.sessionId,
        "Reply with BEFORE_PRESSURE 😀 مراجعة and AFTER_PRESSURE only.",
      );
      expect(session.agentText.join("")).toContain("BEFORE_PRESSURE 😀 مراجعة");
      expect(session.agentText.join("")).toContain("AFTER_PRESSURE");
      console.info("Real Grok automatic pressure compaction passed");
    } finally {
      await closeRealGrokSession(session);
    }
  }, 420_000);
});
