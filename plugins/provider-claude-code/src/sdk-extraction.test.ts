import { describe, expect, it } from "vitest";
import { resolveClaudeModelContextWindowHint } from "./sdk-extraction.js";

describe("resolveClaudeModelContextWindowHint", () => {
  it.each([
    "claude-fable-5",
    "claude-fable-5-1",
    "claude-mythos-5",
    "claude-mythos-5-1",
    "fable",
    "best",
  ])("treats %s as a 1M-context model", (model) => {
    expect(resolveClaudeModelContextWindowHint(model)).toBe(1_000_000);
  });

  it("keeps the ambiguous default model context unknown", () => {
    expect(resolveClaudeModelContextWindowHint("default")).toBeNull();
  });

  it.each(["claude-sonnet-5", "claude-opus-5-5", "claude-sonnet-5-5"])(
    "keeps routing-dependent capacity unknown for %s",
    (model) => {
      expect(resolveClaudeModelContextWindowHint(model)).toBeNull();
    },
  );
});
