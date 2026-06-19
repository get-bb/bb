import { describe, expect, it } from "vitest";
import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Node } from "@tiptap/pm/model";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import { promptEditorValueFromDoc } from "./prompt-editor-serialization";
import { createSplitPromptListItemTransaction } from "./prompt-editor-list";

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
