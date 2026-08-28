import { commands, type Editor } from "@tiptap/core";
import type { EditorState, Transaction } from "@tiptap/pm/state";

interface SplitListEditorContext {
  extensionManager: {
    attributes: Editor["extensionManager"]["attributes"];
  };
}

function commandProps(args: {
  state: EditorState;
  tr: Transaction;
  editor: SplitListEditorContext;
  dispatch: (transaction?: Transaction) => void;
}) {
  // SAFETY: The list commands read only state, transaction, dispatch, and editor.extensionManager.
  return {
    state: args.state,
    tr: args.tr,
    dispatch: args.dispatch,
    editor: args.editor as Editor,
    commands: null as never,
    can: null as never,
    chain: null as never,
    view: null as never,
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
  const didSplit = commands.splitListItem(listItemType)(
    commandProps({
      state: args.state,
      tr: transaction,
      dispatch: () => {
        nextTransaction = transaction;
      },
      editor: args.editor,
    }),
  );

  return didSplit && transaction.docChanged
    ? (nextTransaction ?? transaction)
    : null;
}

function createLiftPromptListItemTransaction(args: {
  state: EditorState;
  editor: SplitListEditorContext;
}): Transaction | null {
  const listItemType = args.state.schema.nodes.listItem;
  if (!listItemType) return null;

  let nextTransaction = args.state.tr;
  let didDispatch = false;
  const didLift = commands.liftListItem(listItemType)(
    commandProps({
      state: args.state,
      tr: args.state.tr,
      dispatch: (transaction?: Transaction) => {
        didDispatch = true;
        nextTransaction = transaction ?? args.state.tr;
      },
      editor: args.editor,
    }),
  );

  return didLift && didDispatch && nextTransaction.docChanged
    ? nextTransaction
    : null;
}

function isSelectionInEmptyListItem(state: EditorState): boolean {
  const { selection } = state;
  if (!selection.empty) return false;

  const { $from } = selection;
  if ($from.parent.type.name !== "paragraph" || $from.parent.content.size > 0) {
    return false;
  }

  for (let depth = $from.depth - 1; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    if (node.type.name !== "listItem") continue;
    return (
      node.childCount === 1 &&
      node.firstChild?.type.name === "paragraph" &&
      node.firstChild.content.size === 0
    );
  }

  return false;
}

export function createPromptListNewlineTransaction(args: {
  state: EditorState;
  editor: SplitListEditorContext;
}): Transaction | null {
  if (isSelectionInEmptyListItem(args.state)) {
    return createLiftPromptListItemTransaction(args);
  }

  return (
    createSplitPromptListItemTransaction(args) ??
    createLiftPromptListItemTransaction(args)
  );
}

export function applyPromptListNewline(editor: Editor): boolean {
  const transaction = createPromptListNewlineTransaction({
    state: editor.state,
    editor,
  });
  if (transaction === null) return false;
  editor.view.dispatch(transaction);
  return true;
}
