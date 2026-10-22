import { describe, expect, it } from "vitest";
import { parseMarkdownRanges, type MarkdownRangeKind } from "./markdown.js";

function texts(text: string, kind: MarkdownRangeKind) {
  return parseMarkdownRanges(text)[kind].map(({ from, to }) =>
    text.slice(from, to),
  );
}

describe("parseMarkdownRanges", () => {
  it("styles headings and hides their markers", () => {
    const text = "# Title\n### Small\n#### Smaller\n#hashtag";
    expect(texts(text, "h1")).toEqual(["Title"]);
    expect(texts(text, "h3")).toEqual(["Small", "Smaller"]);
    expect(texts(text, "marker")).toEqual(["# ", "### ", "#### "]);
  });

  it("marks bullets, keeps nested indentation, and keeps typed numbers", () => {
    const text = "- a\n  * b\n1. one\n1. again\n3) three\n-not a list";
    expect(texts(text, "bullet")).toEqual(["- ", "* "]);
    expect(texts(text, "ordered")).toEqual(["1.", "1.", "3)"]);
  });

  it("hides inline delimiters around bold, italic, and code", () => {
    const text = "**bold** and __also__, *it* and _em_, `co*de*`";
    expect(texts(text, "strong")).toEqual(["bold", "also"]);
    expect(texts(text, "em")).toEqual(["it", "em"]);
    expect(texts(text, "code")).toEqual(["co*de*"]);
    expect(texts(text, "marker")).toEqual([
      "`",
      "`",
      "**",
      "**",
      "__",
      "__",
      "*",
      "*",
      "_",
      "_",
    ]);
  });

  it("leaves snake_case words and unmatched delimiters alone", () => {
    const text = "call snake_case_name or 2 * 3 * 4 or **open";
    expect(texts(text, "em")).toEqual([]);
    expect(texts(text, "strong")).toEqual([]);
    expect(texts(text, "marker")).toEqual([]);
  });

  it("keeps bold and italic around and after inline code", () => {
    const text =
      "call `f(**kwargs)` then **stop** and **Rename `foo`** *use `x`*";
    expect(texts(text, "code")).toEqual(["f(**kwargs)", "foo", "x"]);
    expect(texts(text, "strong")).toEqual(["stop", "Rename `foo`"]);
    expect(texts(text, "em")).toEqual(["use `x`"]);
  });

  it("matches backtick runs of equal length", () => {
    const text = "run ```npm i``` and ``a`b`` now";
    expect(texts(text, "code")).toEqual(["npm i", "a`b"]);
    expect(texts(text, "marker")).toEqual(["```", "```", "``", "``"]);
  });

  it("nests bold and italic", () => {
    expect(texts("***both***", "em")).toEqual(["both"]);
    expect(texts("***both***", "strong")).toEqual(["*both*"]);
    expect(texts("*a **b** c*", "em")).toEqual(["a **b** c"]);
    expect(texts("*a **b** c*", "strong")).toEqual(["b"]);
  });

  it("treats a one-line triple-backtick span as inline code, not a fence", () => {
    const text = "```npm install```\n**bold after**\n# Heading";
    expect(texts(text, "code")).toEqual(["npm install"]);
    expect(texts(text, "strong")).toEqual(["bold after"]);
    expect(texts(text, "h1")).toEqual(["Heading"]);
  });

  it("formats quoted lines and skips fenced code", () => {
    const text = "> **quoted**\n```\n# not a heading\n```\n# heading";
    expect(texts(text, "strong")).toEqual(["quoted"]);
    expect(texts(text, "h1")).toEqual(["heading"]);
  });
});
