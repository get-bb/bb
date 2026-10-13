// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import { Markdown } from "tiptap-markdown";
import { describe, expect, it } from "vitest";
import { RawHtml, RawInlineHtml } from "./raw-html";

function createEditor(content: string) {
  return new Editor({
    extensions: [
      StarterKit,
      TaskList,
      TaskItem.configure({ nested: true }),
      RawHtml,
      RawInlineHtml,
      Markdown.configure({ html: true }),
    ],
    content,
  });
}

describe("raw HTML blocks", () => {
  it.each([
    '<video autoplay loop muted playsinline>\n  <source src="/demo.mp4?a=1&amp;b=2" type="video/mp4">\n</video>',
    '<video controls><a href="/demo.mp4">Watch the demo</a></video>',
    '<iframe src="https://example.com" allowfullscreen></iframe>',
    '<section data-custom="a &quot;quote&quot;">\n\n<p>Nested HTML</p>\n\n</section>',
    "<!-- keep this comment -->",
    "<script>window.untrusted = true;</script>",
    '<div onclick="alert(1)"><img src="missing" onerror="alert(2)"></div>',
    '> <div>\n> <video src="/demo.mp4"></video>\n> </div>',
    '- Item\n\n  <div>\n  <video src="/demo.mp4"></video>\n  </div>',
    "- one\n- <div>two</div>\n- three",
    "1. <video controls>\n   <source src=\"a.mp4\">\n   </video>\n2. three",
  ])("retains exact source across edits and repeated loads: %s", (html) => {
    const editor = createEditor(`Before.\n\n${html}\n\nAfter.`);
    try {
      expect(
        editor.view.dom.querySelector(
          "video, iframe, script, img[src], [onclick]",
        ),
      ).toBeNull();
      editor.commands.insertContentAt(1, "Edited ");
      const saved: string = editor.storage.markdown.getMarkdown();
      expect(saved).toContain(html);
      expect(saved).toContain("Edited Before.");
      editor.commands.setContent(saved);
      expect(editor.storage.markdown.getMarkdown()).toBe(saved);
    } finally {
      editor.destroy();
    }
  });

  it("leaves fenced HTML as editable code", () => {
    const content = '```html\n<video controls src="demo.mp4"></video>\n```';
    const editor = createEditor(content);
    try {
      expect(editor.view.dom.querySelector(".simple-html-embed")).toBeNull();
      expect(editor.storage.markdown.getMarkdown()).toBe(content);
    } finally {
      editor.destroy();
    }
  });

  it("keeps multiple blocks distinct and supports explicit deletion and undo", () => {
    const first = '<video src="first.mp4">\n</video>';
    const second = '<audio src="second.mp3">\n</audio>';
    const editor = createEditor(`${first}\n\nBetween.\n\n${second}`);
    try {
      editor.commands.deleteRange({ from: 0, to: 1 });
      expect(editor.storage.markdown.getMarkdown()).not.toContain(first);
      expect(editor.storage.markdown.getMarkdown()).toContain(second);
      editor.commands.undo();
      const saved: string = editor.storage.markdown.getMarkdown();
      expect(saved).toContain(first);
      expect(saved).toContain(second);
      expect(saved.indexOf(first)).toBeLessThan(saved.indexOf(second));
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
