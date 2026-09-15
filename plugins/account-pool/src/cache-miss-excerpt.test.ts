import { describe, expect, it } from "vitest";
import { readableExcerpt, splitExcerpts } from "./cache-miss-excerpt.js";

describe("splitExcerpts", () => {
  it("splits modified excerpts at the first differing character", () => {
    expect(
      splitExcerpts(
        '{"type":"text","text":"# Environment\\nYou"}',
        '{"type":"text","text":"<reminder>\\n# Environment\\nYou"}',
      ),
    ).toEqual({
      unchanged: '{"type":"text","text":"',
      before: '# Environment\\nYou"}',
      after: '<reminder>\\n# Environment\\nYou"}',
    });
  });

  it.each([
    {
      name: "a two-character escape",
      before: "a\\nb",
      after: "a\\tb",
      unchanged: "a",
    },
    {
      name: "a unicode escape",
      before: "a\\u0001b",
      after: "a\\u0002b",
      unchanged: "a",
    },
    {
      name: "a surrogate pair",
      before: "a\u{1F600}",
      after: "a\u{1F601}",
      unchanged: "a",
    },
  ])("never splits $name", ({ before, after, unchanged }) => {
    const split = splitExcerpts(before, after);
    expect(split.unchanged).toBe(unchanged);
    expect(`${split.unchanged}${split.before}`).toBe(before);
    expect(`${split.unchanged}${split.after}`).toBe(after);
  });

  it("splits after an escaped backslash that precedes the difference", () => {
    expect(splitExcerpts("a\\\\nb", "a\\\\tb")).toEqual({
      unchanged: "a\\\\",
      before: "nb",
      after: "tb",
    });
  });

  it("keeps a one-sided excerpt whole", () => {
    expect(splitExcerpts(null, '{"type":"text"}')).toEqual({
      unchanged: "",
      before: null,
      after: '{"type":"text"}',
    });
    expect(splitExcerpts("same", "same")).toEqual({
      unchanged: "same",
      before: "",
      after: "",
    });
  });
});

describe("readableExcerpt", () => {
  it("decodes newline, tab, quote, slash, and backslash escapes and keeps other escapes", () => {
    expect(
      readableExcerpt('{"text":"a\\nb\\tc \\"q\\" \\/ \\\\n \\u001b[31m \\r"}'),
    ).toBe('{"text":"a\nb\tc "q" / \\n \\u001b[31m \\r"}');
  });
});
