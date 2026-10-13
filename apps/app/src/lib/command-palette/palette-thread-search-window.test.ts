import { describe, expect, it } from "vitest";
import { windowPaletteThreadSearchText } from "./palette-thread-search-window";

function highlightedText(
  result: ReturnType<typeof windowPaletteThreadSearchText>,
): string[] {
  return result.highlightRanges.map((range) =>
    result.text.slice(range.start, range.end),
  );
}

describe("windowPaletteThreadSearchText", () => {
  it("returns short text whole without ellipses", () => {
    expect(
      windowPaletteThreadSearchText({
        text: "A short matched message",
        highlightRanges: [{ start: 8, end: 15 }],
      }),
    ).toEqual({
      text: "A short matched message",
      highlightRanges: [{ start: 8, end: 15 }],
    });
  });

  it("marks both real cuts and preserves the first match", () => {
    const text = `${"left".repeat(12)} needle ${"right".repeat(12)}`;
    const matchStart = text.indexOf("needle");
    const result = windowPaletteThreadSearchText({
      text,
      highlightRanges: [{ start: matchStart, end: matchStart + 6 }],
    });

    expect(result.text.startsWith("…")).toBe(true);
    expect(result.text.endsWith("…")).toBe(true);
    expect(highlightedText(result)).toEqual(["needle"]);
  });

  it("moves hard targets inward to whitespace word boundaries", () => {
    const text =
      "prefix alpha beta gamma delta MATCH one two three four five six seven trailing";
    const matchStart = text.indexOf("MATCH");
    const result = windowPaletteThreadSearchText({
      text,
      highlightRanges: [{ start: matchStart, end: matchStart + 5 }],
    });

    expect(result.text).toBe(
      "…gamma delta MATCH one two three four five six seven…",
    );
  });

  it("rebases every retained range and merges overlapping input", () => {
    const text = `${"x".repeat(24)} first middle second ${"y".repeat(50)}`;
    const firstStart = text.indexOf("first");
    const secondStart = text.indexOf("second");
    const result = windowPaletteThreadSearchText({
      text,
      highlightRanges: [
        { start: secondStart + 3, end: secondStart + 6 },
        { start: firstStart + 2, end: firstStart + 5 },
        { start: firstStart, end: firstStart + 3 },
        { start: secondStart, end: secondStart + 4 },
      ],
    });

    expect(highlightedText(result)).toEqual(["first", "second"]);
    expect(result.highlightRanges[0]?.start).toBe(
      result.text.indexOf("first"),
    );
    expect(result.highlightRanges[1]?.start).toBe(
      result.text.indexOf("second"),
    );
  });

  it("clamps finite out-of-range input and drops malformed ranges", () => {
    const result = windowPaletteThreadSearchText({
      text: "match remains",
      highlightRanges: [
        { start: Number.NaN, end: 3 },
        { start: 9, end: 4 },
        { start: 100, end: 200 },
        { start: -20, end: 5.9 },
      ],
    });

    expect(result).toEqual({
      text: "match remains",
      highlightRanges: [{ start: 0, end: 5 }],
    });
  });

  it("adds an ellipsis only on the side actually cut near either edge", () => {
    const nearStartText = `match ${"tail".repeat(20)}`;
    const nearStart = windowPaletteThreadSearchText({
      text: nearStartText,
      highlightRanges: [{ start: 0, end: 5 }],
    });
    expect(nearStart.text.startsWith("…")).toBe(false);
    expect(nearStart.text.endsWith("…")).toBe(true);

    const nearEndText = `${"lead".repeat(20)} match`;
    const matchStart = nearEndText.indexOf("match");
    const nearEnd = windowPaletteThreadSearchText({
      text: nearEndText,
      highlightRanges: [{ start: matchStart, end: nearEndText.length }],
    });
    expect(nearEnd.text.startsWith("…")).toBe(true);
    expect(nearEnd.text.endsWith("…")).toBe(false);
  });

  it("never leaves either hard cut inside an emoji surrogate pair", () => {
    const emoji = "\u{1f600}";
    const text = `${"a".repeat(15)}${emoji}${"b".repeat(15)}MATCH${"c".repeat(
      39,
    )}${emoji}${"d".repeat(20)}`;
    const matchStart = text.indexOf("MATCH");
    const result = windowPaletteThreadSearchText({
      text,
      highlightRanges: [{ start: matchStart, end: matchStart + 5 }],
    });

    expect(result.text).not.toMatch(/[\uD800-\uDFFF]/u);
    expect(highlightedText(result)).toEqual(["MATCH"]);
  });

  it("keeps a first match longer than the normal tail window in full", () => {
    const match = "m".repeat(60);
    const text = `${"lead".repeat(10)}${match}${"tail".repeat(20)}`;
    const matchStart = text.indexOf(match);
    const result = windowPaletteThreadSearchText({
      text,
      highlightRanges: [
        { start: matchStart, end: matchStart + match.length },
      ],
    });

    expect(highlightedText(result)).toEqual([match]);
  });
});
