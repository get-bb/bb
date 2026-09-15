import { describe, expect, it } from "vitest";
import { threadEventTokenUsageBreakdownSchema } from "../src/provider-event.js";

const legacy = {
  totalTokens: 130,
  inputTokens: 100,
  cachedInputTokens: 40,
  outputTokens: 30,
  reasoningOutputTokens: 5,
};

describe("reported cache counts", () => {
  it("preserves independent read/write counts without changing legacy totals", () => {
    const usage = {
      ...legacy,
      cacheReadInputTokens: 31,
      cacheWriteInputTokens: 9,
    };
    expect(threadEventTokenUsageBreakdownSchema.parse(usage)).toEqual(usage);
  });
  it("keeps old events absent and reported zero distinct", () => {
    expect(threadEventTokenUsageBreakdownSchema.parse(legacy)).toEqual(legacy);
    for (const field of ["cacheReadInputTokens", "cacheWriteInputTokens"]) {
      const usage = { ...legacy, [field]: 0 };
      expect(threadEventTokenUsageBreakdownSchema.parse(usage)).toEqual(usage);
    }
  });
  it.each([-1, Infinity, NaN, "4", null])(
    "rejects invalid reported counts %s",
    (value) => {
      for (const field of ["cacheReadInputTokens", "cacheWriteInputTokens"]) {
        expect(
          threadEventTokenUsageBreakdownSchema.safeParse({
            ...legacy,
            [field]: value,
          }).success,
        ).toBe(false);
      }
    },
  );
});
