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
  buildGrokSubagentActionPrompt,
  decodeGrokSubagentActionResult,
  decodeGrokSubagentNotification,
  type GrokSubagentNotification,
} from "../../../packages/provider-bridge-acp/src/grok-subagents.js";
import { isJsonObject } from "../../../packages/provider-bridge-acp/src/session/decode.js";

interface ToolEvent {
  title?: unknown;
  status?: unknown;
  content?: unknown;
  rawInput?: unknown;
  rawOutput?: unknown;
}

interface RealGrokSession {
  connection: AcpAgentConnection;
  sessionId: string;
  workspaceDir: string;
  agentText: string[];
  lifecycle: GrokSubagentNotification[];
  toolEvents: ToolEvent[];
}

const promptResultSchema = z.object({ stopReason: z.string() }).passthrough();
const MESSAGE_TEXT =
  "CHILD_MESSAGE 😀 مراجعة: acknowledge this exact message and finish with CHILD_MESSAGE_DONE.";

async function createRealGrokSession(): Promise<RealGrokSession> {
  const workspaceDir = mkdtempSync(join(tmpdir(), "bb-real-grok-subagents-"));
  const agentText: string[] = [];
  const lifecycle: GrokSubagentNotification[] = [];
  const toolEvents: ToolEvent[] = [];
  const connection = createAcpAgentConnection({
    command: "grok",
    args: ["agent", "--no-leader", "stdio"],
    cwd: workspaceDir,
    env: {
      ...withoutBridgeRuntimeEnv(process.env),
      GROK_ACTIVE_AGENT_MESSAGES: "1",
    },
    recordThreadId: null,
    onResponse: () => {},
    onNotification: (_method, params) => {
      if (!isJsonObject(params) || !isJsonObject(params["update"])) return;
      const update = params["update"];
      const kind = update["sessionUpdate"];
      if (
        kind === "subagent_spawned" ||
        kind === "subagent_progress" ||
        kind === "subagent_finished"
      ) {
        lifecycle.push(decodeGrokSubagentNotification(update));
      }
      if (kind === "tool_call" || kind === "tool_call_update") {
        toolEvents.push({
          title: update["title"],
          status: update["status"],
          content: update["content"],
          rawInput: update["rawInput"],
          rawOutput: update["rawOutput"],
        });
      }
      if (kind === "agent_message_chunk" && isJsonObject(update["content"])) {
        const text = update["content"]["text"];
        if (typeof text === "string") agentText.push(text);
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
    return {
      connection,
      sessionId: session.sessionId,
      workspaceDir,
      agentText,
      lifecycle,
      toolEvents,
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
  } catch {
  } finally {
    rmSync(session.workspaceDir, { recursive: true, force: true });
  }
}

function prompt(session: RealGrokSession, text: string) {
  return session.connection.request({
    method: "session/prompt",
    params: {
      sessionId: session.sessionId,
      prompt: [{ type: "text", text }],
    },
    resultSchema: promptResultSchema,
    timeoutMs: 180_000,
  });
}

async function waitFor<T>(
  read: () => T | undefined,
  description: string,
  timeoutMs = 120_000,
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

function spawnedChild(
  session: RealGrokSession,
  description: string,
): Extract<GrokSubagentNotification, { kind: "spawned" }> {
  const child = session.lifecycle.find(
    (event) => event.kind === "spawned" && event.description === description,
  );
  if (child?.kind !== "spawned") {
    throw new Error(`Missing spawned child ${description}`);
  }
  return child;
}

function finishedChild(
  session: RealGrokSession,
  subagentId: string,
  after = 0,
): Extract<GrokSubagentNotification, { kind: "finished" }> | undefined {
  const event = session.lifecycle
    .slice(after)
    .find(
      (candidate) =>
        candidate.kind === "finished" && candidate.subagentId === subagentId,
    );
  return event?.kind === "finished" ? event : undefined;
}

async function spawnPair(session: RealGrokSession, longWords: number) {
  await prompt(
    session,
    `Use spawn_subagent twice with run_in_background set to true. First use description CHILD_ALPHA and ask the child to write exactly ${longWords} words about the history of telescopes and finish with ALPHA_DONE. Second use description CHILD_BETA and ask it to reply with exactly BETA_DONE. Return both subagent IDs after spawning. Do not do their work yourself and do not use other tools.`,
  );
  await waitFor(
    () =>
      session.lifecycle.filter((event) => event.kind === "spawned").length >= 2
        ? true
        : undefined,
    "two spawned children",
  );
  return {
    alpha: spawnedChild(session, "CHILD_ALPHA"),
    beta: spawnedChild(session, "CHILD_BETA"),
  };
}

async function runParentAction(
  session: RealGrokSession,
  toolName: "send_subagent_message" | "kill_command_or_subagent",
  childRef: string,
  text?: string,
) {
  const eventStart = session.toolEvents.length;
  await prompt(
    session,
    buildGrokSubagentActionPrompt({
      kind: toolName === "send_subagent_message" ? "tell" : "cancel",
      childRef,
      ...(text === undefined ? {} : { text }),
    }),
  );
  const output = await waitFor(
    () =>
      session.toolEvents.slice(eventStart).find((event) => {
        if (event.rawOutput === undefined) return false;
        try {
          decodeGrokSubagentActionResult(toolName, event.rawOutput);
          return true;
        } catch {
          return false;
        }
      }),
    `${toolName} accepted result`,
  );
  return decodeGrokSubagentActionResult(toolName, output.rawOutput);
}

async function expectParentAlive(session: RealGrokSession) {
  const textStart = session.agentText.length;
  await prompt(session, "Reply with exactly PARENT_ALIVE and use no tools.");
  expect(session.agentText.slice(textStart).join("")).toContain("PARENT_ALIVE");
}

describe.sequential("real Grok subagents", () => {
  it("messages only the requested child and preserves exact Unicode text", async () => {
    const session = await createRealGrokSession();
    try {
      const { alpha, beta } = await spawnPair(session, 400);
      await expect(
        session.connection.request({
          method: "_x.ai/interject",
          params: {
            sessionId: alpha.childSessionId,
            text: "direct child interjection must fail",
          },
          resultSchema: z.unknown(),
          timeoutMs: 15_000,
        }),
      ).rejects.toThrow(/session not found/i);

      const unknownStart = session.toolEvents.length;
      await prompt(
        session,
        buildGrokSubagentActionPrompt({
          kind: "tell",
          childRef: "missing-subagent",
          text: "unknown child failure evidence",
        }),
      );
      const unknownOutput = await waitFor(
        () =>
          session.toolEvents
            .slice(unknownStart)
            .find(
              (event) =>
                event.status === "failed" || event.rawOutput !== undefined,
            ),
        "unknown-child tool failure",
      );
      expect(() =>
        decodeGrokSubagentActionResult(
          "send_subagent_message",
          unknownOutput.rawOutput,
        ),
      ).toThrow();

      const sent = await runParentAction(
        session,
        "send_subagent_message",
        alpha.subagentId,
        MESSAGE_TEXT,
      );
      expect(sent.kind).toBe("message");

      const betaFinished = await waitFor(
        () => finishedChild(session, beta.subagentId),
        "sibling completion",
      );
      expect(betaFinished.status).toBe("completed");
      expect(betaFinished.output).toContain("BETA_DONE");
      expect(betaFinished.output).not.toContain(MESSAGE_TEXT);

      const reviewStart = session.lifecycle.length;
      await prompt(
        session,
        `Use spawn_subagent with resume_from=${JSON.stringify(alpha.subagentId)}, run_in_background=false, description="CHILD_MESSAGE_REVIEW", and prompt "Repeat the complete most recent interjection from the root session verbatim, including every emoji and every Arabic character, then finish with CHILD_MESSAGE_DONE. The interjection begins CHILD_MESSAGE. Do not repeat or answer the original telescope instruction.". Return the child's output.`,
      );
      const reviewed = await waitFor(() => {
        const event = session.lifecycle
          .slice(reviewStart)
          .find(
            (candidate) =>
              candidate.kind === "finished" &&
              candidate.output?.includes("CHILD_MESSAGE_DONE"),
          );
        return event?.kind === "finished" ? event : undefined;
      }, "resumed child exact-message review");
      expect(reviewed.output).toContain(MESSAGE_TEXT);
      await expectParentAlive(session);
      console.info("Real Grok targeted subagent message passed");
    } finally {
      await closeRealGrokSession(session);
    }
  }, 420_000);

  it("cancels only the requested child while the sibling and parent continue", async () => {
    const session = await createRealGrokSession();
    try {
      const { alpha, beta } = await spawnPair(session, 800);
      const cancelled = await runParentAction(
        session,
        "kill_command_or_subagent",
        alpha.subagentId,
      );
      expect(cancelled).toEqual({ kind: "cancel", childRef: alpha.subagentId });
      const alphaFinished = await waitFor(
        () => finishedChild(session, alpha.subagentId),
        "target cancellation",
      );
      expect(alphaFinished.status).toBe("cancelled");
      const betaFinished = await waitFor(
        () => finishedChild(session, beta.subagentId),
        "sibling completion after cancellation",
      );
      expect(betaFinished.status).toBe("completed");
      expect(betaFinished.output).toContain("BETA_DONE");
      await expectParentAlive(session);
      console.info("Real Grok targeted subagent cancellation passed");
    } finally {
      await closeRealGrokSession(session);
    }
  }, 360_000);
});
