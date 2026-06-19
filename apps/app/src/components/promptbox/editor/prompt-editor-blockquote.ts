import type { Editor } from "@tiptap/core";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import { TextSelection } from "@tiptap/pm/state";

export function createInsertParagraphBeforeBlockquoteTransaction(
  state: EditorState,
): Transaction | null {
  const { selection, schema } = state;
  if (!selection.empty) return null;

  const { $from } = selection;
  const paragraphType = schema.nodes.paragraph;
  if (!paragraphType || $from.parent.type !== paragraphType) return null;
  if ($from.parentOffset !== 0) return null;

  let blockquoteDepth: number | null = null;
  for (let depth = $from.depth - 1; depth > 0; depth -= 1) {
    if ($from.node(depth).type.name === "blockquote") {
      blockquoteDepth = depth;
      break;
    }
  }
  if (blockquoteDepth === null) return null;
  if ($from.index(blockquoteDepth) !== 0) return null;

  const insertAt = $from.before(blockquoteDepth);
  const emptyParagraph = paragraphType.create();
  const transaction = state.tr.insert(insertAt, emptyParagraph);
  return transaction
    .setSelection(TextSelection.create(transaction.doc, insertAt + 1))
    .scrollIntoView();
}

export function createExitTrailingBlockquoteBreakTransaction(
  state: EditorState,
): Transaction | null {
  const { selection, schema } = state;
  if (!selection.empty) return null;

  const { $from } = selection;
  const paragraphType = schema.nodes.paragraph;
  if (!paragraphType || $from.parent.type !== paragraphType) return null;
  if ($from.parentOffset !== $from.parent.content.size) return null;

  const nodeBefore = $from.nodeBefore;
  if (!nodeBefore || nodeBefore.type.name !== "hardBreak") return null;

  let blockquoteDepth: number | null = null;
  for (let depth = $from.depth - 1; depth > 0; depth -= 1) {
    if ($from.node(depth).type.name === "blockquote") {
      blockquoteDepth = depth;
      break;
    }
  }
  if (blockquoteDepth === null) return null;

  if ($from.after($from.depth) !== $from.end(blockquoteDepth)) {
    return null;
  }

  const hardBreakFrom = selection.from - nodeBefore.nodeSize;
  const afterBlockquote = $from.after(blockquoteDepth);
  const emptyParagraph = paragraphType.create();
  let transaction = state.tr.delete(hardBreakFrom, selection.from);
  const insertAt = transaction.mapping.map(afterBlockquote);
  transaction = transaction.insert(insertAt, emptyParagraph);
  return transaction
    .setSelection(TextSelection.create(transaction.doc, insertAt + 1))
    .scrollIntoView();
}

export function exitTrailingBlockquoteBreak(editor: Editor): boolean {
  const transaction = createExitTrailingBlockquoteBreakTransaction(
    editor.state,
  );
  if (transaction === null) return false;
  editor.view.dispatch(transaction);
  return true;
}

export function insertParagraphBeforeBlockquote(editor: Editor): boolean {
  const transaction = createInsertParagraphBeforeBlockquoteTransaction(
    editor.state,
  );
  if (transaction === null) return false;
  editor.view.dispatch(transaction);
  return true;
}
