import { commands, type Editor } from "@tiptap/core";
import type { EditorState, Transaction } from "@tiptap/pm/state";

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
  let nextTransaction: Transaction | null = null;
  const didSplit = commands.splitBlock({ keepMarks: false })({
    state: args.state,
    tr: transaction,
    dispatch: () => {
      nextTransaction = transaction;
    },
    // SAFETY: Tiptap invokes this command with the editor context supplied by the active editor.
    editor: args.editor as Editor,
    // SAFETY: This command only reads state and dispatches the provided transaction.
    commands: null as never,
    // SAFETY: This command does not call the command-chain helpers.
    can: null as never,
    // SAFETY: This command does not call the command-chain helpers.
    chain: null as never,
    // SAFETY: This command does not access the editor view.
    view: null as never,
  });

  transaction.setStoredMarks([]);
  return didSplit && transaction.docChanged
    ? (nextTransaction ?? transaction)
    : null;
}

export function applyPromptParagraphNewline(editor: Editor): boolean {
  const transaction = createPromptParagraphNewlineTransaction({
    state: editor.state,
    editor,
  });
  if (transaction === null) return false;
  editor.view.dispatch(transaction);
  return true;
}
