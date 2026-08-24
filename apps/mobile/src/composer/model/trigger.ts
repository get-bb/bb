import {
  findActiveTrigger,
  type ActiveTrigger,
  type ActiveTriggerEditor,
  type PluginMentionTrigger,
  type TypeaheadTrigger,
} from "@bb/client-core";
import type { PromptMentionCommandTrigger } from "@bb/domain";
import type { ComposerValue, TextSelection } from "./document";

/**
 * Text the trigger scanner reads: the display text with every pill masked by
 * newlines of the same length. The web scans ProseMirror's `textBetween`,
 * where a mention atom reads as one "\n"; masking keeps the same effect here
 * (a pill is a word boundary and never part of a query) without moving
 * offsets.
 */
export function maskMentionRanges(value: ComposerValue): string {
  if (value.mentions.length === 0) return value.text;
  let out = "";
  let cursor = 0;
  for (const mention of value.mentions) {
    out += value.text.slice(cursor, mention.start);
    out += "\n".repeat(mention.end - mention.start);
    cursor = mention.end;
  }
  return out + value.text.slice(cursor);
}

/** Adapter from the native selection + text model to client-core's editor slice. */
function createTriggerEditor(
  value: ComposerValue,
  selection: TextSelection,
): ActiveTriggerEditor {
  const masked = maskMentionRanges(value);
  const from = Math.min(selection.start, selection.end);
  return {
    state: {
      selection: { empty: selection.start === selection.end, from },
      doc: {
        textBetween: (start, end) =>
          masked.slice(
            Math.max(0, start),
            Math.min(masked.length, Math.max(start, end)),
          ),
      },
    },
  };
}

/**
 * The typeahead trigger under the caret, if any (client-core's
 * `findActiveTrigger` over the masked display text). `from` / `to` are
 * display offsets: the trigger char and the caret.
 */
export function findActiveComposerTrigger(
  value: ComposerValue,
  selection: TextSelection,
  triggers: readonly TypeaheadTrigger[],
): ActiveTrigger | null {
  if (triggers.length === 0) return null;
  return findActiveTrigger(createTriggerEditor(value, selection), triggers);
}

/** `@` plus any extra plugin mention triggers, then the provider's command trigger. */
export function buildTypeaheadTriggers(args: {
  mentionTriggers: readonly PluginMentionTrigger[];
  commandTrigger: PromptMentionCommandTrigger | null;
}): TypeaheadTrigger[] {
  const triggers: TypeaheadTrigger[] = [];
  for (const char of args.mentionTriggers) {
    triggers.push({ char, kind: "mention" });
  }
  if (args.commandTrigger !== null) {
    triggers.push({ char: args.commandTrigger, kind: "command" });
  }
  return triggers;
}
