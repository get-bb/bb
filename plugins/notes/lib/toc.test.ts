import { describe, expect, it } from "vitest";
import {
  anchorFor,
  collectHeadings,
  renderToc,
  tocBlock,
  updateTocBlock,
} from "./toc.js";

describe("collectHeadings", () => {
  it("reads ATX headings with their levels", () => {
    const headings = collectHeadings(["# One", "text", "### Three"]);
    expect(headings).toEqual([
      { level: 1, text: "One", lineNumber: 1 },
      { level: 3, text: "Three", lineNumber: 3 },
    ]);
  });

  it("ignores # comments inside a fenced code block", () => {
    const headings = collectHeadings([
      "# Real",
      "```sh",
      "# not a heading",
      "```",
      "## Also real",
    ]);
    expect(headings.map((heading) => heading.text)).toEqual([
      "Real",
      "Also real",
    ]);
  });

  it("strips a closing hash run", () => {
    expect(collectHeadings(["## Title ##"])[0]?.text).toBe("Title");
  });

  it("skips a hash with no space, which is not a heading", () => {
    expect(collectHeadings(["#NotAHeading"])).toEqual([]);
  });
});

describe("anchorFor", () => {
  it("lowercases and hyphenates", () => {
    expect(anchorFor("Getting Started")).toBe("getting-started");
  });

  it("drops punctuation", () => {
    expect(anchorFor("What's new?")).toBe("whats-new");
  });

  it("unwraps inline markdown", () => {
    expect(anchorFor("**Bold** and `code`")).toBe("bold-and-code");
  });
});

describe("renderToc", () => {
  const headings = collectHeadings([
    "# Title",
    "## First",
    "### Nested",
    "## Second",
  ]);

  it("numbers entries when orderedList is on, per the imported setting", () => {
    expect(renderToc(headings, { orderedList: true })).toBe(
      ["1. [First](#first)", "  1. [Nested](#nested)", "2. [Second](#second)"].join(
        "\n",
      ),
    );
  });

  it("restarts numbering for each nesting level", () => {
    const deep = collectHeadings([
      "## A",
      "### A1",
      "### A2",
      "## B",
      "### B1",
    ]);
    expect(renderToc(deep, { orderedList: true })).toBe(
      [
        "1. [A](#a)",
        "  1. [A1](#a1)",
        "  2. [A2](#a2)",
        "2. [B](#b)",
        "  1. [B1](#b1)",
      ].join("\n"),
    );
  });

  it("uses bullets when orderedList is off", () => {
    expect(renderToc(headings, { orderedList: false })).toBe(
      ["- [First](#first)", "  - [Nested](#nested)", "- [Second](#second)"].join(
        "\n",
      ),
    );
  });

  it("indents relative to the shallowest heading present", () => {
    const headings = collectHeadings(["### Deep", "#### Deeper"]);
    expect(renderToc(headings, { orderedList: false, minLevel: 3 })).toBe(
      ["- [Deep](#deep)", "  - [Deeper](#deeper)"].join("\n"),
    );
  });

  it("returns empty when no heading is in range", () => {
    expect(renderToc(collectHeadings(["# Only H1"]), { orderedList: true })).toBe(
      "",
    );
  });
});

describe("updateTocBlock", () => {
  it("replaces the content between the markers", () => {
    const content = [
      "# Title",
      "<!-- toc -->",
      "stale",
      "<!-- /toc -->",
      "## Real",
    ].join("\n");
    const result = updateTocBlock(content, { orderedList: true });
    expect(result.replaced).toBe(true);
    expect(result.content).toBe(
      [
        "# Title",
        "<!-- toc -->",
        "1. [Real](#real)",
        "<!-- /toc -->",
        "## Real",
      ].join("\n"),
    );
  });

  it("reports no replacement when there are no markers", () => {
    const result = updateTocBlock("# Title\n## Real", { orderedList: true });
    expect(result.replaced).toBe(false);
    expect(result.content).toBe("# Title\n## Real");
  });

  it("is idempotent", () => {
    const content = ["<!-- toc -->", "<!-- /toc -->", "## A"].join("\n");
    const once = updateTocBlock(content, { orderedList: true }).content;
    const twice = updateTocBlock(once, { orderedList: true }).content;
    expect(twice).toBe(once);
  });
});

describe("tocBlock", () => {
  it("wraps a fresh listing in markers", () => {
    expect(tocBlock("# T\n## A", { orderedList: false })).toBe(
      "<!-- toc -->\n- [A](#a)\n<!-- /toc -->\n",
    );
  });
});
