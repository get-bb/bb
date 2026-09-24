import { describe, expect, it } from "vitest";
import { cleanGeneratedLine } from "../../src/services/ai/ai-reply.js";

describe("cleanGeneratedLine", () => {
  it.each([
    ["Fix flaky login test", "Fix flaky login test"],
    ['"Fix flaky login test"', "Fix flaky login test"],
    ["“Fix flaky login test”", "Fix flaky login test"],
    ["Title: Fix flaky login test", "Fix flaky login test"],
    ['Commit message: "fix: retry login"', "fix: retry login"],
    ["`fix: retry login`", "fix: retry login"],
    ["**Fix flaky login test**", "Fix flaky login test"],
    ["- fix: retry login", "fix: retry login"],
    ["```\nfix: retry login\n```", "fix: retry login"],
    ["<think>The user wants a title.</think>\nFix login", "Fix login"],
    ["\n\n  fix: retry login  \nBody line", "fix: retry login"],
    ["feat: add dark mode", "feat: add dark mode"],
    ['result(title="Close stale PRs")', "Close stale PRs"],
    [
      'result("refactor: simplify plugin sorting")',
      "refactor: simplify plugin sorting",
    ],
    ["<title>Fix title generation</title>", "Fix title generation"],
    ["Title:\nFix login bug", "Fix login bug"],
    ["Here is a title:\n\nFix login bug", "Fix login bug"],
    ['Commit message:\n\n"fix: retry login"', "fix: retry login"],
    ['""\nFix login bug', "Fix login bug"],
  ])("cleans %j", (raw, expected) => {
    expect(cleanGeneratedLine(raw)).toBe(expected);
  });

  it.each(["", "   ", "<think>never closed", '""', "```\n```", "Title:\n\n"])(
    "returns null for %j",
    (raw) => {
      expect(cleanGeneratedLine(raw)).toBeNull();
    },
  );
});
