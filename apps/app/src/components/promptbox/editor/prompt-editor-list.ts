import { commands, type Editor } from "@tiptap/core";
import type { EditorState, Transaction } from "@tiptap/pm/state";

interface SplitListEditorContext {
  extensionManager: {
    attributes: Editor["extensionManager"]["attributes"];
  };
}

export function createSplitPromptListItemTransaction(args: {
  state: EditorState;
  editor: SplitListEditorContext;
}): Transaction | null {
  const listItemType = args.state.schema.nodes.listItem;
  if (!listItemType) return null;

  const transaction = args.state.tr;
  let nextTransaction: Transaction | null = null;
  const didSplit = commands.splitListItem(listItemType)({
    state: args.state,
    tr: transaction,
    dispatch: () => {
      nextTransaction = transaction;
    },
    editor: args.editor as Editor,
    commands: null as never,
    can: null as never,
    chain: null as never,
    view: null as never,
  });

  return didSplit && transaction.docChanged
    ? (nextTransaction ?? transaction)
    : null;
}

export function splitPromptListItem(editor: Editor): boolean {
  if (!editor.isActive("listItem")) return false;
  const transaction = createSplitPromptListItemTransaction({
    state: editor.state,
    editor,
  });
  if (transaction === null) return false;
  editor.view.dispatch(transaction);
  return true;
}
