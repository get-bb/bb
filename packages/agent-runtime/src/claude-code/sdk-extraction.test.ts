import { describe, expect, it } from "vitest";
import { resolveClaudeModelContextWindowHint } from "./sdk-extraction.js";

describe("resolveClaudeModelContextWindowHint", () => {
  it.each(["claude-fable-5", "fable", "best"])(
    "treats %s as a 1M-context Fable model",
    (model) => {
      expect(resolveClaudeModelContextWindowHint(model)).toBe(1_000_000);
    },
  );

  it("keeps the ambiguous default model context unknown", () => {
    expect(resolveClaudeModelContextWindowHint("default")).toBeNull();
  });

  it("uses the default Claude context window for non-1M models", () => {
    expect(resolveClaudeModelContextWindowHint("claude-sonnet-4-6")).toBe(
      200_000,
    );
  });
});
