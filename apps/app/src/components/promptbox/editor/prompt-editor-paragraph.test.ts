import { describe, expect, it } from "vitest";
import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Node } from "@tiptap/pm/model";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import { promptEditorValueFromDoc } from "./prompt-editor-serialization";
import { createPromptParagraphNewlineTransaction } from "./prompt-editor-paragraph";

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
  extensionManager: { attributes: [], splittableMarks: [] },
};

function stateFromJson(docJson: unknown, selectionPosition: number) {
  const doc = Node.fromJSON(schema, docJson);
  return EditorState.create({
    schema,
    doc,
    selection: TextSelection.create(doc, selectionPosition),
  });
}

describe("createPromptParagraphNewlineTransaction", () => {
  it("turns a newline after bold text into an unmarked paragraph", () => {
    const state = stateFromJson(
      {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                marks: [{ type: "bold" }],
                text: "bold",
              },
            ],
          },
        ],
      },
      5,
    );

    const transaction = createPromptParagraphNewlineTransaction({
      state,
      editor: editorContext,
    });
    expect(transaction).not.toBeNull();
    const nextState = state.apply(transaction!);

    expect(nextState.doc.toString()).toBe(
      'doc(paragraph(bold("bold")), paragraph)',
    );
    expect(nextState.selection.from).toBe(7);
    expect(nextState.selection.$from.marks()).toEqual([]);
    expect(nextState.storedMarks).toEqual([]);
    expect(promptEditorValueFromDoc(nextState.doc).text).toBe("**bold**\n");
  });

  it("turns a newline after italic text into an unmarked paragraph", () => {
    const state = stateFromJson(
      {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                marks: [{ type: "italic" }],
                text: "italic",
              },
            ],
          },
        ],
      },
      7,
    );

    const transaction = createPromptParagraphNewlineTransaction({
      state,
      editor: editorContext,
    });
    expect(transaction).not.toBeNull();
    const nextState = state.apply(transaction!);

    expect(nextState.doc.toString()).toBe(
      'doc(paragraph(italic("italic")), paragraph)',
    );
    expect(nextState.selection.$from.marks()).toEqual([]);
    expect(nextState.storedMarks).toEqual([]);
    expect(promptEditorValueFromDoc(nextState.doc).text).toBe("_italic_\n");
  });

  it("turns a newline after inline code into an unmarked paragraph", () => {
    const state = stateFromJson(
      {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                marks: [{ type: "code" }],
                text: "code",
              },
            ],
          },
        ],
      },
      5,
    );

    const transaction = createPromptParagraphNewlineTransaction({
      state,
      editor: editorContext,
    });
    expect(transaction).not.toBeNull();
    const nextState = state.apply(transaction!);

    expect(nextState.doc.toString()).toBe(
      'doc(paragraph(code("code")), paragraph)',
    );
    expect(nextState.selection.$from.marks()).toEqual([]);
    expect(nextState.storedMarks).toEqual([]);
    expect(promptEditorValueFromDoc(nextState.doc).text).toBe("`code`\n");
  });

  it("does not handle paragraphs inside blockquotes", () => {
    const state = stateFromJson(
      {
        type: "doc",
        content: [
          {
            type: "blockquote",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: "quote" }],
              },
            ],
          },
        ],
      },
      7,
    );

    expect(
      createPromptParagraphNewlineTransaction({
        state,
        editor: editorContext,
      }),
    ).toBeNull();
  });
});
