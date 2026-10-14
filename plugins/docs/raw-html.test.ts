// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import Link from "@tiptap/extension-link";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";
import { describe, expect, it } from "vitest";
import { HtmlBlock, HtmlSource } from "./raw-html";

function createEditor(content: string) {
  return new Editor({
    extensions: [
      StarterKit,
      Link.configure({ openOnClick: false, autolink: true }),
      TaskList,
      TaskItem.configure({ nested: true }),
      HtmlBlock,
      HtmlSource,
      Markdown.configure({ html: true, tightLists: true, linkify: true }),
    ],
    content,
  });
}

function textPosition(editor: Editor, text: string) {
  let position = -1;
  editor.state.doc.descendants((node, pos) => {
    if (position < 0 && node.isText && node.text?.includes(text))
      position = pos + node.text.indexOf(text);
  });
  return position;
}

function type(editor: Editor, text: string) {
  for (const character of text) {
    const { from, to } = editor.state.selection;
    const insert = () => editor.state.tr.insertText(character, from, to);
    const handled = editor.view.someProp("handleTextInput", (handle) =>
      handle(editor.view, from, to, character, insert),
    );
    if (!handled) editor.view.dispatch(insert());
  }
}

describe("raw HTML", () => {
  it("keeps HTML the editor cannot render as editable text in an edited paragraph", () => {
    const editor = createEditor(
      "Press <kbd>Ctrl</kbd> and <strong>bold</strong>.",
    );
    try {
      expect(editor.view.dom.querySelector("strong")?.textContent).toBe("bold");
      expect(editor.view.dom.textContent).toContain("<kbd>Ctrl</kbd>");
      editor.commands.insertContentAt(1, "Now ");
      expect(editor.storage.markdown.getMarkdown()).toBe(
        "Now Press <kbd>Ctrl</kbd> and **bold**.",
      );
    } finally {
      editor.destroy();
    }
  });

  it("keeps HTML blocks as editable text saved exactly as typed", () => {
    const editor = createEditor(
      'Intro.\n\n<div>\n  <video src="/a.mp4"></video>\n</div>\n\n> <div>\n> <video src="/q.mp4"></video>\n> </div>',
    );
    try {
      expect(editor.view.dom.querySelector("video")).toBeNull();
      editor.commands.insertContentAt(textPosition(editor, "/a.mp4") + 1, "b");
      expect(editor.storage.markdown.getMarkdown()).toBe(
        'Intro.\n\n<div>\n  <video src="/ba.mp4"></video>\n</div>\n\n> <div>\n> <video src="/q.mp4"></video>\n> </div>',
      );
    } finally {
      editor.destroy();
    }
  });

  it("saves typed tags as HTML and escapes other angle brackets", () => {
    const editor = createEditor("Escaped &lt;kbd&gt; stays.");
    try {
      editor.commands.setTextSelection(editor.state.doc.content.size - 1);
      type(editor, " Press <kbd>K</kbd> if a < b.");
      expect(editor.storage.markdown.getMarkdown()).toBe(
        "Escaped &lt;kbd&gt; stays. Press <kbd>K</kbd> if a &lt; b.",
      );
    } finally {
      editor.destroy();
    }
  });

  it("keeps task list checkboxes", () => {
    const editor = createEditor("- [x] Done\n- [ ] Todo");
    try {
      expect(
        [...editor.view.dom.querySelectorAll("li[data-checked]")].map((item) =>
          item.getAttribute("data-checked"),
        ),
      ).toEqual(["true", "false"]);
      expect(editor.storage.markdown.getMarkdown()).not.toContain("<input");
    } finally {
      editor.destroy();
    }
  });

  it("keeps tags with attributes or no partner as editable text", () => {
    const editor = createEditor(
      'A <strong style="color:red">W</strong> and <a href="x" target="_self">l</a> and <a name="top"></a> and <b>ok</b> <b>open',
    );
    try {
      editor.commands.insertContentAt(1, "Z");
      expect(editor.storage.markdown.getMarkdown()).toBe(
        'ZA <strong style="color:red">W</strong> and <a href="x" target="_self">l</a> and <a name="top"></a> and **ok** <b>open',
      );
    } finally {
      editor.destroy();
    }
  });
});
