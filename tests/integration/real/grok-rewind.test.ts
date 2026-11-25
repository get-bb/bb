import { mkdtempSync, readFileSync, rmSync } from "node:fs";
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

const rewindPointSchema = z
  .object({
    prompt_index: z.number().int().nonnegative(),
    created_at: z.string().min(1),
    num_file_snapshots: z.number().int().nonnegative(),
    prompt_preview: z.string(),
    has_file_changes: z.boolean(),
  })
  .passthrough();
const rewindPointsResultSchema = z
  .object({ rewind_points: z.array(rewindPointSchema) })
  .passthrough();
const rewindExecuteResultSchema = z
  .object({
    success: z.boolean(),
    target_prompt_index: z.number().int().nonnegative(),
    mode: z.enum(["all", "conversation_only", "files_only", "code_only"]),
    reverted_files: z.array(z.string()),
    clean_files: z.array(z.string()),
    conflicts: z.array(z.unknown()),
    prompt_text: z.string(),
    error: z.string().nullable(),
  })
  .passthrough();
const promptResultSchema = z
  .object({
    stopReason: z.string(),
    _meta: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

type RewindPoint = z.infer<typeof rewindPointSchema>;

interface RealGrokSession {
  connection: AcpAgentConnection;
  sessionId: string;
  workspaceDir: string;
  agentText: string[];
}

async function createRealGrokSession(
  scenario: string,
): Promise<RealGrokSession> {
  const workspaceDir = mkdtempSync(
    join(tmpdir(), `bb-real-grok-rewind-${scenario}-`),
  );
  const agentText: string[] = [];
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
      if (
        update["sessionUpdate"] === "agent_message_chunk" &&
        isJsonObject(update["content"]) &&
        typeof update["content"]["text"] === "string"
      ) {
        agentText.push(update["content"]["text"]);
      }
    },
    onRequest: (method, params, responder) => {
      if (method === "session/request_permission") {
        const options = isJsonObject(params) ? params["options"] : undefined;
        const option = Array.isArray(options)
          ? (options.find(
              (candidate) =>
                isJsonObject(candidate) && candidate["kind"] === "allow_once",
            ) ?? options[0])
          : undefined;
        if (isJsonObject(option) && typeof option["optionId"] === "string") {
          responder.result({
            outcome: { outcome: "selected", optionId: option["optionId"] },
          });
          return;
        }
      }
      responder.error(-32601, "No client requests expected");
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
    const session = await connection.request({
      method: "session/new",
      params: { cwd: workspaceDir, mcpServers: [] },
      resultSchema: z.object({ sessionId: z.string().min(1) }).passthrough(),
      timeoutMs: 60_000,
    });
    return {
      connection,
      sessionId: session.sessionId,
      workspaceDir,
      agentText,
    };
  } catch (error) {
    await connection.kill();
    rmSync(workspaceDir, { recursive: true, force: true });
    throw error;
  }
}

async function closeRealGrokSession(session: RealGrokSession): Promise<void> {
  try {
    await session.connection.kill();
  } finally {
    rmSync(session.workspaceDir, { recursive: true, force: true });
  }
}

async function prompt(
  session: RealGrokSession,
  text: string,
): Promise<z.infer<typeof promptResultSchema>> {
  session.agentText.length = 0;
  const result = await session.connection.request({
    method: "session/prompt",
    params: {
      sessionId: session.sessionId,
      prompt: [{ type: "text", text }],
    },
    resultSchema: promptResultSchema,
    timeoutMs: 120_000,
  });
  console.info(`Real Grok prompt result: ${JSON.stringify(result)}`);
  return result;
}

async function listPoints(session: RealGrokSession): Promise<RewindPoint[]> {
  const result = await session.connection.request({
    method: "_x.ai/rewind/points",
    params: { sessionId: session.sessionId },
    resultSchema: rewindPointsResultSchema,
    timeoutMs: 30_000,
  });
  console.info(`Real Grok rewind points: ${JSON.stringify(result)}`);
  return result.rewind_points;
}

async function executeRewind(
  session: RealGrokSession,
  targetPromptIndex: number,
  mode: "all" | "conversation_only" | "files_only" | "code_only",
): Promise<z.infer<typeof rewindExecuteResultSchema>> {
  const result = await session.connection.request({
    method: "_x.ai/rewind/execute",
    params: {
      sessionId: session.sessionId,
      targetPromptIndex,
      mode,
      force: true,
    },
    resultSchema: rewindExecuteResultSchema,
    timeoutMs: 60_000,
  });
  console.info(`Real Grok rewind execute: ${JSON.stringify(result)}`);
  return result;
}

describe.sequential("real Grok rewind", () => {
  it("rewinds conversation history to the earliest prompt", async () => {
    const session = await createRealGrokSession("conversation");
    try {
      await prompt(
        session,
        "Reply with exactly FIRST_SYNTHETIC and nothing else.",
      );
      await prompt(
        session,
        "Reply with exactly SECOND_SYNTHETIC and nothing else.",
      );
      const points = await listPoints(session);
      expect(points.length).toBeGreaterThanOrEqual(2);
      const earliest = points.reduce((current, point) =>
        point.prompt_index < current.prompt_index ? point : current,
      );
      expect(earliest.prompt_preview).toContain("FIRST_SYNTHETIC");

      const result = await executeRewind(
        session,
        earliest.prompt_index,
        "conversation_only",
      );
      expect(result.success).toBe(true);
      expect(result.target_prompt_index).toBe(earliest.prompt_index);
      expect(result.mode).toBe("conversation_only");
      expect(result.error).toBeNull();

      const history = await prompt(
        session,
        "What were the exact two synthetic words I asked you to reply with earlier? Answer with both words only, or NONE if there were no such earlier requests.",
      );
      expect(history._meta?.["sessionId"]).toBe(session.sessionId);
      expect(session.agentText.join("")).toContain("NONE");
      expect(session.agentText.join("")).not.toContain("FIRST_SYNTHETIC");
      expect(session.agentText.join("")).not.toContain("SECOND_SYNTHETIC");
    } finally {
      await closeRealGrokSession(session);
    }
  }, 300_000);

  it("restores exact file bytes at the checkpoint before modification", async () => {
    const session = await createRealGrokSession("files");
    try {
      const filePath = join(session.workspaceDir, "rewind-probe.txt");
      await prompt(
        session,
        "Create rewind-probe.txt in the current workspace with exact content BEFORE_REWIND and no trailing newline. Use the available file tools, then reply with exactly FILE_CREATED.",
      );
      expect(readFileSync(filePath, "utf8")).toBe("BEFORE_REWIND");
      await prompt(
        session,
        "Change rewind-probe.txt so its exact content is AFTER_REWIND with no trailing newline. Use the available file tools, then reply with exactly FILE_CHANGED.",
      );
      expect(readFileSync(filePath, "utf8")).toBe("AFTER_REWIND");

      const points = await listPoints(session);
      const target = points.find((point) =>
        point.prompt_preview.startsWith("Change rewind-probe.txt"),
      );
      expect(target).toBeDefined();
      expect(target!.num_file_snapshots).toBeGreaterThan(0);
      expect(target!.has_file_changes).toBe(true);
      const result = await executeRewind(session, target!.prompt_index, "all");
      expect(result.success).toBe(true);
      expect(result.target_prompt_index).toBe(target!.prompt_index);
      expect(result.mode).toBe("all");
      expect(result.error).toBeNull();
      expect(result.reverted_files).toContain("rewind-probe.txt");
      expect(readFileSync(filePath, "utf8")).toBe("BEFORE_REWIND");

      const invalid = await executeRewind(session, 999_999, "all").then(
        (outcome) => ({ kind: "result" as const, outcome }),
        (error: unknown) => ({ kind: "error" as const, error }),
      );
      if (invalid.kind === "error") {
        expect(String(invalid.error)).toMatch(
          /invalid|not found|checkpoint|prompt|index/i,
        );
      } else {
        expect(invalid.outcome.success).toBe(false);
        expect(invalid.outcome.error).toEqual(expect.any(String));
      }
      expect(readFileSync(filePath, "utf8")).toBe("BEFORE_REWIND");
    } finally {
      await closeRealGrokSession(session);
    }
  }, 300_000);
});
