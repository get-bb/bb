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
  assertGrokForkIdentity,
  buildGrokForkParams,
  decodeGrokForkResult,
} from "../../../packages/provider-bridge-acp/src/grok-fork.js";
import { isJsonObject } from "../../../packages/provider-bridge-acp/src/session/decode.js";

interface SourceSession {
  connection: AcpAgentConnection;
  sessionId: string;
  close: boolean;
}

async function createSource(
  cwd: string,
  chunks: string[],
): Promise<SourceSession> {
  const connection = createAcpAgentConnection({
    command: "grok",
    args: ["agent", "--no-leader", "stdio"],
    cwd,
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
      if (
        update["sessionUpdate"] === "agent_message_chunk" &&
        content["type"] === "text" &&
        typeof content["text"] === "string"
      ) {
        chunks.push(content["text"]);
      }
    },
    onRequest: (_method, _params, responder) => {
      responder.error(-32601, "The fork probe accepts no agent requests");
    },
    onExit: () => {},
  });
  try {
    const agent = await requestAcpInitialize(connection, {
      parameterizedModelPicker: false,
      fsAccess: false,
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
    const created = await connection.request({
      method: "session/new",
      params: { cwd, mcpServers: [] },
      resultSchema: z.object({ sessionId: z.string().min(1) }).passthrough(),
      timeoutMs: 60_000,
    });
    for (const text of [
      "Reply with exactly FIRST_SYNTHETIC and nothing else.",
      "Reply with exactly SECOND_SYNTHETIC and nothing else.",
    ]) {
      await connection.request({
        method: "session/prompt",
        params: {
          sessionId: created.sessionId,
          prompt: [{ type: "text", text }],
        },
        resultSchema: z.unknown(),
        timeoutMs: 90_000,
      });
    }
    return {
      connection,
      sessionId: created.sessionId,
      close: agent.session.close,
    };
  } catch (error) {
    await connection.kill();
    throw error;
  }
}

async function closeSource(source: SourceSession): Promise<void> {
  try {
    if (source.close) {
      await source.connection.request({
        method: "session/close",
        params: { sessionId: source.sessionId },
        resultSchema: z.unknown(),
        timeoutMs: 15_000,
      });
    }
  } finally {
    await source.connection.kill();
  }
}

async function promptHistory(
  connection: AcpAgentConnection,
  sessionId: string,
  chunks: string[],
): Promise<string> {
  chunks.length = 0;
  await connection.request({
    method: "session/prompt",
    params: {
      sessionId,
      prompt: [
        {
          type: "text",
          text: "What were the exact two synthetic words I asked you to reply with earlier? Answer with both words only.",
        },
      ],
    },
    resultSchema: z.unknown(),
    timeoutMs: 90_000,
  });
  return chunks.join("");
}

async function runForkScenario(distinctCwd: boolean): Promise<void> {
  const sourceDir = mkdtempSync(join(tmpdir(), "bb-real-grok-fork-source-"));
  const childDir = distinctCwd
    ? mkdtempSync(join(tmpdir(), "bb-real-grok-fork-child-"))
    : sourceDir;
  const historyChunks: string[] = [];
  const source = await createSource(sourceDir, historyChunks);
  const childSessionIds: string[] = [];
  try {
    const result = decodeGrokForkResult(
      await source.connection.request({
        method: "_x.ai/session/fork",
        params: buildGrokForkParams({
          sourceSessionId: source.sessionId,
          sourceCwd: sourceDir,
          newCwd: childDir,
          mcpServers: [],
        }),
        resultSchema: z.unknown(),
        timeoutMs: 60_000,
      }),
    );
    assertGrokForkIdentity(result, source.sessionId, [source.sessionId]);
    expect(result.newCwd).toBe(childDir);
    expect(result.chatMessagesCopied).toBeGreaterThanOrEqual(0);
    expect(result.updatesCopied).toBeGreaterThanOrEqual(0);
    childSessionIds.push(result.newSessionId);
    await source.connection.request({
      method: "session/load",
      params: {
        sessionId: result.newSessionId,
        cwd: childDir,
        mcpServers: [],
      },
      resultSchema: z.unknown(),
      timeoutMs: 60_000,
    });

    const childHistory = await promptHistory(
      source.connection,
      result.newSessionId,
      historyChunks,
    );
    expect(childHistory).toContain("FIRST_SYNTHETIC");
    expect(childHistory).toContain("SECOND_SYNTHETIC");
    const sourceHistory = await promptHistory(
      source.connection,
      source.sessionId,
      historyChunks,
    );
    expect(sourceHistory).toContain("FIRST_SYNTHETIC");
    expect(sourceHistory).toContain("SECOND_SYNTHETIC");
  } finally {
    for (const sessionId of childSessionIds) {
      if (source.close) {
        await source.connection.request({
          method: "session/close",
          params: { sessionId },
          resultSchema: z.unknown(),
          timeoutMs: 15_000,
        });
      }
    }
    await closeSource(source);
    rmSync(sourceDir, { recursive: true, force: true });
    if (childDir !== sourceDir) {
      rmSync(childDir, { recursive: true, force: true });
    }
  }
}

describe.sequential("real Grok tip fork", () => {
  it("forks in the same cwd with independent source and child history", async () => {
    await runForkScenario(false);
  }, 180_000);

  it("forks into a distinct cwd with independent source and child history", async () => {
    await runForkScenario(true);
  }, 180_000);

  it("returns an error for a missing source session", async () => {
    const workspaceDir = mkdtempSync(
      join(tmpdir(), "bb-real-grok-fork-invalid-"),
    );
    const connection = createAcpAgentConnection({
      command: "grok",
      args: ["agent", "--no-leader", "stdio"],
      cwd: workspaceDir,
      env: withoutBridgeRuntimeEnv(process.env),
      recordThreadId: null,
      onResponse: () => {},
      onNotification: () => {},
      onRequest: (_method, _params, responder) => {
        responder.error(-32601, "The fork probe accepts no agent requests");
      },
      onExit: () => {},
    });
    try {
      const agent = await requestAcpInitialize(connection, {
        parameterizedModelPicker: false,
        fsAccess: false,
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
      await expect(
        connection.request({
          method: "_x.ai/session/fork",
          params: buildGrokForkParams({
            sourceSessionId: "missing-source-session",
            sourceCwd: workspaceDir,
            newCwd: workspaceDir,
            mcpServers: [],
          }),
          resultSchema: z.unknown(),
          timeoutMs: 30_000,
        }),
      ).rejects.toThrow(/not found|missing|invalid|No such file/i);
    } finally {
      await connection.kill();
      rmSync(workspaceDir, { recursive: true, force: true });
    }
  }, 90_000);
});
