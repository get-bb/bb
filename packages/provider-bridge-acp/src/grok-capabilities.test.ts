import { describe, expect, it } from "vitest";
import type { AcpAgentCapabilities } from "./client/capabilities.js";
import {
  decodeGrokCapabilitySnapshot,
  GrokUnsupportedCapabilityError,
  requireGrokCapability,
} from "./grok-capabilities.js";

function capabilities(args?: {
  initializeMeta?: Record<string, unknown>;
  meta?: Record<string, unknown>;
}): AcpAgentCapabilities {
  return {
    protocolVersion: 1,
    agentInfo: { name: "grok", version: "1.0.77" },
    prompt: { image: true, audio: false, embeddedContext: true },
    mcp: { http: true, sse: true },
    session: {
      load: true,
      resume: true,
      list: true,
      close: true,
      delete: false,
      fork: false,
      additionalDirectories: false,
    },
    logout: false,
    authMethods: [],
    initializeMeta: args?.initializeMeta ?? {},
    meta: args?.meta ?? {},
  };
}

const liveShapedCapabilities = capabilities({
  initializeMeta: {
    grokShell: true,
    modelState: {
      currentModelId: "grok-test",
      availableModels: [
        {
          modelId: "grok-test",
          _meta: {
            totalContextTokens: 500_000,
            supportsReasoningEffort: true,
            reasoningEffort: "high",
            reasoningEfforts: [
              { id: "xhigh", name: "Extra High" },
              {
                id: "high",
                name: "High",
                description: "Thorough reasoning",
                default: true,
              },
              { id: "medium" },
            ],
          },
        },
        { modelId: "grok-basic", _meta: { totalContextTokens: 256_000 } },
      ],
    },
    availableCommands: [
      { name: "compact", description: "Compact the session" },
      { name: "goal", inputHint: "Describe the goal" },
    ],
    cancelRewind: true,
    sessionRecap: true,
    feedbackTraceOffer: false,
    voiceMode: true,
  },
  meta: {
    "x.ai/fs_notify": true,
    "x.ai/hooks": {
      blockingEvents: ["pre_tool_use", "stop", "subagent_stop"],
      decisions: ["deny", "block"],
      stopSignals: ["continue", "stopReason", "additionalContext"],
    },
    "x.ai/capabilities": {
      toolOverrides: {
        x_keyword_search: true,
        x_semantic_search: true,
        x_user_search: false,
        x_thread_fetch: false,
      },
    },
  },
});

describe("Grok capability decoding", () => {
  it("decodes_live_shaped_models_commands_and_xai_capabilities", () => {
    const snapshot = decodeGrokCapabilitySnapshot(liveShapedCapabilities);

    expect(snapshot).toEqual({
      models: [
        {
          modelId: "grok-test",
          totalContextTokens: 500_000,
          supportsReasoningEffort: true,
          reasoningEffort: "high",
          reasoningEfforts: [
            { id: "xhigh", name: "Extra High" },
            {
              id: "high",
              name: "High",
              description: "Thorough reasoning",
              default: true,
            },
            { id: "medium" },
          ],
        },
        {
          modelId: "grok-basic",
          totalContextTokens: 256_000,
          reasoningEfforts: [],
        },
      ],
      commands: [
        { name: "compact", description: "Compact the session" },
        { name: "goal", inputHint: "Describe the goal" },
      ],
      cancelRewind: true,
      sessionRecap: true,
      voiceMode: true,
      feedbackTraceOffer: false,
      fsNotify: true,
      hooks: {
        blockingEvents: ["pre_tool_use", "stop", "subagent_stop"],
        decisions: ["deny", "block"],
        stopSignals: ["continue", "stopReason", "additionalContext"],
      },
      toolOverrides: {
        x_keyword_search: true,
        x_semantic_search: true,
        x_user_search: false,
        x_thread_fetch: false,
      },
    });
  });

  it("accepts_unknown_future_fields_without_changing_known_values", () => {
    const snapshot = decodeGrokCapabilitySnapshot(
      capabilities({
        initializeMeta: {
          futureRoot: { anything: true },
          modelState: {
            futureModelState: 1,
            availableModels: [
              {
                modelId: "grok-future",
                futureModel: "kept-out-of-the-typed-contract",
                _meta: {
                  totalContextTokens: 123_456,
                  reasoningEfforts: [
                    { id: "future-effort", futureEffort: true },
                  ],
                },
              },
            ],
          },
          availableCommands: [{ name: "future", futureCommand: true }],
        },
      }),
    );

    expect(snapshot.models).toEqual([
      {
        modelId: "grok-future",
        totalContextTokens: 123_456,
        reasoningEfforts: [{ id: "future-effort" }],
      },
    ]);
    expect(snapshot.commands).toEqual([{ name: "future" }]);
  });

  it("rejects_present_malformed_model_state", () => {
    expect(() =>
      decodeGrokCapabilitySnapshot(
        capabilities({
          initializeMeta: {
            modelState: { availableModels: { "grok-test": {} } },
          },
        }),
      ),
    ).toThrow(/availableModels/i);
  });

  it("empty_metadata_produces_no_capabilities", () => {
    expect(decodeGrokCapabilitySnapshot(capabilities())).toEqual({
      models: [],
      commands: [],
      cancelRewind: false,
      sessionRecap: false,
      voiceMode: false,
      feedbackTraceOffer: false,
      fsNotify: false,
      hooks: { blockingEvents: [], decisions: [], stopSignals: [] },
      toolOverrides: {
        x_keyword_search: false,
        x_semantic_search: false,
        x_user_search: false,
        x_thread_fetch: false,
      },
    });
  });

  it("unicode_model_and_command_metadata_survives_decoding", () => {
    const snapshot = decodeGrokCapabilitySnapshot(
      capabilities({
        initializeMeta: {
          modelState: {
            availableModels: [
              {
                modelId: "grok-😀",
                _meta: {
                  reasoningEfforts: [
                    { id: "high", name: "Высокий", description: "詳細な推理" },
                  ],
                },
              },
            ],
          },
          availableCommands: [{ name: "مراجعة", description: "Проверить 😀" }],
        },
      }),
    );

    expect(snapshot.models[0]?.modelId).toBe("grok-😀");
    expect(snapshot.models[0]?.reasoningEfforts).toEqual([
      { id: "high", name: "Высокий", description: "詳細な推理" },
    ]);
    expect(snapshot.commands).toEqual([
      { name: "مراجعة", description: "Проверить 😀" },
    ]);
  });

  it("two_concurrent_grok_sessions_keep_independent_snapshots", async () => {
    const withRewind = capabilities({
      initializeMeta: {
        cancelRewind: true,
        availableCommands: [{ name: "compact" }],
      },
    });
    const withoutRewind = capabilities();

    const [first, second] = await Promise.all([
      Promise.resolve().then(() => decodeGrokCapabilitySnapshot(withRewind)),
      Promise.resolve().then(() => decodeGrokCapabilitySnapshot(withoutRewind)),
    ]);

    expect(first.cancelRewind).toBe(true);
    expect(second.cancelRewind).toBe(false);
    expect(first.commands).toEqual([{ name: "compact" }]);
    expect(second.commands).toEqual([]);
    expect(first).not.toBe(second);
    expect(first.models).not.toBe(second.models);
    expect(second.cancelRewind).toBe(false);
  });

  it("missing_capability_returns_named_unsupported_error", () => {
    const snapshot = decodeGrokCapabilitySnapshot(capabilities());
    const error = requireGrokCapability(snapshot, "cancelRewind");

    expect(error).toBeInstanceOf(GrokUnsupportedCapabilityError);
    expect(error?.message).toContain("cancelRewind");
    expect(error?.message).toContain("not supported");
    expect(
      requireGrokCapability(
        decodeGrokCapabilitySnapshot(liveShapedCapabilities),
        "cancelRewind",
      ),
    ).toBeUndefined();
  });
});
