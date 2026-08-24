import { describe, expect, it } from "vitest";
import { createPiModelContextWindowResolverFrom } from "./delta-translation.js";
import { buildPiAvailableModels } from "./model-list.js";

/**
 * Pi model catalog mapping. Moved from the deleted legacy Pi adapter suite:
 * these drive the shared catalog helpers the bridge's model listing uses, so
 * the invariants outlive the adapter.
 */

describe("pi model list", () => {
  it("exposes off as none without changing models that lack off", () => {
    const { models } = buildPiAvailableModels({
      models: [
        {
          id: "kimi-k2.7-code",
          name: "Kimi K2.7 Code",
          provider: "ollama-cloud",
          reasoning: true,
          input: ["text"],
          supportedThinkingLevels: ["off", "low", "medium", "high"],
        },
        {
          id: "minimax-m2.7",
          name: "MiniMax M2.7",
          provider: "ollama-cloud",
          reasoning: true,
          input: ["text"],
          supportedThinkingLevels: ["low", "medium", "high"],
        },
        {
          id: "non-reasoning-model",
          name: "Non-reasoning model",
          provider: "custom",
          reasoning: false,
          input: ["text"],
          supportedThinkingLevels: ["off"],
        },
      ],
    });

    expect(
      models[0]?.supportedReasoningEfforts.map(
        ({ reasoningEffort }) => reasoningEffort,
      ),
    ).toEqual(["none", "low", "medium", "high"]);
    expect(
      models[1]?.supportedReasoningEfforts.map(
        ({ reasoningEffort }) => reasoningEffort,
      ),
    ).toEqual(["low", "medium", "high"]);
    expect(models[2]).toMatchObject({
      supportedReasoningEfforts: [{ reasoningEffort: "none" }],
      defaultReasoningEffort: "none",
    });
  });

  it("routes dated Pi versions to the selected-only bucket", () => {
    const { models, selectedOnlyModels } = buildPiAvailableModels({
      models: [
        {
          id: "claude-opus-4-8",
          name: "Claude Opus 4.8",
          provider: "anthropic",
          reasoning: true,
          input: ["text"],
          supportedThinkingLevels: ["low", "medium", "high", "xhigh"],
        },
        {
          id: "claude-opus-4-6-20240620",
          name: "Claude Opus 4.6 (2024-06-20)",
          provider: "anthropic",
          reasoning: true,
          input: ["text"],
          supportedThinkingLevels: ["low", "medium", "high"],
        },
      ],
    });

    expect(models.map((model) => model.id)).toEqual([
      "anthropic/claude-opus-4-8",
    ]);
    expect(selectedOnlyModels.map((model) => model.id)).toEqual([
      "anthropic/claude-opus-4-6-20240620",
    ]);
    expect(selectedOnlyModels[0]).toEqual(
      expect.objectContaining({
        displayName: "Claude Opus 4.6 (2024-06-20)",
        isDefault: false,
      }),
    );
  });

  it("keeps the provider prefix on aggregator models whose id has a slash", () => {
    // OpenRouter and the Vercel AI Gateway name a model after the vendor that
    // serves it. Without the prefix the id collides with the direct provider.
    const { models } = buildPiAvailableModels({
      models: [
        {
          id: "deepseek/deepseek-v4-flash-0731",
          name: "DeepSeek V4 Flash",
          provider: "openrouter",
          reasoning: true,
          input: ["text"],
          supportedThinkingLevels: ["low", "medium", "high"],
        },
        {
          id: "openai/gpt-5.1-codex",
          name: "GPT-5.1 Codex",
          provider: "openrouter",
          reasoning: true,
          input: ["text"],
          supportedThinkingLevels: ["low", "medium", "high"],
        },
        {
          id: "accounts/fireworks/models/deepseek-v4-flash",
          name: "DeepSeek V4 Flash",
          provider: "fireworks",
          reasoning: false,
          input: ["text"],
          supportedThinkingLevels: [],
        },
      ],
    });

    expect(models.map((model) => model.id)).toEqual([
      "openrouter/deepseek/deepseek-v4-flash-0731",
      "openrouter/openai/gpt-5.1-codex",
      "fireworks/accounts/fireworks/models/deepseek-v4-flash",
    ]);
    // The per-provider default is itself a slashed id, so it only matches once
    // the prefix survives.
    expect(models.find((model) => model.isDefault)?.id).toBe(
      "openrouter/openai/gpt-5.1-codex",
    );
  });

  it("reads the context window of the provider that served the message", () => {
    // Pi's catalog holds 134 of these pairs, and the two sides disagree on the
    // window often enough to matter for compaction.
    const resolveContextWindow = createPiModelContextWindowResolverFrom([
      {
        id: "deepseek/deepseek-v4-flash",
        provider: "openrouter",
        contextWindow: 1_048_575,
      },
      {
        id: "deepseek-v4-flash",
        provider: "deepseek",
        contextWindow: 1_000_000,
      },
    ]);

    const assistant = (provider: string | undefined, model: string) => ({
      role: "assistant" as const,
      content: [],
      ...(provider === undefined ? {} : { provider }),
      model,
    });

    expect(
      resolveContextWindow(
        assistant("openrouter", "deepseek/deepseek-v4-flash"),
      ),
    ).toBe(1_048_575);
    expect(
      resolveContextWindow(assistant("deepseek", "deepseek-v4-flash")),
    ).toBe(1_000_000);
    // Without a provider only the model id is left to match on.
    expect(
      resolveContextWindow(assistant(undefined, "deepseek-v4-flash")),
    ).toBe(1_000_000);
    expect(resolveContextWindow(assistant("openrouter", "unknown"))).toBeNull();
    // A known provider that the catalog does not cover reports nothing rather
    // than borrowing the window another provider published for the same id.
    // The network refresh and custom models both produce this case.
    expect(
      resolveContextWindow(assistant("openrouter", "deepseek-v4-flash")),
    ).toBeNull();
  });
});
