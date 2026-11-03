// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Table from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";
import { afterEach, describe, expect, it } from "vitest";
import { createProposalDiff, proposalDiffKey } from "./proposal-diff";

const editors: Editor[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) {
    editor.destroy();
    editor.options.element.remove();
  }
});

function fixture(before: string, after: string) {
  let base: ProseMirrorNode | null = null;
  const element = document.createElement("div");
  document.body.append(element);
  const editor = new Editor({
    element,
    extensions: [
      StarterKit,
      Table,
      TableRow,
      TableCell,
      TableHeader,
      createProposalDiff({ getBaseDocument: () => base }),
    ],
    content: before,
  });
  editors.push(editor);
  base = editor.state.doc;
  editor.commands.setContent(after);
  return {
    editor,
    clear: () => {
      base = null;
      editor.view.dispatch(
        editor.state.tr.setMeta(proposalDiffKey, { refresh: true }),
      );
    },
  };
}

function removed(editor: Editor) {
  return Array.from(editor.view.dom.querySelectorAll("[data-proposal-removed]"))
    .map((node) => node.textContent)
    .join("");
}

describe("proposal decorations", () => {
  it("shows word changes within rich text without serializing deleted content", () => {
    const { editor, clear } = fixture(
      "<p>A <strong>simple place</strong> for ideas.</p>",
      "<p>A <strong>calmer space</strong> for ideas.</p>",
    );
    expect(removed(editor)).toBe("simple place");
    expect(
      editor.view.dom.querySelector("[data-proposal-removed] strong"),
    ).not.toBeNull();
    expect(
      editor.view.dom.querySelector("[data-proposal-added]"),
    ).not.toBeNull();
    expect(editor.getHTML()).toBe(
      "<p>A <strong>calmer space</strong> for ideas.</p>",
    );
    clear();
    expect(editor.view.dom.querySelector("[data-proposal-removed]")).toBeNull();
    editor.commands.insertContent("!");
    expect(editor.view.dom.querySelector("[data-proposal-added]")).toBeNull();
  });

  it("aligns inserted and removed blocks without marking subsequent unchanged blocks", () => {
    const { editor } = fixture(
      "<h2>Heading</h2><p>Remove this block.</p><p>Unchanged tail.</p>",
      "<p>New introduction.</p><h2>Heading</h2><p>Unchanged tail.</p>",
    );
    expect(removed(editor)).toBe("Remove this block.");
    expect(
      editor.view.dom.querySelector("[data-proposal-added]")?.textContent,
    ).toBe("New introduction.");
    expect(
      editor.view.dom.querySelectorAll("[data-proposal-added]"),
    ).toHaveLength(1);
    expect(editor.getHTML()).toBe(
      "<p>New introduction.</p><h2>Heading</h2><p>Unchanged tail.</p>",
    );
  });

  it("preserves list, code, and table structure and detects formatting changes", () => {
    const { editor } = fixture(
      "<ul><li><p>old item</p></li></ul><pre><code>before()</code></pre><table><tr><td><p>plain</p></td></tr></table>",
      "<ul><li><p>new item</p></li></ul><pre><code>after()</code></pre><table><tr><td><p><strong>plain</strong></p></td></tr></table>",
    );
    expect(editor.getHTML()).toContain("<ul><li><p>new item</p></li></ul>");
    expect(editor.getHTML()).toContain("<pre><code>after()</code></pre>");
    expect(editor.getHTML()).toContain("<strong>plain</strong>");
    expect(
      editor.view.dom.querySelector("td [data-proposal-removed]")?.textContent,
    ).toBe("plain");
    expect(
      editor.view.dom.querySelector("td [data-proposal-added]")?.textContent,
    ).toBe("plain");
  });

  it("does not reset the candidate or selection while typing", () => {
    const { editor } = fixture(
      "<p>A simple place.</p>",
      "<p>A calmer space.</p>",
    );
    editor.view.dispatch(
      editor.state.tr
        .setSelection(TextSelection.create(editor.state.doc, 6))
        .insertText("x"),
    );
    expect(editor.state.selection.from).toBe(7);
    expect(editor.state.doc.textContent).toBe("A calxmer space.");
    editor.view.dispatch(editor.state.tr.delete(6, 7));
    expect(editor.state.selection.from).toBe(6);
    expect(editor.state.doc.textContent).toBe("A calmer space.");
  });

  it("first crosses a deletion on Backspace, then allows deletion from its left", () => {
    const { editor } = fixture("<p>A old B</p>", "<p>A B</p>");
    const deleted = editor.view.dom.querySelector("[data-proposal-removed]");
    expect(deleted).not.toBeNull();
    if (!deleted) return;
    const position = editor.view.posAtDOM(deleted, 0);
    editor.view.dispatch(
      editor.state.tr.setSelection(
        TextSelection.create(editor.state.doc, position),
      ),
    );
    const current = editor.view.dom.querySelector("[data-proposal-removed]");
    const selection = document.getSelection();
    if (!current || !selection) throw new Error("Missing selection fixture");
    const range = document.createRange();
    range.setStartAfter(current);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    const press = () =>
      editor.view.someProp("handleKeyDown", (handler) =>
        handler(
          editor.view,
          new KeyboardEvent("keydown", { key: "Backspace" }),
        ),
      );
    expect(press()).toBe(true);
    expect(editor.state.doc.textContent).toBe("A B");
    expect(proposalDiffKey.getState(editor.state)?.beforeDeletion).toBe(
      position,
    );
    const next = editor.view.dom.querySelector("[data-proposal-removed]");
    if (!next) throw new Error("Missing deletion");
    range.setStartBefore(next);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    expect(press()).not.toBe(true);
    editor.view.dispatch(editor.state.tr.delete(position - 1, position));
    expect(editor.state.doc.textContent).toBe("AB");
    expect(editor.state.selection.from).toBe(position - 1);
  });

  it("bounds dissimilar large inputs while keeping all candidate content editable", () => {
    const { editor } = fixture(
      `<p>${"a".repeat(12000)}</p>`,
      `<p>${"b".repeat(12000)}</p>`,
    );
    expect(removed(editor)).toBe("a".repeat(12000));
    expect(editor.state.doc.textContent).toBe("b".repeat(12000));
    expect(editor.getHTML()).not.toContain("data-proposal");
  });
});
