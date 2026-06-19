import type { Editor } from "@tiptap/core";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import { TextSelection } from "@tiptap/pm/state";

export function createExitHeadingTransaction(
  state: EditorState,
): Transaction | null {
  const { selection, schema } = state;
  if (!selection.empty) return null;

  const { $from } = selection;
  if ($from.parent.type.name !== "heading") return null;
  if ($from.parentOffset !== $from.parent.content.size) return null;

  const paragraphType = schema.nodes.paragraph;
  if (!paragraphType) return null;

  const insertAt = $from.after($from.depth);
  const paragraph = paragraphType.create();
  const transaction = state.tr.insert(insertAt, paragraph);
  return transaction
    .setSelection(TextSelection.create(transaction.doc, insertAt + 1))
    .scrollIntoView();
}

export function exitHeading(editor: Editor): boolean {
  const transaction = createExitHeadingTransaction(editor.state);
  if (transaction === null) return false;
  editor.view.dispatch(transaction);
  return true;
}
