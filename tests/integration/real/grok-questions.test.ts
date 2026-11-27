import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  userQuestionPendingInteractionPayloadSchema,
  type PendingInteractionUserAnswer,
} from "@bb/domain";
import { withoutBridgeRuntimeEnv } from "@bb/provider-bridge-protocol/bridge-kit";
import {
  createAcpAgentConnection,
  requestAcpInitialize,
  type AcpAgentConnection,
} from "../../../packages/provider-bridge-acp/src/bridge/agent-connection.js";
import { isJsonObject } from "../../../packages/provider-bridge-acp/src/session/decode.js";
import {
  buildGrokQuestionPlan,
  decodeGrokQuestionRequest,
  grokQuestionResponse,
} from "../../../packages/provider-bridge-acp/src/grok-questions.js";

interface QuestionScenario {
  name: string;
  prompt: string;
  answer(
    questions: readonly {
      id: string;
      options?: readonly { value: string }[];
    }[],
  ): Record<string, PendingInteractionUserAnswer>;
  expectedAnswers: Record<string, string | string[]>;
  expectedAnnotations: Record<string, { notes?: string; preview?: string }>;
}

const scenarios: QuestionScenario[] = [
  {
    name: "single-select with preview",
    prompt:
      "Use the ask_user_question tool immediately. Ask exactly one single-select question with the text 'Choose synthetic option'. Options must be 'Alpha' with description 'First synthetic choice' and preview 'PREVIEW_ALPHA', and 'Beta' with description 'Second synthetic choice' and preview 'PREVIEW_BETA'. After the answer, repeat the selected option exactly. Do not perform other tools.",
    answer: (questions) => ({
      [questions[0]!.id]: { selected: ["Alpha"] },
    }),
    expectedAnswers: { "Choose synthetic option": "Alpha" },
    expectedAnnotations: {
      "Choose synthetic option": { preview: "PREVIEW_ALPHA" },
    },
  },
  {
    name: "multi-select",
    prompt:
      "Use the ask_user_question tool immediately. Ask exactly one multi-select question with the text 'Choose extras'. Options must be 'Logo' with preview 'LOGO_PREVIEW', 'Tagline' with preview 'TAGLINE_PREVIEW', and 'Icon'. After the answer, repeat every selected option exactly. Do not perform other tools.",
    answer: (questions) => ({
      [questions[0]!.id]: { selected: ["Logo", "Icon"] },
    }),
    expectedAnswers: { "Choose extras": ["Logo", "Icon"] },
    expectedAnnotations: { "Choose extras": { preview: "LOGO_PREVIEW" } },
  },
  {
    name: "Other with Unicode notes",
    prompt:
      "Use the ask_user_question tool immediately. Ask exactly one single-select question with the text 'Выберите стек 😀'. Options must be 'TypeScript' with description '詳細な選択肢' and 'Other (please specify)'. After the answer, repeat the selected option and any notes exactly. Do not perform other tools.",
    answer: (questions) => ({
      [questions[0]!.id]: {
        selected: ["Other (please specify)"],
        freeText: "Rust и مراجعة 😀",
      },
    }),
    expectedAnswers: { "Выберите стек 😀": "Other (please specify)" },
    expectedAnnotations: {
      "Выберите стек 😀": { notes: "Rust и مراجعة 😀" },
    },
  },
];

async function runScenario(scenario: QuestionScenario): Promise<void> {
  const workspaceDir = mkdtempSync(join(tmpdir(), "bb-real-grok-question-"));
  let agentText = "";
  let answered: Record<string, unknown> | undefined;
  const connection: AcpAgentConnection = createAcpAgentConnection({
    command: "grok",
    args: ["agent", "--no-leader", "stdio"],
    cwd: workspaceDir,
    env: withoutBridgeRuntimeEnv(process.env),
    recordThreadId: null,
    requestMethods: ["_x.ai/ask_user_question"],
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
      if (method !== "_x.ai/ask_user_question") {
        responder.error(-32601, `Unexpected request: ${method}`);
        return;
      }
      try {
        const request = decodeGrokQuestionRequest(params);
        const plan = buildGrokQuestionPlan(request);
        if (plan.kind !== "questions") {
          throw new Error("Grok question did not produce a question plan");
        }
        userQuestionPendingInteractionPayloadSchema.parse(plan.payload);
        const answers = scenario.answer(plan.payload.questions);
        const response = plan.toResponse({ kind: "user_answer", answers });
        if ("unmappable" in response) {
          throw new Error(response.unmappable);
        }
        answered = grokQuestionResponse(request, response);
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
        prompt: [{ type: "text", text: scenario.prompt }],
      },
      resultSchema: z.object({ stopReason: z.string() }).passthrough(),
      timeoutMs: 90_000,
    });

    expect(result.stopReason).toBe("end_turn");
    expect(answered).toMatchObject({
      outcome: "accepted",
      answers: scenario.expectedAnswers,
      annotations: scenario.expectedAnnotations,
    });
    const firstAnswer = Object.values(scenario.expectedAnswers)[0];
    expect(agentText).toContain(
      Array.isArray(firstAnswer) ? firstAnswer[0] : firstAnswer,
    );
    if (scenario.name === "Other with Unicode notes") {
      expect(agentText).toContain("Rust и مراجعة 😀");
    }
    console.info(`Real Grok question passed: ${scenario.name}`);
  } finally {
    await connection.kill();
    rmSync(workspaceDir, { recursive: true, force: true });
  }
}

describe.sequential("real Grok structured questions", () => {
  for (const scenario of scenarios) {
    it(
      scenario.name,
      async () => {
        await runScenario(scenario);
      },
      120_000,
    );
  }
});
