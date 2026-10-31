// @vitest-environment jsdom
import { MarkdownLink, MarkdownStarterKit } from "./markdown-editor";
import { Editor } from "@tiptap/core";
import Image from "@tiptap/extension-image";
import Table from "@tiptap/extension-table";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import TableRow from "@tiptap/extension-table-row";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
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
      MarkdownStarterKit,
      MarkdownLink.configure({ openOnClick: false, autolink: true }),
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
  const blocks = loadMarkdownBlocks(
    editor,
    markdown,
    (source) => source,
    false,
  );
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
      DOCUMENT.replace(
        "# Release notes\n\n",
        "# Release notes\n\nInserted.\n\n",
      ),
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

describe("Markdown editing round trips", () => {
  it.each([
    ["- all ~1,300 records\n", "- New all ~1,300 records\n"],
    [
      "Visit https://example.com/docs\n",
      "New Visit https://example.com/docs\n",
    ],
    [
      "Visit https://example.com/docs.\n",
      "New Visit https://example.com/docs.\n",
    ],
    [
      "- Visit https://example.com/a_b?q=one&n=2\n",
      "- New Visit https://example.com/a_b?q=one&n=2\n",
    ],
  ])("does not add syntax when editing %s", (source, expected) => {
    const { editor, save } = open(source);
    try {
      editor.view.dispatch(
        editor.state.tr.insertText(
          "New ",
          textPosition(editor, source.includes("Visit") ? "Visit" : "all"),
        ),
      );
      expect(save()).toBe(expected);
      const reopened = open(save());
      try {
        expect(reopened.editor.state.doc.toJSON()).toEqual(
          editor.state.doc.toJSON(),
        );
      } finally {
        reopened.editor.destroy();
      }
    } finally {
      editor.destroy();
    }
  });

  it("uses paragraphs for ordinary Enter after leaving a list", () => {
    const { editor, save } = open("- Item\n");
    try {
      editor.commands.setTextSelection(textPosition(editor, "Item") + 4);
      editor.commands.keyboardShortcut("Enter");
      editor.commands.keyboardShortcut("Enter");
      editor.view.dispatch(editor.state.tr.insertText("Let me know."));
      editor.commands.keyboardShortcut("Enter");
      editor.view.dispatch(editor.state.tr.insertText("Thanks."));
      expect(save()).toBe("- Item\n\nLet me know.\n\nThanks.\n");
      expect(editor.getHTML()).not.toContain("<br");
    } finally {
      editor.destroy();
    }
  });

  it.each(["Text\n", "- Text\n", "> Text\n"])(
    "preserves Shift+Enter at the start of %s",
    (source) => {
      const { editor, save } = open(source);
      try {
        editor.commands.setTextSelection(textPosition(editor, "Text"));
        editor.commands.keyboardShortcut("Shift-Enter");
        expect(editor.getHTML()).toContain("<br>Text");
        const reopened = open(save());
        try {
          expect(reopened.editor.state.doc.toJSON()).toEqual(
            editor.state.doc.toJSON(),
          );
        } finally {
          reopened.editor.destroy();
        }
      } finally {
        editor.destroy();
      }
    },
  );

  it.each([
    "\\~~~deleted~~",
    "Prefix \\~~~deleted~~",
    "~~deleted~~\\~",
    "~~\\~deleted~~",
    "~~deleted\\~~~",
  ])("preserves a literal tilde beside strike delimiters in %s", (line) => {
    const { editor, save } = open(
      `${line}\n\nKeep this paragraph.\n\n## Keep this heading\n\n- Keep this list item\n`,
    );
    try {
      editor.view.dispatch(
        editor.state.tr.insertText("x", textPosition(editor, "deleted") + 1),
      );
      const reopened = open(save());
      try {
        expect(reopened.editor.state.doc.toJSON()).toEqual(
          editor.state.doc.toJSON(),
        );
      } finally {
        reopened.editor.destroy();
      }
    } finally {
      editor.destroy();
    }
  });

  it("preserves intentional hard breaks without backslash syntax", () => {
    const { editor, save } = open("- Item\n\nLet me know.\n");
    try {
      editor.commands.setTextSelection(
        textPosition(editor, "Let me know.") + 12,
      );
      editor.commands.setHardBreak();
      editor.commands.setHardBreak();
      editor.view.dispatch(editor.state.tr.insertText("Thanks."));
      expect(save()).toBe("- Item\n\nLet me know.<br><br>Thanks.\n");
      const reopened = open(save());
      try {
        expect(reopened.editor.state.doc.toJSON()).toEqual(
          editor.state.doc.toJSON(),
        );
      } finally {
        reopened.editor.destroy();
      }
    } finally {
      editor.destroy();
    }
  });

  it.each([
    "*literal*",
    "_literal_",
    "~~literal~~",
    "[label](target)",
    "# heading",
    "- item",
    "1. item",
    "\\~literal",
    "<script>alert(1)</script>",
  ])("keeps typed %s literal after reopening", (text) => {
    const { editor, save } = open("");
    try {
      editor.view.dispatch(editor.state.tr.insertText(text, 1));
      const reopened = open(save());
      try {
        expect(reopened.editor.state.doc.toJSON()).toEqual(
          editor.state.doc.toJSON(),
        );
      } finally {
        reopened.editor.destroy();
      }
    } finally {
      editor.destroy();
    }
  });
});

describe("Markdown serializer safeguards", () => {
  it.each([
    "- all ~1,300 and ~~removed~~ records\n",
    "Visit [https://example.com](https://example.com)**.** now.\n",
    "Visit [https://example.com](https://example.com)*.* now.\n",
    "Visit [https://example.com](https://example.com)~~.~~ now.\n",
    "Visit [https://example.com](https://example.com)**!** now.\n",
    "Visit **(**[https://example.com](https://example.com) now.\n",
    "Visit *(*[https://example.com](https://example.com) now.\n",
    "Visit ~~(~~[https://example.com](https://example.com) now.\n",
    "Visit [the docs](https://example.com) now.\n",
    'Visit [https://example.com](https://example.com "A title") now.\n',
    "Visit **https://example.com** now.\n",
    "Visit [https://example.com**!**](https://example.com) now.\n",
    "Visit [Label<br>https://example.com](https://example.com) now.\n",
    "Visit [https://example.com<br>Label](https://example.com) now.\n",
    "Visit [https://example.com/a*](https://example.com/a*) now.\n",
    "Visit <https://example.com/?q=&copy;> now.\n",
    "[https://example.com](https://example.com)Suffix\n",
    "Prefix[https://example.com](https://example.com)\n",
    "First  \nsecond\n",
    "First<br><br>second\n",
    "| a | b |\n| --- | --- |\n| First<br>second | ~3 |\n",
  ])("preserves semantics after editing %s", (source) => {
    const { editor, save } = open(source);
    try {
      let first = -1;
      editor.state.doc.descendants((node, pos) => {
        if (first < 0 && node.isText) first = pos;
      });
      editor.view.dispatch(editor.state.tr.insertText("New ", first));
      const reopened = open(save());
      try {
        expect(reopened.editor.state.doc.toJSON()).toEqual(
          editor.state.doc.toJSON(),
        );
      } finally {
        reopened.editor.destroy();
      }
    } finally {
      editor.destroy();
    }
  });
});

describe("legacy trailing-break cleanup", () => {
  it.each(["\n", "\r\n"])(
    "cleans the artifact on load with %j line endings and saves only after an edit",
    (newline) => {
      const source =
        "- First item\n\nLet me know what you think.\\\n\\\n\nKeep this paragraph.\n".replaceAll(
          "\n",
          newline,
        );
      const { editor, save } = open(source);
      try {
        expect(editor.getHTML()).toContain(
          "<p>Let me know what you think.</p>",
        );
        expect(editor.state.doc.textContent).not.toContain("\\");
        expect(save()).toBe(source);
        editor.view.dispatch(
          editor.state.tr.insertText("New ", textPosition(editor, "Keep")),
        );
        expect(save()).toBe(
          "- First item" +
            newline +
            newline +
            "Let me know what you think.\n\nNew Keep this paragraph.\n",
        );
      } finally {
        editor.destroy();
      }
    },
  );

  it.each(["#", "-", "---", "``", "Text\n---"])(
    "keeps cleaned %j as paragraph text",
    (text) => {
      const source = text + "\\\n\\\n\nOther paragraph.\n";
      const { editor, save } = open(source);
      try {
        expect(editor.state.doc.firstChild?.type.name).toBe("paragraph");
        expect(editor.state.doc.firstChild?.textContent).toBe(
          text.replaceAll("\n", " "),
        );
        expect(save()).toBe(source);
        editor.view.dispatch(
          editor.state.tr.insertText("New ", textPosition(editor, "Other")),
        );
        const reopened = open(save());
        try {
          expect(reopened.editor.state.doc.toJSON()).toEqual(
            editor.state.doc.toJSON(),
          );
        } finally {
          reopened.editor.destroy();
        }
      } finally {
        editor.destroy();
      }
    },
  );

  it.each([
    "&amp;copy;",
    "\\&copy;",
    "&amp;lt;tag&amp;gt;",
    "&amp;#35;",
    "&amp;#x23;",
    "&unknown;",
  ])("preserves literal entity text in %j during cleanup", (text) => {
    const source = text + "\\\n\\\n\nOther paragraph.\n";
    const { editor, save } = open(source);
    try {
      expect(save()).toBe(source);
      editor.view.dispatch(
        editor.state.tr.insertText("New ", textPosition(editor, "Other")),
      );
      const reopened = open(save());
      try {
        expect(reopened.editor.state.doc.toJSON()).toEqual(
          editor.state.doc.toJSON(),
        );
      } finally {
        reopened.editor.destroy();
      }
    } finally {
      editor.destroy();
    }
  });

  it.each(["# Heading", "- item", "1. item", "---", "===", "> quote"])(
    "preserves literal %j after a hard break during cleanup",
    (text) => {
      const source = "First<br>" + text + "\\\n\\\n\nOther paragraph.\n";
      const { editor, save } = open(source);
      try {
        expect(editor.state.doc.firstChild?.type.name).toBe("paragraph");
        expect(editor.state.doc.firstChild?.textContent).toBe("First" + text);
        expect(save()).toBe(source);
        editor.view.dispatch(
          editor.state.tr.insertText("New ", textPosition(editor, "Other")),
        );
        const reopened = open(save());
        try {
          expect(reopened.editor.state.doc.toJSON()).toEqual(
            editor.state.doc.toJSON(),
          );
        } finally {
          reopened.editor.destroy();
        }
      } finally {
        editor.destroy();
      }
    },
  );

  it("keeps hard breaks before a following line", () => {
    const source = "Text\\\n\\\nFollowing text\n\nOther paragraph.\n";
    const { editor, save } = open(source);
    try {
      expect(editor.getHTML()).toContain("<p>Text<br><br>Following text</p>");
      editor.view.dispatch(
        editor.state.tr.insertText("New ", textPosition(editor, "Other")),
      );
      expect(save()).toBe(
        source.replace("Other paragraph.", "New Other paragraph."),
      );
    } finally {
      editor.destroy();
    }
  });

  it.each([
    "Text\n\\",
    "Text\\\\\n\\",
    "Text  \n\\",
    "`Text\\\n\\`",
    "```text\nText\\\n\\\n```",
    "    Text\\\n    \\",
  ])("keeps literal content in %j", (literal) => {
    const source = literal + "\n\nOther paragraph.\n";
    const { editor, save } = open(source);
    try {
      expect(editor.state.doc.textContent).toContain("\\");
      expect(save()).toBe(source);
      editor.view.dispatch(
        editor.state.tr.insertText("New ", textPosition(editor, "Other")),
      );
      expect(save()).toBe(literal + "\n\nNew Other paragraph.\n");
    } finally {
      editor.destroy();
    }
  });
});
