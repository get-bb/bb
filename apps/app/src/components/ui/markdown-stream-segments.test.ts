import { describe, expect, it } from "vitest";
import { splitMarkdownStreamSegments } from "./markdown-stream-segments";

// A small minimum keeps fixtures readable. It changes only coalescing, not
// which Markdown boundaries are safe.
const split = (body: string) =>
  splitMarkdownStreamSegments(body, { minSegmentChars: 1 });

describe("splitMarkdownStreamSegments", () => {
  it("concatenates segments back to the exact input", () => {
    const body = "First paragraph.\n\nSecond paragraph.\n\nThird paragraph.\n";
    expect(split(body).join("")).toBe(body);
    expect(split(body)).toHaveLength(3);
  });

  it("attaches blank-line runs to the preceding segment", () => {
    expect(split("One.\n\n\n\nTwo.\n")).toEqual(["One.\n\n\n\n", "Two.\n"]);
  });

  it("returns the whole body when there is no safe boundary", () => {
    expect(split("Only one paragraph.\n")).toEqual(["Only one paragraph.\n"]);
    expect(split("")).toEqual([""]);
  });

  it("never splits inside backtick and tilde code fences", () => {
    expect(split("```py\nfirst = 1\n\nsecond = 2\n```\n\nAfter.\n")).toEqual([
      "```py\nfirst = 1\n\nsecond = 2\n```\n\n",
      "After.\n",
    ]);
    expect(split("~~~\na\n\nb\n~~~\n\nAfter.\n")).toEqual([
      "~~~\na\n\nb\n~~~\n\n",
      "After.\n",
    ]);
  });

  it("requires the closing fence to match the opening run length", () => {
    expect(split("````\n```\n\nstill code\n````\n\nAfter.\n")).toEqual([
      "````\n```\n\nstill code\n````\n\n",
      "After.\n",
    ]);
  });

  it("treats an unclosed fence as extending to the end", () => {
    expect(split("Intro.\n\n```js\ncode\n\nmore code")).toEqual([
      "Intro.\n\n",
      "```js\ncode\n\nmore code",
    ]);
  });

  it("ignores a backtick fence whose info string contains a backtick", () => {
    expect(split("``` a`b\n\nAfter.\n")).toEqual(["``` a`b\n\n", "After.\n"]);
  });

  it("never splits inside block math", () => {
    expect(split("$$\nx = 1\n\ny = 2\n$$\n\nAfter.\n")).toEqual([
      "$$\nx = 1\n\ny = 2\n$$\n\n",
      "After.\n",
    ]);
    expect(split("$$x^2$$\n\nAfter.\n")).toEqual(["$$x^2$$\n\n", "After.\n"]);
  });

  it("keeps directive documents in one segment for message-wide limits", () => {
    const container = ":::note\nfirst\n\nsecond\n:::\n\nAfter.\n";
    const leaves = '::inline-vis{file="one.html"}\n\nAfter.\n';
    expect(split(container)).toEqual([container]);
    expect(split(leaves)).toEqual([leaves]);
  });

  it("never splits inside multiline raw HTML blocks", () => {
    expect(split("<!-- start\n\nstill hidden -->\n\nAfter.\n")).toEqual([
      "<!-- start\n\nstill hidden -->\n\n",
      "After.\n",
    ]);
    expect(split("<pre>\na\n\nb\n</pre>\n\nAfter.\n")).toEqual([
      "<pre>\na\n\nb\n</pre>\n\n",
      "After.\n",
    ]);
  });

  it("splits after a single-line HTML comment", () => {
    expect(split("<!-- done -->\n\nAfter.\n")).toEqual([
      "<!-- done -->\n\n",
      "After.\n",
    ]);
  });

  it("keeps document-wide link and footnote definitions in one segment", () => {
    const reference = "See [docs].\n\n[docs]: https://example.com\n\nAfter.\n";
    const footnote = "Claim.[^1]\n\n[^1]: The footnote.\n";
    expect(split(reference)).toEqual([reference]);
    expect(split(footnote)).toEqual([footnote]);
  });

  it("does not mistake an inline link for a definition", () => {
    expect(split("[Click](https://example.com).\n\nAfter.\n")).toEqual([
      "[Click](https://example.com).\n\n",
      "After.\n",
    ]);
  });

  it("does not split loose, ordered, or indented list content", () => {
    expect(split("- one\n\n- two\n\nAfter.\n")).toEqual([
      "- one\n\n- two\n\n",
      "After.\n",
    ]);
    expect(split("1. one\n\n2) two\n\nAfter.\n")).toEqual([
      "1. one\n\n2) two\n\n",
      "After.\n",
    ]);
    expect(split("- item\n\n  continuation\n\nAfter.\n")).toEqual([
      "- item\n\n  continuation\n\n",
      "After.\n",
    ]);
    expect(split("    code a\n\n    code b\n\nAfter.\n")).toEqual([
      "    code a\n\n    code b\n\n",
      "After.\n",
    ]);
  });

  it("splits before independent top-level blocks", () => {
    expect(split("Intro.\n\n## Heading\n\n> quote\n\n---\n\nOutro.\n")).toEqual(
      ["Intro.\n\n", "## Heading\n\n", "> quote\n\n", "---\n\n", "Outro.\n"],
    );
  });

  it("defers a boundary while the next line is incomplete", () => {
    expect(split("Para.\n\n-")).toEqual(["Para.\n\n-"]);
    expect(split("Para.\n\n- item")).toEqual(["Para.\n\n- item"]);
    expect(split("Para.\n\nNext line\nstill streaming")).toEqual([
      "Para.\n\n",
      "Next line\nstill streaming",
    ]);
  });

  it("keeps completed segments byte-stable while the body grows", () => {
    const chunks = [
      "Intro paragraph.",
      "\n\n```ts\nconst a",
      " = 1;\n\nconst b = 2;\n```",
      "\n\n## Results\n\n",
      "- first\n\n- second\n\nClosing ",
      "paragraph.\n",
    ];
    let body = "";
    let previous: string[] = [];
    for (const chunk of chunks) {
      body += chunk;
      const segments = split(body);
      expect(segments.join("")).toBe(body);
      for (let index = 0; index < previous.length - 1; index += 1) {
        expect(segments[index]).toBe(previous[index]);
      }
      previous = segments;
    }
  });

  it("coalesces segments below the configured minimum", () => {
    expect(
      splitMarkdownStreamSegments("aa.\n\nbb.\n\ncc.\n\ndd.\n", {
        minSegmentChars: 10,
      }),
    ).toEqual(["aa.\n\nbb.\n\n", "cc.\n\ndd.\n"]);
  });

  it("handles CRLF line endings", () => {
    expect(split("One.\r\n\r\nTwo.\r\n")).toEqual(["One.\r\n\r\n", "Two.\r\n"]);
  });
});
