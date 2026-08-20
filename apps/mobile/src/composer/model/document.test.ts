import type { PromptMentionResource } from "@bb/domain";
import { describe, expect, it } from "vitest";
import {
  applyTextChange,
  computeTextChange,
  createComposerValue,
  deleteRange,
  insertMention,
  insertText,
  mentionEndingAt,
  removeMention,
  replaceRange,
  type ComposerMention,
  type ComposerValue,
} from "./document";

const THREAD: PromptMentionResource = {
  kind: "thread",
  threadId: "thr_1",
  projectId: "proj_1",
  label: "Alpha",
};
const FILE: PromptMentionResource = {
  kind: "path",
  source: "workspace",
  entryKind: "file",
  path: "src/foo.ts",
  label: "foo.ts",
};

function pill(
  start: number,
  end: number,
  resource: PromptMentionResource,
  serializedText: string,
): ComposerMention {
  return { start, end, resource, serializedText };
}

/** "hi @Alpha and @foo.ts ok" with two pills. */
function twoPills(): ComposerValue {
  const text = "hi @Alpha and @foo.ts ok";
  return createComposerValue(text, [
    pill(3, 9, THREAD, "@thread:thr_1"),
    pill(14, 21, FILE, "@src/foo.ts"),
  ]);
}

describe("insertText", () => {
  it("shifts pills after the insertion and keeps pills before it", () => {
    const next = insertText(twoPills(), 2, "XY");
    expect(next.text).toBe("hiXY @Alpha and @foo.ts ok");
    expect(next.mentions.map((m) => [m.start, m.end])).toEqual([
      [5, 11],
      [16, 23],
    ]);
  });

  it("keeps a pill intact when typing at either boundary", () => {
    const atEnd = insertText(twoPills(), 9, "x");
    expect(atEnd.text).toBe("hi @Alphax and @foo.ts ok");
    expect(atEnd.mentions[0]).toMatchObject({ start: 3, end: 9 });
    const atStart = insertText(twoPills(), 3, "x");
    expect(atStart.text).toBe("hi x@Alpha and @foo.ts ok");
    expect(atStart.mentions[0]).toMatchObject({ start: 4, end: 10 });
  });

  it("dissolves a pill when typing inside it", () => {
    const next = insertText(twoPills(), 5, "Z");
    expect(next.text).toBe("hi @AZlpha and @foo.ts ok");
    expect(next.mentions).toHaveLength(1);
    expect(next.mentions[0]).toMatchObject({ start: 15, end: 22 });
  });
});

describe("deleteRange", () => {
  it("removes a whole pill when the range touches it", () => {
    const result = deleteRange(twoPills(), 8, 9);
    expect(result).toMatchObject({ from: 3, to: 9 });
    expect(result.value.text).toBe("hi  and @foo.ts ok");
    expect(result.value.mentions).toEqual([pill(8, 15, FILE, "@src/foo.ts")]);
  });

  it("expands over every pill a selection overlaps", () => {
    const result = deleteRange(twoPills(), 7, 16);
    expect(result).toMatchObject({ from: 3, to: 21 });
    expect(result.value.text).toBe("hi  ok");
    expect(result.value.mentions).toEqual([]);
  });

  it("treats a collapsed range as a no-op", () => {
    const value = twoPills();
    expect(deleteRange(value, 5, 5).value).toBe(value);
  });
});

describe("replaceRange / insertMention / removeMention", () => {
  it("replaces the trigger query with a pill and a trailing space", () => {
    const value = createComposerValue("ask @alp now");
    const result = insertMention(value, {
      from: 4,
      to: 8,
      displayText: "@Alpha",
      serializedText: "@thread:thr_1",
      resource: THREAD,
      trailingText: " ",
    });
    expect(result.value.text).toBe("ask @Alpha  now");
    expect(result.value.mentions).toEqual([
      pill(4, 10, THREAD, "@thread:thr_1"),
    ]);
    expect(result.caret).toBe(11);
  });

  it("removes a pill and reports the caret at its start", () => {
    const value = twoPills();
    const target = mentionEndingAt(value, 9);
    expect(target).not.toBeNull();
    const result = removeMention(value, target!);
    expect(result.value.text).toBe("hi  and @foo.ts ok");
    expect(result.caret).toBe(3);
  });

  it("replaceRange over a pill drops it and shifts the rest", () => {
    const result = replaceRange(twoPills(), 4, 6, "Q");
    expect(result.value.text).toBe("hi Q and @foo.ts ok");
    expect(result.value.mentions).toEqual([pill(9, 16, FILE, "@src/foo.ts")]);
    expect(result.caret).toBe(4);
  });
});

describe("computeTextChange", () => {
  it("finds a plain insertion and deletion by prefix/suffix", () => {
    expect(computeTextChange("hello", "helXlo")).toEqual({
      from: 3,
      to: 3,
      inserted: "X",
    });
    expect(computeTextChange("hello", "helo")).toEqual({
      from: 3,
      to: 4,
      inserted: "",
    });
    expect(computeTextChange("same", "same")).toBeNull();
  });

  it("uses the pre-edit caret to disambiguate repeated characters", () => {
    // Typing "@" right before "@Alpha": the bare diff would put the new "@"
    // inside the pill (index 4); the caret says it went at index 3.
    const previous = "hi @Alpha";
    const next = "hi @@Alpha";
    expect(computeTextChange(previous, next)).toEqual({
      from: 4,
      to: 4,
      inserted: "@",
    });
    expect(computeTextChange(previous, next, { start: 3, end: 3 })).toEqual({
      from: 3,
      to: 3,
      inserted: "@",
    });
    // The same edit reported with the post-edit caret (iOS order).
    expect(computeTextChange(previous, next, { start: 4, end: 4 })).toEqual({
      from: 3,
      to: 3,
      inserted: "@",
    });
  });

  it("reads a backspace caret as the post-edit position first", () => {
    // "a@Alpha" with a pill at [1,7): backspace after the pill leaves the
    // caret at 6 (post-edit); the deleted char is [6,7), inside the pill.
    expect(
      computeTextChange("a@Alpha", "a@Alph", { start: 6, end: 6 }),
    ).toEqual({ from: 6, to: 7, inserted: "" });
    // A pre-edit caret (7) still resolves because only [6,7) reproduces the text.
    expect(
      computeTextChange("a@Alpha", "a@Alph", { start: 7, end: 7 }),
    ).toEqual({ from: 6, to: 7, inserted: "" });
  });

  it("falls back to the diff when the caret hint is inconsistent", () => {
    expect(computeTextChange("abc", "abXc", { start: 0, end: 0 })).toEqual({
      from: 2,
      to: 2,
      inserted: "X",
    });
  });

  it("uses a range selection that was typed over", () => {
    expect(computeTextChange("aaaa", "aXa", { start: 1, end: 3 })).toEqual({
      from: 1,
      to: 3,
      inserted: "X",
    });
  });
});

describe("applyTextChange", () => {
  it("removes the whole pill on backspace at its end and flags the divergence", () => {
    const value = twoPills();
    // Native deleted the last char of "@Alpha".
    const result = applyTextChange(value, "hi @Alph and @foo.ts ok", {
      start: 9,
      end: 9,
    });
    expect(result.value.text).toBe("hi  and @foo.ts ok");
    expect(result.value.mentions).toEqual([pill(8, 15, FILE, "@src/foo.ts")]);
    expect(result.caret).toBe(3);
    expect(result.textDiffersFromInput).toBe(true);
  });

  it("keeps pills when typing after one", () => {
    const result = applyTextChange(twoPills(), "hi @Alpha! and @foo.ts ok", {
      start: 9,
      end: 9,
    });
    expect(result.value.mentions.map((m) => [m.start, m.end])).toEqual([
      [3, 9],
      [15, 22],
    ]);
    expect(result.textDiffersFromInput).toBe(false);
    expect(result.caret).toBe(10);
  });

  it("handles a full clear", () => {
    const result = applyTextChange(twoPills(), "", null);
    expect(result.value.text).toBe("");
    expect(result.value.mentions).toEqual([]);
  });
});
