import { describe, expect, it } from "vitest";
import { addTokenUsage, ZERO_TOKEN_USAGE } from "./adapter-utils.js";

describe("reported cache aggregation", () => {
  it("sums independent reported counts and preserves legacy accounting", () => {
    const last = {
      ...ZERO_TOKEN_USAGE,
      totalTokens: 140,
      inputTokens: 80,
      outputTokens: 20,
      cachedInputTokens: 40,
      cacheReadInputTokens: 31,
      cacheWriteInputTokens: 9,
    };
    expect(addTokenUsage(addTokenUsage(ZERO_TOKEN_USAGE, last), last)).toEqual({
      ...last,
      totalTokens: 280,
      inputTokens: 160,
      outputTokens: 40,
      cachedInputTokens: 80,
      cacheReadInputTokens: 62,
      cacheWriteInputTokens: 18,
    });
  });
  it("keeps unreported absent and retains reported subtotals in either order", () => {
    expect(addTokenUsage(ZERO_TOKEN_USAGE, ZERO_TOKEN_USAGE)).toEqual(
      ZERO_TOKEN_USAGE,
    );
    for (const counts of [
      { cacheReadInputTokens: 0 },
      { cacheWriteInputTokens: 0 },
      { cacheReadInputTokens: 17, cacheWriteInputTokens: 3 },
    ]) {
      const reported = { ...ZERO_TOKEN_USAGE, ...counts };
      expect(addTokenUsage(ZERO_TOKEN_USAGE, reported)).toEqual(reported);
      expect(addTokenUsage(reported, ZERO_TOKEN_USAGE)).toEqual(reported);
    }
  });
});
