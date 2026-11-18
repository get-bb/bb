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
  decodeGrokPlanApprovalParams,
  grokPlanApprovalResponse,
  grokPlanApprovalSubject,
} from "../../../packages/provider-bridge-acp/src/grok-plan-approval.js";
import { isJsonObject } from "../../../packages/provider-bridge-acp/src/session/decode.js";

const COMMENTS = "Please include a focused test.";

interface PlanScenario {
  name: string;
  decision: "allow_once" | "deny";
  expectedOutcome: "approved" | "cancelled";
  confirmationToken: string;
}

const scenarios: PlanScenario[] = [
  {
    name: "approved",
    decision: "allow_once",
    expectedOutcome: "approved",
    confirmationToken: "PLAN_APPROVED_CONFIRMED",
  },
  {
    name: "request changes",
    decision: "deny",
    expectedOutcome: "cancelled",
    confirmationToken: "PLAN_CHANGES_REQUESTED",
  },
];

async function runScenario(scenario: PlanScenario): Promise<void> {
  const workspaceDir = mkdtempSync(join(tmpdir(), "bb-real-grok-plan-"));
  let agentText = "";
  let answered: Record<string, unknown> | undefined;
  let capturedPlan: string | undefined;
  let capturedSubjectPlan: string | undefined;
  const connection: AcpAgentConnection = createAcpAgentConnection({
    command: "grok",
    args: ["--permission-mode", "plan", "agent", "--no-leader", "stdio"],
    cwd: workspaceDir,
    env: withoutBridgeRuntimeEnv(process.env),
    recordThreadId: null,
    requestMethods: ["_x.ai/exit_plan_mode"],
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
        agentText += content["text"];
      }
    },
    onRequest: (method, params, responder) => {
      if (method !== "_x.ai/exit_plan_mode") {
        responder.error(-32601, `Unexpected request: ${method}`);
        return;
      }
      try {
        const request = decodeGrokPlanApprovalParams(params);
        capturedPlan = request.planContent;
        capturedSubjectPlan = grokPlanApprovalSubject(request).plan;
        answered =
          scenario.decision === "allow_once"
            ? grokPlanApprovalResponse({
                decision: scenario.decision,
                grantedPermissions: null,
              })
            : grokPlanApprovalResponse({
                decision: scenario.decision,
                comments: COMMENTS,
              });
        responder.result(answered);
      } catch (error) {
        responder.error(
          -32602,
          error instanceof Error ? error.message : String(error),
        );
      }
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
    const result = await connection.request({
      method: "session/prompt",
      params: {
        sessionId: session.sessionId,
        prompt: [
          {
            type: "text",
            text: "Create a very short implementation plan for a hello function and call exit_plan_mode when the plan is ready. Do not write or modify any files.",
          },
        ],
      },
      resultSchema: z.object({ stopReason: z.string() }).passthrough(),
      timeoutMs: 90_000,
    });

    expect(capturedPlan).toEqual(expect.any(String));
    expect(capturedSubjectPlan).toBe(capturedPlan);
    expect(result.stopReason).toBe("end_turn");
    expect(answered).toEqual({
      outcome: scenario.expectedOutcome,
      ...(scenario.decision === "deny" ? { comments: COMMENTS } : {}),
    });

    agentText = "";
    await connection.request({
      method: "session/prompt",
      params: {
        sessionId: session.sessionId,
        prompt: [
          {
            type: "text",
            text: `Inspect the immediately preceding exit_plan_mode result. Reply with exactly ${scenario.confirmationToken} if that result matches your verdict; otherwise reply VERDICT_MISMATCH.`,
          },
        ],
      },
      resultSchema: z.object({ stopReason: z.string() }).passthrough(),
      timeoutMs: 90_000,
    });
    expect(agentText).toContain(scenario.confirmationToken);
    expect(agentText).not.toContain("VERDICT_MISMATCH");
    console.info(`Real Grok plan approval passed: ${scenario.name}`);
  } finally {
    await connection.kill();
    rmSync(workspaceDir, { recursive: true, force: true });
  }
}

describe.sequential("real Grok plan approval", () => {
  for (const scenario of scenarios) {
    it(
      scenario.name,
      async () => {
        await runScenario(scenario);
      },
      180_000,
    );
  }
});
