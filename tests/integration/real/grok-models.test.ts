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
  findAcpModelConfigOption,
  findAcpThoughtLevelConfigOption,
} from "../../../packages/provider-bridge-acp/src/bridge/model-catalog.js";
import { isJsonObject } from "../../../packages/provider-bridge-acp/src/session/decode.js";
import {
  acpConfigStateResultSchema,
  acpSessionNewResultSchema,
  type AcpConfigOption,
  type AcpConfigStateResult,
} from "../../../packages/provider-bridge-acp/src/wire.js";

const promptResultSchema = z
  .object({
    stopReason: z.string(),
    _meta: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

function optionValues(option: AcpConfigOption | undefined): string[] {
  return [
    ...new Set(
      (option?.options ?? []).map((option) => option.value).filter(Boolean),
    ),
  ];
}

function contextWindowEvidence(state: AcpConfigStateResult) {
  const currentModelId =
    findAcpModelConfigOption(state.configOptions)?.currentValue ??
    state.models?.currentModelId;
  return (state.models?.availableModels ?? []).map((model) => {
    const rawMeta: unknown = Reflect.get(model, "_meta");
    const meta = isJsonObject(rawMeta) ? rawMeta : undefined;
    return {
      modelId: model.modelId,
      current: model.modelId === currentModelId,
      totalContextTokens: meta?.["totalContextTokens"],
    };
  });
}

describe.sequential("real Grok models and reasoning", () => {
  it("selects every advertised model and reasoning value without changing session identity", async () => {
    const workspaceDir = mkdtempSync(join(tmpdir(), "bb-real-grok-models-"));
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
    const prompt = async (sessionId: string, text: string) =>
      connection.request({
        method: "session/prompt",
        params: { sessionId, prompt: [{ type: "text", text }] },
        resultSchema: promptResultSchema,
        timeoutMs: 180_000,
      });
    const setOption = async (
      sessionId: string,
      configId: string,
      value: string,
    ): Promise<AcpConfigStateResult> => {
      const result = await connection.request({
        method: "session/set_config_option",
        params: { sessionId, configId, value },
        resultSchema: z.union([acpConfigStateResultSchema, z.null()]),
        timeoutMs: 60_000,
      });
      expect(result).not.toBeNull();
      if (result === null) throw new Error("Missing config state");
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
        resultSchema: acpSessionNewResultSchema,
        timeoutMs: 60_000,
      });
      let state: AcpConfigStateResult = {
        models: session.models,
        configOptions: session.configOptions,
      };
      const initialModelOption = findAcpModelConfigOption(state.configOptions);
      const modelOptionId = initialModelOption?.id;
      const modelIds = optionValues(initialModelOption);
      expect(modelOptionId).toBeDefined();
      expect(modelIds.length).toBeGreaterThan(1);
      if (modelOptionId === undefined) throw new Error("Missing model option");
      console.info(
        "Real Grok model discovery",
        JSON.stringify({
          models: modelIds,
          currentModelId: initialModelOption?.currentValue,
          reasoning: optionValues(
            findAcpThoughtLevelConfigOption(state.configOptions),
          ),
          contextWindows: contextWindowEvidence(state),
        }),
      );
      const expectedContextWindows = new Map(
        contextWindowEvidence(state).map((model) => [
          model.modelId,
          model.totalContextTokens,
        ]),
      );
      expect(
        [...expectedContextWindows.values()].some(
          (size) => typeof size === "number" && size > 0,
        ),
      ).toBe(true);

      const initial = await prompt(
        session.sessionId,
        "Remember MODEL_MARKER 😀 مراجعة and reply with exactly MODEL_READY.",
      );
      expect(initial._meta?.["sessionId"]).toBe(session.sessionId);
      const observed: {
        modelId: string;
        effort: string;
        usageModels: string[];
      }[] = [];
      let expectedSelections = 0;
      for (const modelId of modelIds) {
        const selected = await setOption(
          session.sessionId,
          modelOptionId,
          modelId,
        );
        state = {
          ...selected,
          models:
            selected.models ??
            (state.models && { ...state.models, currentModelId: modelId }),
        };
        expect(
          findAcpModelConfigOption(state.configOptions)?.currentValue,
        ).toBe(modelId);
        expect(
          contextWindowEvidence(state).find((model) => model.current)
            ?.totalContextTokens,
        ).toBe(expectedContextWindows.get(modelId));
        const reasoningOption = findAcpThoughtLevelConfigOption(
          state.configOptions,
        );
        const reasoningOptionId = reasoningOption?.id;
        const efforts = optionValues(reasoningOption);
        expect(reasoningOptionId).toBeDefined();
        expect(efforts.length).toBeGreaterThan(0);
        if (reasoningOptionId === undefined) {
          throw new Error("Missing reasoning option");
        }
        for (const effort of efforts) {
          const selected = await setOption(
            session.sessionId,
            reasoningOptionId,
            effort,
          );
          state = {
            ...selected,
            models: selected.models ?? state.models,
          };
          expect(
            findAcpThoughtLevelConfigOption(state.configOptions)?.currentValue,
          ).toBe(effort);
          const result = await prompt(
            session.sessionId,
            "Reply with exactly MODEL_OK.",
          );
          expect(result._meta?.["sessionId"]).toBe(session.sessionId);
          expect(result._meta?.["modelId"]).toBe(modelId);
          const usage = isJsonObject(result._meta?.["usage"])
            ? result._meta["usage"]
            : undefined;
          const modelUsage = isJsonObject(usage?.["modelUsage"])
            ? usage["modelUsage"]
            : undefined;
          expect(modelUsage).toBeDefined();
          observed.push({
            modelId,
            effort,
            usageModels: Object.keys(modelUsage ?? {}),
          });
        }
        expectedSelections += efforts.length;
      }
      expect(observed).toHaveLength(expectedSelections);
      for (const row of observed) {
        expect(row.usageModels.length).toBe(1);
      }

      await expect(
        setOption(session.sessionId, modelOptionId, "bb-unknown-model"),
      ).rejects.toThrow();
      await expect(
        setOption(session.sessionId, modelOptionId, ""),
      ).rejects.toThrow();
      const finalReasoningOption = findAcpThoughtLevelConfigOption(
        state.configOptions,
      );
      expect(finalReasoningOption?.id).toBeDefined();
      await expect(
        setOption(
          session.sessionId,
          finalReasoningOption?.id ?? "reasoning_effort",
          "bb-unknown-effort",
        ),
      ).rejects.toThrow();
      await expect(
        setOption(
          session.sessionId,
          finalReasoningOption?.id ?? "reasoning_effort",
          "",
        ),
      ).rejects.toThrow();
      const continuity = await prompt(
        session.sessionId,
        "Reply with MODEL_MARKER 😀 مراجعة and MODEL_CONTINUITY only.",
      );
      expect(continuity._meta?.["sessionId"]).toBe(session.sessionId);
      expect(agentText.join("")).toContain("MODEL_MARKER 😀 مراجعة");
      expect(agentText.join("")).toContain("MODEL_CONTINUITY");
      const currentModelId = findAcpModelConfigOption(
        state.configOptions,
      )?.currentValue;
      expect(currentModelId).toBeDefined();
      const alternateModelId = modelIds.find(
        (modelId) => modelId !== currentModelId,
      );
      expect(alternateModelId).toBeDefined();
      const activePrompt = prompt(
        session.sessionId,
        "Write a detailed 1000-word explanation of incremental computation.",
      );
      const activeSelection = await setOption(
        session.sessionId,
        modelOptionId,
        alternateModelId ?? currentModelId ?? "",
      );
      expect(
        findAcpModelConfigOption(activeSelection.configOptions)?.currentValue,
      ).toBe(alternateModelId);
      const activeResult = await activePrompt;
      expect(activeResult._meta?.["sessionId"]).toBe(session.sessionId);
      const expectedResumedModelId = alternateModelId;
      console.info(
        "Real Grok active-turn model selection",
        JSON.stringify({ outcome: "accepted", expectedResumedModelId }),
      );
      const resumed = await connection.request({
        method: "session/load",
        params: {
          sessionId: session.sessionId,
          cwd: workspaceDir,
          mcpServers: [],
        },
        resultSchema: acpConfigStateResultSchema,
        timeoutMs: 60_000,
      });
      expect(
        findAcpModelConfigOption(resumed.configOptions)?.currentValue,
      ).toBe(expectedResumedModelId);
      const afterResume = await prompt(
        session.sessionId,
        "Reply with MODEL_MARKER 😀 مراجعة and MODEL_RESUMED only.",
      );
      expect(afterResume._meta?.["sessionId"]).toBe(session.sessionId);
      expect(agentText.join("")).toContain("MODEL_RESUMED");
      console.info(
        "Real Grok model selections passed",
        JSON.stringify({ selections: observed.length }),
      );
    } finally {
      try {
        await connection.kill();
      } catch {}
      rmSync(workspaceDir, { recursive: true, force: true });
    }
  }, 900_000);
});
