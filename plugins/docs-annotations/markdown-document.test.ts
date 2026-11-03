import { describe, expect, it } from "vitest";
import { parseMarkdownDocument } from "./markdown-document";

describe("parseMarkdownDocument", () => {
  it("splits a YAML mapping block from the body", () => {
    expect(
      parseMarkdownDocument("---\ntitle: Wiki page\ntags: [a]\n---\n\n# Wiki"),
    ).toEqual({
      frontmatter: "---\ntitle: Wiki page\ntags: [a]\n---\n",
      body: "\n# Wiki",
      title: "Wiki page",
    });
  });

  it("keeps a leading thematic break in the body", () => {
    const content = "---\n\nSome intro text.\n\n---\n\nMore text.\n";
    expect(parseMarkdownDocument(content)).toEqual({
      frontmatter: "",
      body: content,
      title: null,
    });
  });

  it("keeps a leading YAML sequence in the body", () => {
    const content = "---\n- a\n- b\n---\nbody\n";
    expect(parseMarkdownDocument(content)).toEqual({
      frontmatter: "",
      body: content,
      title: null,
    });
  });

  it("keeps an unparseable block in the body", () => {
    const content = "---\nnot: [closed\n---\nbody\n";
    expect(parseMarkdownDocument(content)).toEqual({
      frontmatter: "",
      body: content,
      title: null,
    });
  });

  it("treats an empty block as frontmatter", () => {
    expect(parseMarkdownDocument("---\n---\nbody\n")).toEqual({
      frontmatter: "---\n---\n",
      body: "body\n",
      title: null,
    });
  });

  it("reports no title when frontmatter omits one", () => {
    expect(parseMarkdownDocument("---\ntags: [a]\n---\n# H1\n")).toMatchObject({
      frontmatter: "---\ntags: [a]\n---\n",
      title: null,
    });
  });

  it("round-trips frontmatter and body byte-for-byte", () => {
    for (const content of [
      "---\r\ntitle: X\r\n---\r\n\r\nBody\r\n",
      "\uFEFF---\ntitle: X\n---\nBody\n",
      "---\ntitle: X\n...\nBody\n",
      "---\n\nA thematic break document.\n\n---\n\nMore.\n",
      "No frontmatter at all.\n",
    ]) {
      const document = parseMarkdownDocument(content);
      expect(document.frontmatter + document.body).toBe(content);
    }
  });
});
