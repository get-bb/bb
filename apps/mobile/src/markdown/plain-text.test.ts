import { describe, expect, it } from "vitest";
import { extractMarkdownHeadings, markdownToPlainText } from "./plain-text";

describe("markdownToPlainText", () => {
  it("strips inline markup and keeps block structure readable", () => {
    const text = markdownToPlainText(
      [
        "---",
        "title: Doc",
        "---",
        "# Title",
        "",
        "Some **bold** and [a link](https://x.y) plus `code`.",
        "",
        "- one",
        "- [x] two",
        "",
        "1. first",
        "2. second",
        "",
        "![diagram](http://x/d.png)",
        "",
        "> quoted *text*",
        "",
        "```ts",
        "const x = 1;",
        "```",
        "",
        "| h | i |",
        "| - | - |",
        "| 1 | 2 |",
      ].join("\n"),
    );
    expect(text).toBe(
      [
        "Title",
        "Some bold and a link plus code.",
        "- one\n[x] two",
        "1. first\n2. second",
        "diagram",
        "quoted text",
        "const x = 1;",
        "h | i\n1 | 2",
      ].join("\n"),
    );
  });

  it("returns an empty string for blank input", () => {
    expect(markdownToPlainText("  \n")).toBe("");
  });
});

describe("extractMarkdownHeadings", () => {
  it("lists headings with depth and source line, offset past frontmatter", () => {
    expect(
      extractMarkdownHeadings(
        ["---", "a: b", "---", "# One", "", "text", "## Two *em*", "### "].join(
          "\n",
        ),
      ),
    ).toEqual([
      { depth: 1, text: "One", line: 4 },
      { depth: 2, text: "Two em", line: 7 },
    ]);
    expect(extractMarkdownHeadings("no headings")).toEqual([]);
  });
});
