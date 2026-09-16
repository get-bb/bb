import { describe, expect, it } from "vitest";
import { markdownToTypst } from "./markdown-to-typst";

describe("markdownToTypst", () => {
  it("prepends the A4 document preamble", () => {
    const typst = markdownToTypst("Hello");
    expect(typst).toContain('#set page(paper: "a4", margin: 2cm)');
    expect(typst).toContain('#set text(font: "Libertinus Serif", size: 11pt)');
    expect(typst).toContain("#set par(justify: true)");
  });

  it("maps headings by depth", () => {
    const typst = markdownToTypst("# One\n\n## Two\n\n### Three");
    expect(typst).toContain("= One");
    expect(typst).toContain("== Two");
    expect(typst).toContain("=== Three");
  });

  it("maps emphasis, strong, strikethrough, and inline code", () => {
    const typst = markdownToTypst(
      "plain **bold** *italic* ~~gone~~ and `code`",
    );
    expect(typst).toContain("*bold*");
    expect(typst).toContain("_italic_");
    expect(typst).toContain("#strike[gone]");
    expect(typst).toContain('#raw("code")');
  });

  it("maps links and resolves the destination", () => {
    const typst = markdownToTypst("[docs](https://example.com/path)");
    expect(typst).toContain('#link("https://example.com/path")[docs]');
  });

  it("embeds local images and links remote ones", () => {
    const typst = markdownToTypst(
      "![chart](charts/out.png)\n\n![badge](https://img.example/x.svg)",
    );
    expect(typst).toContain('#image("charts/out.png", width: 100%)');
    expect(typst).toContain('#link("https://img.example/x.svg")[badge]');
  });

  it("decodes percent-encoded local image paths", () => {
    const typst = markdownToTypst("![shot](charts/my%20shot.png)");
    expect(typst).toContain('#image("charts/my shot.png", width: 100%)');
  });

  it("maps fenced code blocks with their language", () => {
    const typst = markdownToTypst("```js\nconst x = 1;\n```");
    expect(typst).toContain('#raw("const x = 1;", lang: "js", block: true)');
  });

  it("maps unordered, ordered, and nested lists", () => {
    const typst = markdownToTypst(
      ["- one", "  - nested", "- two", "", "1. first", "2. second"].join("\n"),
    );
    expect(typst).toContain("- one\n  - nested\n- two");
    expect(typst).toContain("+ first\n+ second");
  });

  it("marks GFM task list items", () => {
    const typst = markdownToTypst("- [x] done\n- [ ] todo");
    expect(typst).toContain("- ☑ done");
    expect(typst).toContain("- ☐ todo");
    expect(typst).not.toContain("\\[x\\]");
    expect(typst).not.toContain("\\[ \\]");
  });

  it("renders tables with a header row", () => {
    const typst = markdownToTypst(
      ["| a | b |", "| - | - |", "| 1 | 2 |"].join("\n"),
    );
    expect(typst).toContain("#table(");
    expect(typst).toContain("columns: 2");
    expect(typst).toContain("table.header([a], [b])");
    expect(typst).toContain("[1]");
    expect(typst).toContain("[2]");
  });

  it("maps blockquotes and horizontal rules", () => {
    const typst = markdownToTypst("> quoted\n\n---");
    expect(typst).toContain("#quote(block: true)[");
    expect(typst).toContain("quoted");
    expect(typst).toContain("#line(length: 100%)");
  });

  it("escapes Typst control characters in text", () => {
    const typst = markdownToTypst("cost 5$ tag #x ref @a tilde ~b [c] back \\\\");
    expect(typst).toContain("5\\$");
    expect(typst).toContain("\\#x");
    expect(typst).toContain("\\@a");
    expect(typst).toContain("\\~b");
    expect(typst).toContain("\\[c\\]");
    expect(typst).toContain("\\\\");
  });

  it("keeps raw HTML as escaped literal text", () => {
    const typst = markdownToTypst("<div>not markup</div>");
    expect(typst).toContain("\\<div\\>not markup\\</div\\>");
  });

  it("strips YAML frontmatter", () => {
    const typst = markdownToTypst("---\ntitle: Notes\n---\n\n# Body");
    expect(typst).not.toContain("title: Notes");
    expect(typst).toContain("= Body");
  });

  it("does not treat a leading horizontal rule as frontmatter", () => {
    const typst = markdownToTypst("---\n\nBody");
    expect(typst).toContain("#line(length: 100%)");
    expect(typst).toContain("Body");
  });
});
