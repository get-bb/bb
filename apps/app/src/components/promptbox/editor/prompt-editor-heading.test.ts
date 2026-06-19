import { describe, expect, it } from "vitest";
import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Node } from "@tiptap/pm/model";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import { promptEditorValueFromDoc } from "./prompt-editor-serialization";
import { createExitHeadingTransaction } from "./prompt-editor-heading";

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

function stateFromJson(docJson: unknown, selectionPosition: number) {
  const doc = Node.fromJSON(schema, docJson);
  return EditorState.create({
    schema,
    doc,
    selection: TextSelection.create(doc, selectionPosition),
  });
}

describe("createExitHeadingTransaction", () => {
  it("turns a newline at the end of a heading into a paragraph below it", () => {
    const state = stateFromJson(
      {
        type: "doc",
        content: [
          {
            type: "heading",
            attrs: { level: 2 },
            content: [{ type: "text", text: "Title" }],
          },
        ],
      },
      6,
    );

    const transaction = createExitHeadingTransaction(state);
    expect(transaction).not.toBeNull();
    const nextState = state.apply(transaction!);

    expect(nextState.doc.toString()).toBe('doc(heading("Title"), paragraph)');
    expect(nextState.selection.from).toBe(8);
    expect(promptEditorValueFromDoc(nextState.doc).text).toBe("## Title\n");
  });

  it("does not exit when the caret is inside heading text", () => {
    const state = stateFromJson(
      {
        type: "doc",
        content: [
          {
            type: "heading",
            attrs: { level: 1 },
            content: [{ type: "text", text: "Title" }],
          },
        ],
      },
      3,
    );

    expect(createExitHeadingTransaction(state)).toBeNull();
  });

  it("does not exit ordinary paragraphs", () => {
    const state = stateFromJson(
      {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Title" }],
          },
        ],
      },
      6,
    );

    expect(createExitHeadingTransaction(state)).toBeNull();
  });
});
