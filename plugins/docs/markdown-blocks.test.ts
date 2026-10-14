// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import Table from "@tiptap/extension-table";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import TableRow from "@tiptap/extension-table-row";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";
import { describe, expect, it } from "vitest";
import { loadMarkdownBlocks, saveMarkdownBlocks } from "./markdown-blocks";
import { HtmlBlock, HtmlSource } from "./raw-html";

const VIDEO = `<div style="margin-block: 1rem;">
  <video src="/a.mp4" autoplay loop muted playsinline></video>
</div>`;

const DOCUMENT = `${[
  "# Release notes",
  "Press <kbd>Ctrl</kbd>+<kbd>K</kbd> to open the <strong>command menu</strong>.",
  VIDEO,
  '> <div>\n> <video src="/q.mp4"></video>\n> </div>',
  "- [x] Done\n- [ ] Todo",
  "**Note**\nthis line stays wrapped.",
  "| a | b |\n|---|:-:|\n| one<br>two | <kbd>k</kbd> |",
  "<p>Intro</p><style",
  "## After unclosed HTML",
  "See [the docs][ref] and _underscores_.",
  "<!-- a comment -->",
  "1. one\n1. two",
  "Original body.",
  '[ref]: https://example.com "Title"',
].join("\n\n")}\n`;

function open(markdown: string) {
  const editor = new Editor({
    extensions: [
      StarterKit,
      Link.configure({ openOnClick: false, autolink: true }),
      Image,
      TaskList,
      TaskItem.configure({ nested: true }),
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      HtmlBlock,
      HtmlSource,
      Markdown.configure({
        html: true,
        tightLists: true,
        bulletListMarker: "-",
        linkify: true,
      }),
    ],
    content: "",
  });
  const blocks = loadMarkdownBlocks(editor, markdown, (source) => source, false);
  const save = () =>
    saveMarkdownBlocks(editor, blocks, (nodes) =>
      editor.storage.markdown.serializer.serialize(
        editor.schema.topNodeType.create(null, nodes),
      ),
    );
  return { editor, save };
}

function textPosition(editor: Editor, text: string) {
  let position = -1;
  editor.state.doc.descendants((node, pos) => {
    if (position < 0 && node.isText && node.text?.includes(text))
      position = pos + node.text.indexOf(text);
  });
  return position;
}

function topLevelRange(editor: Editor, text: string) {
  let range = { from: 0, to: 0 };
  editor.state.doc.forEach((node, offset) => {
    if (!range.to && node.textContent.includes(text))
      range = { from: offset, to: offset + node.nodeSize };
  });
  return range;
}

describe("markdown blocks", () => {
  it("saves an unedited document byte for byte", () => {
    const { editor, save } = open(DOCUMENT);
    try {
      expect(save()).toBe(DOCUMENT);
    } finally {
      editor.destroy();
    }
  });

  it.each([
    [
      "the last paragraph",
      (editor: Editor) =>
        editor.commands.insertContentAt(
          textPosition(editor, "Original body."),
          "Edited ",
        ),
      DOCUMENT.replace("Original body.", "Edited Original body."),
    ],
    [
      "the heading",
      (editor: Editor) =>
        editor.commands.insertContentAt(
          textPosition(editor, "Release"),
          "New ",
        ),
      DOCUMENT.replace("# Release notes", "# New Release notes"),
    ],
    [
      "around a deleted task list",
      (editor: Editor) => {
        const { from, to } = topLevelRange(editor, "Done");
        editor.view.dispatch(editor.state.tr.delete(from, to));
      },
      DOCUMENT.replace("- [x] Done\n- [ ] Todo\n\n", ""),
    ],
    [
      "an inserted paragraph",
      (editor: Editor) =>
        editor.view.dispatch(
          editor.state.tr.insert(
            topLevelRange(editor, "Release notes").to,
            editor.schema.nodes.paragraph!.create(
              null,
              editor.schema.text("Inserted."),
            ),
          ),
        ),
      DOCUMENT.replace("# Release notes\n\n", "# Release notes\n\nInserted.\n\n"),
    ],
  ])("rewrites only %s", (_name, edit, expected) => {
    const { editor, save } = open(DOCUMENT);
    try {
      edit(editor);
      expect(save()).toBe(expected);
    } finally {
      editor.destroy();
    }
  });

  it("parses each block on its own", () => {
    const { editor } = open(DOCUMENT);
    try {
      const headings: string[] = [];
      editor.state.doc.forEach((node) => {
        if (node.type.name === "heading") headings.push(node.textContent);
      });
      expect(headings).toEqual(["Release notes", "After unclosed HTML"]);
    } finally {
      editor.destroy();
    }
  });

  it.each([
    [
      "only reference definitions",
      "[ref]: https://example.com\n",
      "Z\n\n[ref]: https://example.com\n",
    ],
    [
      "old Mac line endings",
      "Line one\rstill\r\rSecond <div>x</div>\r",
      "ZLine one still\n\nSecond <div>x</div>\r",
    ],
    [
      "a reference title ending in a backslash",
      'See [x][r].\n\n[r]: https://e.com "a\\\\"\n',
      'ZSee [x](https://e.com).\n\n[r]: https://e.com "a\\\\"\n',
    ],
    [
      "an unclosed fence after a reference",
      "Text [l][r].\n\n[r]: https://e.com\n\n```js\nconst a = 1;\n",
      "ZText [l](https://e.com).\n\n[r]: https://e.com\n\n```js\nconst a = 1;\n",
    ],
  ])("keeps a document with %s intact", (_name, markdown, edited) => {
    const { editor, save } = open(markdown);
    try {
      expect(save()).toBe(markdown);
      editor.commands.setTextSelection(1);
      editor.commands.insertContent("Z");
      expect(save()).toBe(edited);
    } finally {
      editor.destroy();
    }
  });
});
