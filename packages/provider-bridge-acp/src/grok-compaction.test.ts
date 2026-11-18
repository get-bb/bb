import { describe, expect, it } from "vitest";
import { decodeGrokCompactionNotification } from "./grok-compaction.js";

describe("Grok compaction notifications", () => {
  it("decodes automatic pressure start with exact context usage", () => {
    expect(
      decodeGrokCompactionNotification({
        sessionUpdate: "auto_compact_started",
        tokens_used: 207_919,
        context_window: 256_000,
        percentage: 81,
        reason: "Context window 81% full",
        futureField: { tolerated: true },
      }),
    ).toEqual({
      kind: "started",
      tokensUsed: 207_919,
      contextWindow: 256_000,
      percentage: 81,
      reason: "Context window 81% full",
    });
  });

  it("decodes exact token reduction and elapsed time", () => {
    expect(
      decodeGrokCompactionNotification({
        sessionUpdate: "auto_compact_completed",
        tokens_before: 207_919,
        tokens_after: 47_689,
        elapsed_ms: 57_353,
        summary_preview: null,
      }),
    ).toEqual({
      kind: "completed",
      tokensBefore: 207_919,
      tokensAfter: 47_689,
      elapsedMs: 57_353,
      summaryPreview: null,
    });
  });

  it("ignores unrelated session updates", () => {
    expect(
      decodeGrokCompactionNotification({ sessionUpdate: "usage_update" }),
    ).toBeNull();
  });

  it.each([
    {
      sessionUpdate: "auto_compact_started",
      tokens_used: -1,
      context_window: 256_000,
      percentage: 81,
    },
    {
      sessionUpdate: "auto_compact_started",
      tokens_used: 100,
      context_window: 0,
      percentage: 81,
    },
    {
      sessionUpdate: "auto_compact_completed",
      tokens_before: 100,
      tokens_after: 50,
      elapsed_ms: -1,
    },
    {
      sessionUpdate: "auto_compact_completed",
      tokens_before: 100,
      tokens_after: 50,
      elapsed_ms: 10,
      summary_preview: 42,
    },
  ])("rejects malformed compaction metadata", (update) => {
    expect(() => decodeGrokCompactionNotification(update)).toThrow();
  });
});
