import { describe, expect, it } from "vitest";
import {
  acpInitializeResultSchema,
  acpSessionForkResultSchema,
  acpSessionNewResultSchema,
} from "./wire.js";

describe("acpInitializeResultSchema", () => {
  it("exposes the unstable session fork capability", () => {
    const parsed = acpInitializeResultSchema.parse({
      protocolVersion: 1,
      agentCapabilities: {
        sessionCapabilities: { fork: {} },
      },
    });

    expect(parsed.agentCapabilities?.sessionCapabilities?.fork).toEqual({});
  });
});

describe("acpSessionNewResultSchema", () => {
  // pi-acp serializes absent optional strings as explicit `null` instead of
  // omitting them. Before this was accepted, every pi-acp thread failed to
  // start with "ACP agent returned an unexpected session/new result".
  it("accepts explicit null for optional model and config-option strings", () => {
    const parsed = acpSessionNewResultSchema.safeParse({
      sessionId: "session-1",
      models: {
        currentModelId: "openai-codex/gpt-5.5",
        availableModels: [
          {
            modelId: "openai-codex/gpt-5.5",
            name: "openai-codex/GPT-5.5",
            description: null,
          },
        ],
      },
      configOptions: [
        {
          type: "select",
          id: "model",
          category: "model",
          name: "Model",
          description: "Select the model for this session",
          currentValue: "openai-codex/gpt-5.5",
          options: [
            {
              value: "openai-codex/gpt-5.5",
              name: "openai-codex/GPT-5.5",
              description: null,
            },
          ],
        },
        {
          type: "select",
          id: "thought_level",
          category: null,
          name: "Thinking",
          currentValue: "medium",
          options: [{ value: "medium", name: null }],
        },
      ],
    });

    expect(parsed.success).toBe(true);
    if (!parsed.success) {
      return;
    }
    expect(
      parsed.data.models?.availableModels?.[0].description,
    ).toBeUndefined();
    expect(parsed.data.configOptions?.[0].options?.[0].name).toBe(
      "openai-codex/GPT-5.5",
    );
    expect(parsed.data.configOptions?.[1].category).toBeUndefined();
    expect(parsed.data.configOptions?.[1].options?.[0].name).toBeUndefined();
  });
});

describe("acpSessionForkResultSchema", () => {
  it("accepts the SDK's nullable configOptions field", () => {
    const parsed = acpSessionForkResultSchema.parse({
      sessionId: "forked-session",
      configOptions: null,
    });

    expect(parsed).toEqual({
      sessionId: "forked-session",
      configOptions: undefined,
    });
  });
});
