import type { Editor } from "@tiptap/react";
import type {
  ActiveTrigger,
  TypeaheadTrigger,
} from "@/components/promptbox/mentions/types";

/**
 * Builds the word-boundary detection regex for a trigger char. A trigger only
 * fires at the start of input or after whitespace / an opening bracket, so a
 * mid-word `a/b` or `foo@bar` never opens a menu.
 *
 * - `@` (mention) keeps its self-exclusion query class `[^\s@]*`, so a second
 *   `@` ends the current query rather than extending it.
 * - command triggers (`/`, `$`) capture the whole token up to whitespace
 *   (`\S*`), so a namespaced name like `frontend:component` is captured whole.
 *
 * `$` is escaped because it is a regex metacharacter.
 */
function triggerPattern(char: TypeaheadTrigger["char"]): RegExp {
  const escapedChar = char === "$" ? "\\$" : char;
  const queryClass = char === "@" ? "[^\\s@]*" : "\\S*";
  return new RegExp(`(^|[\\s([{])${escapedChar}(${queryClass})$`, "u");
}

/**
 * Resolves the typeahead trigger currently under the caret, if any. Replaces the
 * single-`@` `findActiveEditorMention`: it scans the configured `triggers` in
 * order and returns the first whose pattern matches the text before the caret.
 * Because a thread is bound to one provider, the active set is at most `@` plus
 * one command trigger, so order only matters when both could match (they can't —
 * the leading char differs).
 *
 * Returns `null` when the selection is non-empty (a range, not a caret) or no
 * trigger matches.
 */
export function findActiveTrigger(
  editor: Editor,
  triggers: readonly TypeaheadTrigger[],
): ActiveTrigger | null {
  const selection = editor.state.selection;
  if (!selection.empty) return null;

  const textBeforeCursor = editor.state.doc.textBetween(
    0,
    selection.from,
    "\n",
    "\n",
  );

  for (const trigger of triggers) {
    const match = triggerPattern(trigger.char).exec(textBeforeCursor);
    if (!match) continue;

    const query = match[2] ?? "";
    const from = selection.from - query.length - 1;
    if (from < 0) continue;

    return {
      char: trigger.char,
      kind: trigger.kind,
      query,
      from,
      to: selection.from,
    };
  }

  return null;
}
