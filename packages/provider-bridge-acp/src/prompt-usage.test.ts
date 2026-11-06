import { describe, expect, it } from "vitest";
import {
  breakdownFromPromptUsage,
  nextPromptTokenUsage,
  promptUsageFromResult,
} from "./prompt-usage.js";

describe("promptUsageFromResult", () => {
  it("reads usage from a prompt result and ignores results without it", () => {
    expect(promptUsageFromResult({ stopReason: "end_turn" })).toBeUndefined();
    expect(
      promptUsageFromResult({ stopReason: "end_turn", usage: null }),
    ).toBeUndefined();
    expect(
      promptUsageFromResult({
        stopReason: "end_turn",
        usage: { inputTokens: -1 },
      }),
    ).toBeUndefined();
    expect(
      promptUsageFromResult({
        stopReason: "end_turn",
        usage: { totalTokens: 3, inputTokens: 2, outputTokens: 1 },
      }),
    ).toMatchObject({ totalTokens: 3, inputTokens: 2, outputTokens: 1 });
  });
});

describe("breakdownFromPromptUsage", () => {
  it("takes cache out of input when the agent counts it inside (Copilot CLI 1.0.106)", () => {
    expect(
      breakdownFromPromptUsage({
        inputTokens: 22869,
        outputTokens: 4,
        totalTokens: 22873,
        thoughtTokens: 0,
        cachedReadTokens: 0,
        cachedWriteTokens: 22865,
      }),
    ).toEqual({
      totalTokens: 22873,
      inputTokens: 4,
      cachedInputTokens: 22865,
      cacheReadInputTokens: 0,
      cacheWriteInputTokens: 22865,
      outputTokens: 4,
      reasoningOutputTokens: 0,
    });
  });

  it("keeps input as sent when cache is counted beside it (OpenCode 2.2.4)", () => {
    expect(
      breakdownFromPromptUsage({
        inputTokens: 208,
        outputTokens: 273,
        totalTokens: 36558,
        cachedReadTokens: 36077,
      }),
    ).toEqual({
      totalTokens: 36558,
      inputTokens: 208,
      cachedInputTokens: 36077,
      cacheReadInputTokens: 36077,
      cacheWriteInputTokens: 0,
      outputTokens: 273,
      reasoningOutputTokens: 0,
    });
  });

  it("keeps input as sent with cache reads and writes beside it (claude-agent-acp 0.99.1)", () => {
    expect(
      breakdownFromPromptUsage({
        inputTokens: 2,
        outputTokens: 4,
        cachedReadTokens: 11268,
        cachedWriteTokens: 23034,
        totalTokens: 34308,
      }),
    ).toMatchObject({
      inputTokens: 2,
      cacheReadInputTokens: 11268,
      cacheWriteInputTokens: 23034,
      cachedInputTokens: 34302,
    });
  });

  it("keeps thought tokens as part of output, not added to the total (codex-acp 2.5.0)", () => {
    expect(
      breakdownFromPromptUsage({
        totalTokens: 10827,
        inputTokens: 10773,
        cachedReadTokens: 0,
        cachedWriteTokens: 0,
        outputTokens: 54,
        thoughtTokens: 40,
      }),
    ).toEqual({
      totalTokens: 10827,
      inputTokens: 10773,
      cachedInputTokens: 0,
      cacheReadInputTokens: 0,
      cacheWriteInputTokens: 0,
      outputTokens: 54,
      reasoningOutputTokens: 40,
    });
  });

  it("adds thought tokens to output when the total counts them separately (OpenCode 2.2.4)", () => {
    expect(
      breakdownFromPromptUsage({
        inputTokens: 8806,
        outputTokens: 57,
        totalTokens: 9162,
        thoughtTokens: 43,
        cachedReadTokens: 256,
      }),
    ).toEqual({
      totalTokens: 9162,
      inputTokens: 8806,
      cachedInputTokens: 256,
      cacheReadInputTokens: 256,
      cacheWriteInputTokens: 0,
      outputTokens: 100,
      reasoningOutputTokens: 43,
    });
  });

  it("recognizes cache beside input when the total also counts thought tokens", () => {
    expect(
      breakdownFromPromptUsage({
        inputTokens: 200,
        outputTokens: 50,
        totalTokens: 1260,
        thoughtTokens: 10,
        cachedReadTokens: 1000,
      }),
    ).toMatchObject({
      inputTokens: 200,
      outputTokens: 60,
      reasoningOutputTokens: 10,
    });
  });

  it("does not subtract cache that is larger than input when the total fits neither convention", () => {
    expect(
      breakdownFromPromptUsage({
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 999,
        cachedReadTokens: 100,
      }),
    ).toMatchObject({ inputTokens: 10, cacheReadInputTokens: 100 });
  });
});

describe("nextPromptTokenUsage", () => {
  const usage = (input: number, output: number) => ({
    inputTokens: input,
    outputTokens: output,
    totalTokens: input + output,
  });

  it("sums per-turn usage into a running total", () => {
    const first = nextPromptTokenUsage(null, usage(100, 10));
    expect(first).toMatchObject({
      last: { inputTokens: 100 },
      total: { inputTokens: 100 },
    });
    expect(nextPromptTokenUsage(first.total, usage(30, 5))).toMatchObject({
      last: { inputTokens: 30, outputTokens: 5, totalTokens: 35 },
      total: { inputTokens: 130, outputTokens: 15, totalTokens: 145 },
    });
    expect(first.total.inputTokens).toBe(100);
  });
});
