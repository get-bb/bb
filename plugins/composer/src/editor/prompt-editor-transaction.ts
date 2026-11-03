import type { Editor } from "@tiptap/core";
import type { Transaction } from "@tiptap/pm/state";

export function dispatchPromptEditorTransaction(
  editor: Editor,
  transaction: Transaction | null,
): boolean {
  if (transaction === null) return false;
  editor.view.dispatch(transaction);
  return true;
}
