// @vitest-environment jsdom

import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, describe, expect, it } from "vitest";
import { PromptMentionExtension } from "@/components/promptbox/editor/prompt-mention-extension";
import { findActiveTrigger } from "./find-active-trigger";
import type {
  ActiveTrigger,
  TypeaheadTrigger,
} from "@/components/promptbox/mentions/types";

const testEditorExtensions = [
  StarterKit.configure({
    blockquote: false,
    bold: false,
    bulletList: false,
    code: false,
    codeBlock: false,
    dropcursor: false,
    gapcursor: false,
    heading: false,
    horizontalRule: false,
    italic: false,
    listItem: false,
    orderedList: false,
    strike: false,
  }),
  PromptMentionExtension,
];

const MENTION_TRIGGER: TypeaheadTrigger = { char: "@", kind: "mention" };
const SLASH_TRIGGER: TypeaheadTrigger = { char: "/", kind: "command" };
const DOLLAR_TRIGGER: TypeaheadTrigger = { char: "$", kind: "command" };

let activeEditor: Editor | null = null;

afterEach(() => {
  activeEditor?.destroy();
  activeEditor = null;
});

/**
 * Creates a single-paragraph editor with `text` and the caret placed after
 * `caretOffset` characters (defaults to end of text). The editor's document
 * position is `caretOffset + 1` (1 for the opening paragraph token).
 */
function editorWithCaret(text: string, caretOffset = text.length): Editor {
  const editor = new Editor({
    extensions: testEditorExtensions,
    content: text.length === 0 ? "" : { type: "doc", content: [paragraph(text)] },
  });
  activeEditor = editor;
  const docPosition = caretOffset + 1;
  editor.commands.setTextSelection(docPosition);
  return editor;
}

function paragraph(text: string) {
  return { type: "paragraph", content: [{ type: "text", text }] };
}

describe("findActiveTrigger", () => {
  it("detects an `@` mention at the start of input", () => {
    const editor = editorWithCaret("@rea");
    const result = findActiveTrigger(editor, [MENTION_TRIGGER]);

    expect(result).toEqual<ActiveTrigger>({
      char: "@",
      kind: "mention",
      query: "rea",
      from: 1,
      to: 5,
    });
  });

  it("detects an `@` mention after whitespace", () => {
    const editor = editorWithCaret("ask @file");
    const result = findActiveTrigger(editor, [MENTION_TRIGGER]);

    expect(result?.kind).toBe("mention");
    expect(result?.query).toBe("file");
  });

  it("ignores a mid-word `@` (email-like token)", () => {
    const editor = editorWithCaret("ping foo@bar");
    expect(findActiveTrigger(editor, [MENTION_TRIGGER])).toBeNull();
  });

  it("detects a `/` command at a word boundary", () => {
    const editor = editorWithCaret("/rev");
    const result = findActiveTrigger(editor, [MENTION_TRIGGER, SLASH_TRIGGER]);

    expect(result).toEqual<ActiveTrigger>({
      char: "/",
      kind: "command",
      query: "rev",
      from: 1,
      to: 5,
    });
  });

  it("detects a `$` command at a word boundary", () => {
    const editor = editorWithCaret("$pr");
    const result = findActiveTrigger(editor, [MENTION_TRIGGER, DOLLAR_TRIGGER]);

    expect(result).toEqual<ActiveTrigger>({
      char: "$",
      kind: "command",
      query: "pr",
      from: 1,
      to: 4,
    });
  });

  it("captures a namespaced command name whole", () => {
    const editor = editorWithCaret("run /frontend:component");
    const result = findActiveTrigger(editor, [MENTION_TRIGGER, SLASH_TRIGGER]);

    expect(result?.kind).toBe("command");
    expect(result?.query).toBe("frontend:component");
  });

  it("detects an empty command query right after the trigger", () => {
    const editor = editorWithCaret("/");
    const result = findActiveTrigger(editor, [MENTION_TRIGGER, SLASH_TRIGGER]);

    expect(result).toEqual<ActiveTrigger>({
      char: "/",
      kind: "command",
      query: "",
      from: 1,
      to: 2,
    });
  });

  it("ignores a mid-word `/` (path-like token)", () => {
    const editor = editorWithCaret("see a/b");
    expect(
      findActiveTrigger(editor, [MENTION_TRIGGER, SLASH_TRIGGER]),
    ).toBeNull();
  });

  it("closes the command menu on a trailing space (now typing arguments)", () => {
    const editor = editorWithCaret("/review ");
    expect(
      findActiveTrigger(editor, [MENTION_TRIGGER, SLASH_TRIGGER]),
    ).toBeNull();
  });

  it("does not match `/` or `$` when only the `@` trigger is active", () => {
    const slashEditor = editorWithCaret("/rev");
    expect(findActiveTrigger(slashEditor, [MENTION_TRIGGER])).toBeNull();

    const dollarEditor = editorWithCaret("$prd");
    expect(findActiveTrigger(dollarEditor, [MENTION_TRIGGER])).toBeNull();
  });

  it("returns null when the selection is a non-empty range", () => {
    const editor = editorWithCaret("/review");
    // Select the whole token rather than collapsing to a caret.
    editor.commands.setTextSelection({ from: 1, to: 8 });
    expect(
      findActiveTrigger(editor, [MENTION_TRIGGER, SLASH_TRIGGER]),
    ).toBeNull();
  });
});
