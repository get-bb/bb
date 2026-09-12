import { commands, type Editor } from "@tiptap/core";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import { dispatchPromptEditorTransaction } from "./prompt-editor-transaction";

interface SplitBlockEditorContext {
  extensionManager: {
    attributes: Editor["extensionManager"]["attributes"];
    splittableMarks?: Editor["extensionManager"]["splittableMarks"];
  };
}

export function createPromptParagraphNewlineTransaction(args: {
  state: EditorState;
  editor: SplitBlockEditorContext;
}): Transaction | null {
  const { selection } = args.state;
  if (!selection.empty) return null;

  const { $from } = selection;
  if ($from.depth !== 1 || $from.parent.type.name !== "paragraph") {
    return null;
  }

  const transaction = args.state.tr;
  const didSplit = commands.splitBlock({ keepMarks: false })({
    state: args.state,
    tr: transaction,
    dispatch: () => {},
    editor: args.editor as Editor,
    commands: null as never,
    can: null as never,
    chain: null as never,
    view: null as never,
  });

  transaction.setStoredMarks([]);
  return didSplit && transaction.docChanged ? transaction : null;
}

export function applyPromptParagraphNewline(editor: Editor): boolean {
  return dispatchPromptEditorTransaction(
    editor,
    createPromptParagraphNewlineTransaction({ state: editor.state, editor }),
  );
}
