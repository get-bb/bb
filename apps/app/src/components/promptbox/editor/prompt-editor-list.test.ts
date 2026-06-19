import { describe, expect, it } from "vitest";
import { getSchema, type Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Node } from "@tiptap/pm/model";
import { EditorState, TextSelection, type Transaction } from "@tiptap/pm/state";
import { promptEditorValueFromDoc } from "./prompt-editor-serialization";
import {
  applyPromptListNewline,
  createPromptListNewlineTransaction,
  createSplitPromptListItemTransaction,
} from "./prompt-editor-list";

const schema = getSchema([
  StarterKit.configure({
    blockquote: {},
    bold: {},
    bulletList: {},
    code: {},
    codeBlock: false,
    dropcursor: false,
    gapcursor: false,
    heading: {},
    horizontalRule: false,
    italic: {},
    link: false,
    listItem: {},
    orderedList: {},
    strike: false,
    underline: false,
  }),
]);

const editorContext = {
  extensionManager: { attributes: [] },
};

function stateFromJson(docJson: unknown, selectionPosition: number) {
  const doc = Node.fromJSON(schema, docJson);
  return EditorState.create({
    schema,
    doc,
    selection: TextSelection.create(doc, selectionPosition),
  });
}

describe("createSplitPromptListItemTransaction", () => {
  it("turns a newline at the end of a bullet item into the next list item", () => {
    const state = stateFromJson(
      {
        type: "doc",
        content: [
          {
            type: "bulletList",
            content: [
              {
                type: "listItem",
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: "first" }],
                  },
                ],
              },
            ],
          },
        ],
      },
      8,
    );

    const transaction = createSplitPromptListItemTransaction({
      state,
      editor: editorContext,
    });
    expect(transaction).not.toBeNull();
    const nextState = state.apply(transaction!);

    expect(nextState.doc.toString()).toBe(
      'doc(bulletList(listItem(paragraph("first")), listItem(paragraph)))',
    );
    expect(promptEditorValueFromDoc(nextState.doc).text).toBe("- first\n- ");
  });

  it("turns a newline at the end of an ordered item into the next list item", () => {
    const state = stateFromJson(
      {
        type: "doc",
        content: [
          {
            type: "orderedList",
            attrs: { start: 1 },
            content: [
              {
                type: "listItem",
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: "first" }],
                  },
                ],
              },
            ],
          },
        ],
      },
      8,
    );

    const transaction = createSplitPromptListItemTransaction({
      state,
      editor: editorContext,
    });
    expect(transaction).not.toBeNull();
    const nextState = state.apply(transaction!);

    expect(nextState.doc.toString()).toBe(
      'doc(orderedList(listItem(paragraph("first")), listItem(paragraph)))',
    );
    expect(promptEditorValueFromDoc(nextState.doc).text).toBe("1. first\n2. ");
  });

  it("does not handle ordinary paragraphs", () => {
    const state = stateFromJson(
      {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "first" }],
          },
        ],
      },
      6,
    );

    expect(
      createSplitPromptListItemTransaction({ state, editor: editorContext }),
    ).toBeNull();
  });
});

describe("createPromptListNewlineTransaction", () => {
  it("splits then breaks out of a bullet list", () => {
    const state = stateFromJson(
      {
        type: "doc",
        content: [
          {
            type: "bulletList",
            content: [
              {
                type: "listItem",
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: "first" }],
                  },
                ],
              },
            ],
          },
        ],
      },
      8,
    );

    const splitTransaction = createPromptListNewlineTransaction({
      state,
      editor: editorContext,
    });
    expect(splitTransaction).not.toBeNull();
    const splitState = state.apply(splitTransaction!);
    expect(splitState.doc.toString()).toBe(
      'doc(bulletList(listItem(paragraph("first")), listItem(paragraph)))',
    );

    const exitTransaction = createPromptListNewlineTransaction({
      state: splitState,
      editor: editorContext,
    });
    expect(exitTransaction).not.toBeNull();
    const exitState = splitState.apply(exitTransaction!);

    expect(exitState.doc.toString()).toBe(
      'doc(bulletList(listItem(paragraph("first"))), paragraph)',
    );
    expect(promptEditorValueFromDoc(exitState.doc).text).toBe("- first\n");
  });

  it("splits then breaks out of an ordered list", () => {
    const state = stateFromJson(
      {
        type: "doc",
        content: [
          {
            type: "orderedList",
            attrs: { start: 1 },
            content: [
              {
                type: "listItem",
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: "first" }],
                  },
                ],
              },
            ],
          },
        ],
      },
      8,
    );

    const splitTransaction = createPromptListNewlineTransaction({
      state,
      editor: editorContext,
    });
    expect(splitTransaction).not.toBeNull();
    const splitState = state.apply(splitTransaction!);
    expect(splitState.doc.toString()).toBe(
      'doc(orderedList(listItem(paragraph("first")), listItem(paragraph)))',
    );

    const exitTransaction = createPromptListNewlineTransaction({
      state: splitState,
      editor: editorContext,
    });
    expect(exitTransaction).not.toBeNull();
    const exitState = splitState.apply(exitTransaction!);

    expect(exitState.doc.toString()).toBe(
      'doc(orderedList(listItem(paragraph("first"))), paragraph)',
    );
    expect(promptEditorValueFromDoc(exitState.doc).text).toBe("1. first\n");
  });

  it("breaks out of a bullet list from an empty item", () => {
    const state = stateFromJson(
      {
        type: "doc",
        content: [
          {
            type: "bulletList",
            content: [
              {
                type: "listItem",
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: "first" }],
                  },
                ],
              },
              {
                type: "listItem",
                content: [{ type: "paragraph" }],
              },
            ],
          },
        ],
      },
      12,
    );

    const transaction = createPromptListNewlineTransaction({
      state,
      editor: editorContext,
    });
    expect(transaction).not.toBeNull();
    const nextState = state.apply(transaction!);

    expect(nextState.doc.toString()).toBe(
      'doc(bulletList(listItem(paragraph("first"))), paragraph)',
    );
    expect(nextState.selection.from).toBe(12);
    expect(promptEditorValueFromDoc(nextState.doc).text).toBe("- first\n");
  });

  it("breaks out of an ordered list from an empty item", () => {
    const state = stateFromJson(
      {
        type: "doc",
        content: [
          {
            type: "orderedList",
            attrs: { start: 1 },
            content: [
              {
                type: "listItem",
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: "first" }],
                  },
                ],
              },
              {
                type: "listItem",
                content: [{ type: "paragraph" }],
              },
            ],
          },
        ],
      },
      12,
    );

    const transaction = createPromptListNewlineTransaction({
      state,
      editor: editorContext,
    });
    expect(transaction).not.toBeNull();
    const nextState = state.apply(transaction!);

    expect(nextState.doc.toString()).toBe(
      'doc(orderedList(listItem(paragraph("first"))), paragraph)',
    );
    expect(nextState.selection.from).toBe(12);
    expect(promptEditorValueFromDoc(nextState.doc).text).toBe("1. first\n");
  });
});

describe("applyPromptListNewline", () => {
  it("uses the document selection instead of active node detection", () => {
    const state = stateFromJson(
      {
        type: "doc",
        content: [
          {
            type: "bulletList",
            content: [
              {
                type: "listItem",
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: "first" }],
                  },
                ],
              },
            ],
          },
        ],
      },
      8,
    );
    let dispatchedTransaction: Transaction | null = null;
    const editor = {
      state,
      extensionManager: editorContext.extensionManager,
      isActive: () => false,
      view: {
        dispatch: (transaction: Transaction) => {
          dispatchedTransaction = transaction;
        },
      },
    } as unknown as Editor;

    expect(applyPromptListNewline(editor)).toBe(true);
    expect(dispatchedTransaction).not.toBeNull();

    const nextState = state.apply(dispatchedTransaction!);
    expect(nextState.doc.toString()).toBe(
      'doc(bulletList(listItem(paragraph("first")), listItem(paragraph)))',
    );
  });

  it("does not handle ordinary paragraphs", () => {
    const state = stateFromJson(
      {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "first" }],
          },
        ],
      },
      6,
    );
    let didDispatch = false;
    const editor = {
      state,
      extensionManager: editorContext.extensionManager,
      view: {
        dispatch: () => {
          didDispatch = true;
        },
      },
    } as unknown as Editor;

    expect(applyPromptListNewline(editor)).toBe(false);
    expect(didDispatch).toBe(false);
  });
});
