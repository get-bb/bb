import { describe, expect, it } from "vitest";
import type { PromptTextMention } from "@bb/domain";
import { fallbackMentionRanges } from "./fallback-mention-ranges";

const file = (start: number, end: number): PromptTextMention => ({
  start,
  end,
  resource: {
    kind: "path",
    source: "workspace",
    entryKind: "file",
    path: "src/a.ts",
    label: "a.ts",
  },
});

describe("fallbackMentionRanges", () => {
  it("keeps mentions when text is appended after them", () => {
    expect(
      fallbackMentionRanges("see @a.ts", "see @a.ts now", [file(4, 9)]),
    ).toEqual([file(4, 9)]);
  });

  it("shifts mentions after an insertion before them", () => {
    expect(
      fallbackMentionRanges("@a.ts fix", "ok @a.ts fix", [file(0, 5)]),
    ).toEqual([file(3, 8)]);
  });

  it("drops a mention whose text was edited", () => {
    expect(
      fallbackMentionRanges("see @a.ts", "see @b.ts", [file(4, 9)]),
    ).toEqual([]);
  });

  it("drops a mention that was deleted and keeps the others", () => {
    expect(
      fallbackMentionRanges("@a.ts and @a.ts", "@a.ts and ", [
        file(0, 5),
        file(10, 15),
      ]),
    ).toEqual([file(0, 5)]);
  });

  it("returns nothing when the whole text is replaced", () => {
    expect(fallbackMentionRanges("@a.ts", "hello", [file(0, 5)])).toEqual([]);
  });
});
