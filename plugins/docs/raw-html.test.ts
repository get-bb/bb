// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import StarterKit from "@tiptap/starter-kit";
import Table from "@tiptap/extension-table";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import TableRow from "@tiptap/extension-table-row";
import { Markdown } from "tiptap-markdown";
import { describe, expect, it } from "vitest";
import { RawHtmlBlock, RawInlineHtml, restoreRawHtml } from "./raw-html";

function createEditor(content: string) {
  return new Editor({
    extensions: [
      StarterKit,
      Link.configure({ openOnClick: false, autolink: true }),
      Image,
      Table,
      TableRow,
      TableHeader,
      TableCell,
      RawHtmlBlock,
      RawInlineHtml,
      Markdown.configure({ html: true, linkify: true }),
    ],
    content,
  });
}

function save(editor: Editor): string {
  return restoreRawHtml(editor.storage.markdown.getMarkdown());
}

function splitHeaderCell(editor: Editor) {
  let end = 0;
  editor.state.doc.descendants((node, pos) => {
    if (node.isText && node.text === "b") end = pos + 1;
  });
  editor.chain().setTextSelection(end).splitBlock().run();
}

describe("raw HTML blocks", () => {
  it.each([
    '<video autoplay loop muted playsinline>\n  <source src="/demo.mp4?a=1&amp;b=2" type="video/mp4">\n</video>',
    '<video controls><a href="/demo.mp4">Watch the demo</a></video>',
    '<iframe src="https://example.com" allowfullscreen></iframe>',
    '<section data-custom="a &quot;quote&quot;">\n\n<p class="note">Nested HTML</p>\n\n</section>',
    "<!-- keep this comment -->",
    "<script>window.untrusted = true;</script>",
    '<div onclick="alert(1)"><img src="missing" onerror="alert(2)"></div>',
    '> <div>\n> <video src="/demo.mp4"></video>\n> </div>',
    '- Item\n\n  <div>\n  <video src="/demo.mp4"></video>\n  </div>',
  ])("retains exact source across edits and repeated loads: %s", (html) => {
    const editor = createEditor(`Before.\n\n${html}\n\nAfter.`);
    try {
      expect(
        editor.view.dom.querySelector(
          "video, iframe, script, img[src], [onclick]",
        ),
      ).toBeNull();
      editor.commands.insertContentAt(1, "Edited ");
      const saved = save(editor);
      expect(saved).toContain(html);
      expect(saved).toContain("Edited Before.");
      editor.commands.setContent(saved);
      expect(save(editor)).toBe(saved);
    } finally {
      editor.destroy();
    }
  });

  it.each([
    "<table><tr><th>Logo</th><th>Name</th></tr><tr><td><img src=\"logo.png\" alt=\"logo\"></td><td>Acme</td></tr></table>",
    "<table><tr><th>Code</th><th>Note</th></tr><tr><td><code>a | b</code></td><td>pipe</td></tr></table>",
    '<h2>Demo</h2>\n<img src="demo.gif" alt="Demo">',
    "<pre><code>before\n```\nafter</code></pre>",
    "<h2>Line one<br>Line two</h2>",
    '<pre data-docs-raw-html="true"><code>&lt;script&gt;alert(1)&lt;/script&gt;</code></pre>',
  ])("keeps HTML the Markdown save would change as source: %s", (html) => {
    const content = `Before.\n\n${html}\n\nAfter.`;
    const editor = createEditor(content);
    try {
      editor.commands.insertContentAt(1, "Edited ");
      expect(save(editor)).toBe(`Edited ${content}`);
    } finally {
      editor.destroy();
    }
  });

  it("saves edits typed into an HTML source block exactly", () => {
    const editor = createEditor(
      '<div>\n<video src="/a.mp4"></video>\n</div>\n\nAfter.',
    );
    try {
      let block = 0;
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === "rawHtmlBlock")
          block = pos + 1 + node.textContent.indexOf("a.mp4");
      });
      editor.commands.insertContentAt(block, "b");
      expect(save(editor)).toBe(
        '<div>\n<video src="/ba.mp4"></video>\n</div>\n\nAfter.',
      );
    } finally {
      editor.destroy();
    }
  });

  it("displays HTML the editor can represent as normal content", () => {
    const editor = createEditor(
      "<p>Some <strong>text</strong></p>\n\n<table>\n  <tr><th>a</th></tr>\n  <tr><td>1</td></tr>\n</table>",
    );
    try {
      expect(editor.view.dom.querySelector("p strong")?.textContent).toBe(
        "text",
      );
      expect(editor.view.dom.querySelector("table td")?.textContent).toBe("1");
      expect(editor.view.dom.querySelector("pre")).toBeNull();
      expect(save(editor)).toBe("Some **text**\n\n| a |\n| --- |\n| 1 |\n");
    } finally {
      editor.destroy();
    }
  });

  it("leaves fenced HTML as code", () => {
    const content = '```html\n<video controls src="demo.mp4"></video>\n```';
    const editor = createEditor(content);
    try {
      expect(editor.view.dom.querySelector("[data-docs-raw-html]")).toBeNull();
      expect(save(editor)).toBe(content);
    } finally {
      editor.destroy();
    }
  });

  it("keeps a table it saved as HTML editable, including after reformatting", () => {
    const editor = createEditor("| a | b |\n| --- | --- |\n| one | two |");
    try {
      splitHeaderCell(editor);
      const saved = save(editor);
      expect(saved).toMatch(/^<table/);
      expect(saved).not.toContain("data-docs-");
      editor.commands.setContent(saved);
      expect(editor.view.dom.querySelector("table td")?.textContent).toBe(
        "one",
      );
      expect(save(editor)).toBe(saved);
      editor.commands.setContent(
        saved
          .replace(/<tr>/g, "\n  <tr>")
          .replace("</tbody>", "\n  <tr><td>3</td><td>4</td></tr>\n</tbody>"),
      );
      expect(editor.view.dom.querySelectorAll("table tr")).toHaveLength(3);
    } finally {
      editor.destroy();
    }
  });

  it("keeps HTML whose attributes the editor would drop as source", () => {
    const table = '<table>\n<tr><td align="right">x</td></tr>\n</table>';
    const editor = createEditor(`${table}\n\nAfter.`);
    try {
      expect(editor.view.dom.querySelector("table")).toBeNull();
      expect(save(editor)).toContain(table);
    } finally {
      editor.destroy();
    }
  });

  it("keeps task list checkboxes", () => {
    const editor = createEditor("Intro.\n\n- [x] Done\n- [ ] Todo");
    const checked = () =>
      [...editor.view.dom.querySelectorAll("li[data-checked]")].map((item) =>
        item.getAttribute("data-checked"),
      );
    try {
      expect(checked()).toEqual(["true", "false"]);
      editor.commands.insertContentAt(1, "Edited ");
      const saved: string = editor.storage.markdown.getMarkdown();
      expect(saved).toContain("- [x] Done");
      expect(saved).not.toContain("<input");
      editor.commands.setContent(saved);
      expect(checked()).toEqual(["true", "false"]);
    } finally {
      editor.destroy();
    }
  });
});
