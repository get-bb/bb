// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";
import { afterEach, describe, expect, it } from "vitest";
import {
  commentHighlightKey,
  createCommentHighlights,
  highlightRanges,
  threadRanges,
  visibleEditor,
} from "./comment-editor.js";
import { visibleMarkdown } from "./comment-text.js";
import { loadMarkdownBlocks } from "./markdown-blocks.js";
import { HtmlBlock, HtmlSource } from "./raw-html.js";

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
});

describe("visible comment text", () => {
  it("projects Markdown and the editor identically across horizontal rules", () => {
    const markdown =
      "# Plan\n\nIntro text.\n\n---\n\nAfter the dashed rule.\n\n***\n\nAfter the starred rule.";
    editor = new Editor({
      extensions: [StarterKit, Markdown.configure({ html: true })],
      content: markdown,
    });
    const stored = visibleMarkdown(markdown);
    const rendered = visibleEditor(editor.state.doc);
    expect(stored.text).toBe(rendered.text);
    for (const quote of ["After the dashed rule", "After the starred rule"]) {
      const start = stored.text.indexOf(quote);
      const end = start + quote.length;
      expect(
        editor.state.doc.textBetween(
          rendered.positions[start]!,
          rendered.positions[end - 1]! + 1,
        ),
      ).toBe(quote);
    }
    expect(stored.lines[stored.text.indexOf("After the starred")]).toBe(11);
  });
  it("places saved-text comments on the matching proposal draft text", () => {
    const context =
      "This paragraph stays in place and gives the date its context.";
    const saved = `# Plan\n\n${context}\n\nShip on November 12.`;
    const proposal = `# Plan\n\nA new paragraph from the proposal.\n\n${context}\n\nShip on November 12.`;
    editor = new Editor({
      extensions: [StarterKit, Markdown.configure({ html: true })],
      content: proposal,
    });
    const start = visibleMarkdown(saved).text.indexOf("November 12");
    const thread = {
      id: "c_1",
      status: "open" as const,
      resolvedAt: null,
      resolvedBy: null,
      messages: [
        {
          id: "c_1",
          author: { kind: "user" as const, name: "You" },
          body: "Still right?",
          createdAt: "2026-10-19T00:00:00.000Z",
          editedAt: null,
          sentTo: [],
        },
      ],
      anchor: {
        state: "anchored" as const,
        quote: "November 12",
        start,
        end: start + 11,
        line: 5,
      },
    };
    const doc = editor.state.doc;
    const highlighted = (base: string | null) =>
      threadRanges(doc, [thread], base).map((range) =>
        doc.textBetween(range.from, range.to),
      );
    expect(highlighted(saved)).toEqual(["November 12"]);
    expect(
      threadRanges(
        doc,
        [thread],
        `# Plan\n\n${context}\n\nShip on December 30.`,
      ),
    ).toEqual([]);
  });
  it("never highlights from stale saved offsets after a live external edit", () => {
    const original =
      "# Plan\n\nIntro.\n\n---\n\nAfter dash rule target sentence.\n\n***\n\nAfter star rule target sentence.";
    const edited = original
      .replace("Intro.", "Intro.\n\nInserted externally.")
      .replace("After star rule target sentence.", "Totally different words.");
    editor = new Editor({
      extensions: [StarterKit, Markdown.configure({ html: true })],
      content: edited,
    });
    const before = visibleMarkdown(original).text;
    const listed = (id: string, quote: string) => {
      const start = before.indexOf(quote);
      return {
        id,
        status: "open" as const,
        resolvedAt: null,
        resolvedBy: null,
        messages: [
          {
            id,
            author: { kind: "user" as const, name: "You" },
            body: id,
            createdAt: "2026-10-19T00:00:00.000Z",
            editedAt: null,
            sentTo: [],
          },
        ],
        anchor: {
          state: "anchored" as const,
          quote,
          start,
          end: start + quote.length,
          line: 1,
        },
      };
    };
    const doc = editor.state.doc;
    expect(
      threadRanges(
        doc,
        [
          listed("dash", "After dash rule target sentence."),
          listed("star", "After star rule target sentence."),
        ],
        null,
      ).map((range) => [range.id, doc.textBetween(range.from, range.to)]),
    ).toEqual([]);
  });
  it("clears comment highlights when an external load replaces the document", () => {
    editor = new Editor({
      extensions: [
        StarterKit,
        Markdown.configure({ html: true }),
        createCommentHighlights(),
      ],
      content: "# Plan\n\nAfter star rule target sentence.",
    });
    const visible = visibleEditor(editor.state.doc);
    const start = visible.text.indexOf("After star");
    editor.view.dispatch(
      editor.state.tr.setMeta(commentHighlightKey, {
        ranges: [
          {
            id: "c_1",
            from: visible.positions[start]!,
            to: visible.positions[start + 31]! + 1,
          },
        ],
        active: null,
      }),
    );
    expect(commentHighlightKey.getState(editor.state)?.find()).toHaveLength(1);
    editor.view.dispatch(
      editor.state.tr
        .insertText(" rewritten", visible.positions[start + 15]! + 1)
        .setMeta("preventUpdate", true),
    );
    expect(commentHighlightKey.getState(editor.state)?.find()).toEqual([]);
  });
  it("keeps a repeated-quote highlight on its own occurrence when a reply arrives during local edits", () => {
    const saved = "# Race\n\nFirst target.\n\nSecond target.";
    editor = new Editor({
      extensions: [
        StarterKit,
        Markdown.configure({ html: true }),
        createCommentHighlights(),
      ],
      content: saved,
    });
    const savedText = visibleMarkdown(saved).text;
    const start = savedText.lastIndexOf("target");
    const thread = {
      id: "c_1",
      status: "open" as const,
      resolvedAt: null,
      resolvedBy: null,
      messages: [
        {
          id: "c_1",
          author: { kind: "user" as const, name: "You" },
          body: "Second one",
          createdAt: "2026-10-19T00:00:00.000Z",
          editedAt: null,
          sentTo: [],
        },
      ],
      anchor: {
        state: "anchored" as const,
        quote: "target",
        start,
        end: start + 6,
        line: 5,
      },
    };
    const place = (authoritative: boolean) =>
      editor!.view.dispatch(
        editor!.state.tr.setMeta(commentHighlightKey, {
          ranges: highlightRanges(
            editor!.state.doc,
            commentHighlightKey.getState(editor!.state),
            [thread],
            null,
            authoritative,
          ),
          active: null,
        }),
      );
    place(true);
    const first = visibleEditor(editor.state.doc);
    editor.view.dispatch(
      editor.state.tr.insertText(
        "Added contents. ",
        first.positions[first.text.indexOf("First")]!,
      ),
    );
    const reply = {
      ...thread,
      messages: [
        ...thread.messages,
        { ...thread.messages[0]!, id: "m_1", body: "Incoming reply" },
      ],
    };
    editor.view.dispatch(
      editor.state.tr.setMeta(commentHighlightKey, {
        ranges: highlightRanges(
          editor.state.doc,
          commentHighlightKey.getState(editor.state),
          [reply],
          null,
          false,
        ),
        active: null,
      }),
    );
    const ranges = commentHighlightKey.getState(editor.state)!.find();
    const edited = visibleEditor(editor.state.doc);
    expect(ranges).toHaveLength(1);
    expect(ranges[0]!.from).toBe(
      edited.positions[edited.text.lastIndexOf("target")],
    );
    expect(
      highlightRanges(editor.state.doc, undefined, [reply], null, false),
    ).toEqual([]);
  });
  it.each([
    "# Plan\n\n<div>literal HTML</div>\n\nTarget here.",
    '# Plan\n\nHello <strong class="marked">bold</strong>.\n\nTarget here.',
    "# Plan\n\n[x] ordinary paragraph\n\nTarget here.",
    "# Plan\n\nSoft\nbreak\n\nTarget here.",
    '# Plan\n\nHello <strong>bold</strong> and <a href="https://x.com">link</a>.\n\nTarget here.',
    "# Plan\n\n- [x] Done task\n- [ ] Open task\n\nTarget here.",
    "# Plan\n\nIntro\n\n---\n\nTarget here.",
  ])("matches the production editor's visible text for %j", (markdown) => {
    editor = new Editor({
      extensions: [
        StarterKit,
        Link.configure({ openOnClick: false, autolink: true }),
        Image,
        TaskList,
        TaskItem.configure({ nested: true }),
        HtmlBlock,
        HtmlSource,
        createCommentHighlights(),
        Markdown.configure({
          html: true,
          tightLists: true,
          bulletListMarker: "-",
          linkify: true,
        }),
      ],
      content: "",
    });
    loadMarkdownBlocks(editor, markdown, (source) => source, false);
    const stored = visibleMarkdown(markdown);
    const live = visibleEditor(editor.state.doc);
    expect(stored.text).toBe(live.text);
    const start = stored.text.indexOf("Target here.");
    expect(
      editor.state.doc.textBetween(
        live.positions[start]!,
        live.positions[start + 11]! + 1,
      ),
    ).toBe("Target here.");
  });
  const production = (markdown: string) => {
    editor = new Editor({
      extensions: [
        StarterKit,
        Link.configure({ openOnClick: false, autolink: true }),
        Image,
        TaskList,
        TaskItem.configure({ nested: true }),
        HtmlBlock,
        HtmlSource,
        createCommentHighlights(),
        Markdown.configure({
          html: true,
          tightLists: true,
          bulletListMarker: "-",
          linkify: true,
        }),
      ],
      content: "",
    });
    loadMarkdownBlocks(editor, markdown, (source) => source, false);
    return editor;
  };
  const storedThread = (markdown: string, quote: string) => {
    const text = visibleMarkdown(markdown).text;
    const start = text.lastIndexOf(quote);
    return {
      id: "c_1",
      status: "open" as const,
      resolvedAt: null,
      resolvedBy: null,
      messages: [
        {
          id: "c_1",
          author: { kind: "user" as const, name: "You" },
          body: "Here",
          createdAt: "2026-10-19T00:00:00.000Z",
          editedAt: null,
          sentTo: [],
        },
      ],
      anchor: {
        state: "anchored" as const,
        quote,
        start,
        end: start + quote.length,
        line: 1,
      },
    };
  };
  it.each([
    [
      "# Plan\n\n1. [x] Ordered item\n2. Next item\n\nTarget here.",
      "Target here.",
    ],
    ["# Plan\n\nBefore ![cat](cat.png) after\n\nTarget here.", "after"],
    ["# Plan\n\n- item ![a](x.png) tail\n\nTarget here.", "Target here."],
  ])("maps stored offsets onto the editor for %j", (markdown, quote) => {
    const doc = production(markdown).state.doc;
    expect(
      threadRanges(doc, [storedThread(markdown, quote)], null, markdown).map(
        (range) => doc.textBetween(range.from, range.to),
      ),
    ).toEqual([quote]);
  });
  it.each([
    "# Plan\n\n![cat](cat.png)\n\nAfter.",
    "# Plan\n\nIntro\n\n---\n\nAfter.",
  ])("visibly marks a whole block atom comment in %j", (markdown) => {
    const live = production(markdown);
    const ranges = threadRanges(
      live.state.doc,
      [storedThread(markdown, "\ufffc")],
      null,
      markdown,
    );
    expect(ranges).toHaveLength(1);
    live.view.dispatch(
      live.state.tr.setMeta(commentHighlightKey, { ranges, active: null }),
    );
    expect(
      live.view.dom.querySelector(
        "img.docs-comment-highlight, hr.docs-comment-highlight",
      ),
    ).toBeTruthy();
  });
});
