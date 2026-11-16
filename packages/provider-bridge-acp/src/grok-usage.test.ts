import { describe, expect, it } from "vitest";
import {
  decodeGrokPromptUsage,
  grokTokenUsageBreakdownFromMetrics,
  grokUsageCostFromMetrics,
} from "./grok-usage.js";

const fullMetrics = {
  inputTokens: 21_027,
  outputTokens: 53,
  totalTokens: 21_080,
  cachedReadTokens: 2_176,
  cacheCreationTokens: 0,
  reasoningTokens: 50,
  modelCalls: 1,
  apiDurationMs: 2_055,
  costUsdTicks: 132_967_200,
  numTurns: 1,
};

describe("Grok usage metadata", () => {
  it("preserves exact per-model fields and converts observed cost ticks", () => {
    const decoded = decodeGrokPromptUsage({
      _meta: {
        usage: {
          ...fullMetrics,
          modelUsage: { "grok-4.7-build": fullMetrics },
        },
      },
    });
    expect(decoded).toEqual({
      metrics: fullMetrics,
      models: [{ modelId: "grok-4.7-build", metrics: fullMetrics }],
    });
    expect(grokUsageCostFromMetrics(fullMetrics)).toEqual({
      amount: 0.132_967_2,
      currency: "USD",
    });
    expect(grokTokenUsageBreakdownFromMetrics(fullMetrics)).toEqual({
      totalTokens: 21_080,
      inputTokens: 21_027,
      cachedInputTokens: 2_176,
      cacheReadInputTokens: 2_176,
      cacheWriteInputTokens: 0,
      outputTokens: 53,
      reasoningOutputTokens: 50,
    });
  });

  it("distinguishes actual zero from missing metadata", () => {
    const zero = {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      cachedReadTokens: 0,
      cacheCreationTokens: 0,
      reasoningTokens: 0,
    };
    expect(grokTokenUsageBreakdownFromMetrics(zero)).toEqual({
      totalTokens: 0,
      inputTokens: 0,
      cachedInputTokens: 0,
      cacheReadInputTokens: 0,
      cacheWriteInputTokens: 0,
      outputTokens: 0,
      reasoningOutputTokens: 0,
    });
    expect(grokUsageCostFromMetrics({ costUsdTicks: 0 })).toEqual({
      amount: 0,
      currency: "USD",
    });
    expect(grokUsageCostFromMetrics({})).toBeUndefined();
    expect(grokTokenUsageBreakdownFromMetrics({ totalTokens: 0 })).toBeNull();
  });

  it("tolerates unknown future fields", () => {
    expect(
      decodeGrokPromptUsage({
        _meta: { usage: { ...fullMetrics, futureMetric: { safe: true } } },
      }).metrics,
    ).toEqual(fullMetrics);
  });

  it.each([
    { inputTokens: -1 },
    { outputTokens: 1.5 },
    { cachedReadTokens: Number.NaN },
    { cacheCreationTokens: Number.POSITIVE_INFINITY },
    { costUsdTicks: "132967200" },
    { modelCalls: -1 },
    { apiDurationMs: -1 },
    { numTurns: 0 },
  ])("rejects malformed usage metadata", (metrics) => {
    expect(() =>
      decodeGrokPromptUsage({ _meta: { usage: metrics } }),
    ).toThrow();
  });

  it("rejects malformed per-model usage", () => {
    expect(() =>
      decodeGrokPromptUsage({
        _meta: {
          usage: {
            ...fullMetrics,
            modelUsage: { "grok-4.7-build": { inputTokens: -1 } },
          },
        },
      }),
    ).toThrow();
  });
});
