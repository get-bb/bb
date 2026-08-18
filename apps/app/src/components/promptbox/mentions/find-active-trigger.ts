import type { Editor } from "@tiptap/react";
import type {
  ActiveTrigger,
  TypeaheadTrigger,
} from "@/components/promptbox/mentions/types";

interface ActiveTriggerEditor {
  state: {
    selection: {
      empty: boolean;
      from: number;
    };
    doc: {
      textBetween(
        from: number,
        to: number,
        blockSeparator?: string,
        leafText?: string,
      ): string;
    };
  };
}

/**
 * Builds the word-boundary detection regex for a trigger char. A trigger only
 * fires at the start of input or after whitespace / an opening bracket, so a
 * mid-word `a/b` or `foo@bar` never opens a menu.
 *
 * - mention triggers keep a per-char self-exclusion query class, so a second
 *   trigger char ends the current query rather than extending it (`##` stays a
 *   markdown heading, not a `#` mention query).
 * - command triggers (`/`) capture the whole token up to whitespace
 *   (`\S*`), so a namespaced name like `frontend:component` is captured whole.
 */
function escapeRegexLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function triggerPattern(
  trigger: TypeaheadTrigger,
  options: { windowed: boolean },
): RegExp {
  const escapedChar = escapeRegexLiteral(trigger.char);
  const queryClass =
    trigger.kind === "mention" ? `[^\\s${escapedChar}]*` : "\\S*";
  // In a windowed scan the window start is not the start of input, so the
  // `^` alternative must not fire there; a real trigger inside the window
  // always carries its boundary char (the window includes one extra char
  // beyond the longest recognizable query).
  const boundary = options.windowed ? "([\\s([{])" : "(^|[\\s([{])";
  return new RegExp(`${boundary}${escapedChar}(${queryClass})$`, "u");
}

/**
 * How many characters before the caret are scanned for a trigger. Trigger
 * queries are short human-typed tokens (skill/command names, mention
 * queries); scanning the full document instead would rebuild and regex-scan
 * the entire text on every keystroke and selection change, which costs
 * several ms once a large paste (e.g. a minified JS bundle) is in the box. A
 * trigger whose query exceeds the window no longer opens the menu — at that
 * length no menu has useful matches anyway.
 */
const TRIGGER_SCAN_WINDOW = 256;

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
  editor: ActiveTriggerEditor | Editor,
  triggers: readonly TypeaheadTrigger[],
): ActiveTrigger | null {
  const selection = editor.state.selection;
  if (!selection.empty) return null;

  const scanStart = Math.max(0, selection.from - TRIGGER_SCAN_WINDOW);
  const windowed = scanStart > 0;
  const textBeforeCursor = editor.state.doc.textBetween(
    scanStart,
    selection.from,
    "\n",
    "\n",
  );

  for (const trigger of triggers) {
    const match = triggerPattern(trigger, { windowed }).exec(textBeforeCursor);
    if (!match) continue;

    const query = match[2] ?? "";
    const from = selection.from - query.length - 1;
    if (from < 0) continue;

    if (trigger.kind === "mention") {
      return {
        char: trigger.char,
        kind: "mention",
        query,
        from,
        to: selection.from,
      };
    }
    return {
      char: trigger.char,
      kind: "command",
      query,
      from,
      to: selection.from,
    };
  }

  return null;
}
