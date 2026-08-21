import type { PromptMentionResource } from "@bb/domain";

/**
 * The native composer's editing model: the text the `TextInput` shows plus
 * the mention pills laid over it as ranges.
 *
 * `text` is the DISPLAY text (what the user sees and what the native input
 * holds): a mention range shows its trigger char + label (`@My thread`,
 * `/review`). `serializedText` is what the web editor writes for the same
 * pill (`@thread:thr_1`, `@apps/x/foo.ts`, `/review`) — `serialization.ts`
 * swaps ranges for it when producing a `PromptEditorValue` / `PromptInput`.
 * Offsets in this module are always display offsets (UTF-16 code units, as
 * `TextInput` reports them).
 *
 * Pills are atomic: an edit that touches the inside of a range removes the
 * whole mention (a backspace at its end deletes the entire pill, like the
 * web's ProseMirror atom); inserting at a boundary keeps it intact.
 */

export interface ComposerMention {
  start: number;
  end: number;
  resource: PromptMentionResource;
  /** The text the web editor serializes for this pill (never empty). */
  serializedText: string;
}

export interface ComposerValue {
  text: string;
  mentions: readonly ComposerMention[];
}

const EMPTY_MENTIONS: readonly ComposerMention[] = Object.freeze([]);

export function emptyComposerValue(): ComposerValue {
  return { text: "", mentions: EMPTY_MENTIONS };
}

export function hasComposerText(value: ComposerValue): boolean {
  return value.text.trim().length > 0;
}

function compareMentions(
  left: ComposerMention,
  right: ComposerMention,
): number {
  return left.start - right.start || left.end - right.end;
}

/**
 * Drop ranges that fall outside the text, are empty, or overlap an earlier
 * range, and sort what is left. Every operation normalizes its output so
 * callers can rely on ordered, disjoint, in-bounds ranges.
 */
function normalizeComposerMentions(
  mentions: readonly ComposerMention[],
  textLength: number,
): ComposerMention[] {
  const sorted = [...mentions]
    .filter(
      (mention) =>
        mention.start >= 0 &&
        mention.end > mention.start &&
        mention.end <= textLength &&
        mention.serializedText.length > 0,
    )
    .sort(compareMentions);
  const result: ComposerMention[] = [];
  let cursor = 0;
  for (const mention of sorted) {
    if (mention.start < cursor) continue;
    result.push(mention);
    cursor = mention.end;
  }
  return result;
}

export function createComposerValue(
  text: string,
  mentions: readonly ComposerMention[] = EMPTY_MENTIONS,
): ComposerValue {
  return { text, mentions: normalizeComposerMentions(mentions, text.length) };
}

/** The mention that ends exactly at `offset` (backspace-at-end target). */
export function mentionEndingAt(
  value: ComposerValue,
  offset: number,
): ComposerMention | null {
  return value.mentions.find((mention) => mention.end === offset) ?? null;
}

function mentionIntersects(
  mention: ComposerMention,
  from: number,
  to: number,
): boolean {
  // Half-open [from, to) against [start, end); a collapsed range touches nothing.
  return from < to && mention.start < to && from < mention.end;
}

/**
 * Insert plain text at `at`. Mentions after the insertion shift; a mention
 * whose interior receives the text is dissolved into plain text (its display
 * characters stay, the pill goes).
 */
export function insertText(
  value: ComposerValue,
  at: number,
  text: string,
): ComposerValue {
  const position = clamp(at, 0, value.text.length);
  if (text.length === 0) return value;
  const nextText =
    value.text.slice(0, position) + text + value.text.slice(position);
  const mentions: ComposerMention[] = [];
  for (const mention of value.mentions) {
    if (mention.end <= position) {
      mentions.push(mention);
    } else if (mention.start >= position) {
      mentions.push({
        ...mention,
        start: mention.start + text.length,
        end: mention.end + text.length,
      });
    }
    // else: strictly inside → dissolved
  }
  return { text: nextText, mentions };
}

export interface DeleteRangeResult {
  value: ComposerValue;
  /** The range that was actually removed after pill expansion. */
  from: number;
  to: number;
}

/**
 * Delete `[from, to)`. A pill that the range touches (even partially) is
 * removed whole, so the effective deletion can be wider than requested — the
 * caller reads `from`/`to` to place the caret. A collapsed range is a no-op.
 */
export function deleteRange(
  value: ComposerValue,
  from: number,
  to: number,
): DeleteRangeResult {
  let start = clamp(Math.min(from, to), 0, value.text.length);
  let end = clamp(Math.max(from, to), 0, value.text.length);
  // Expand over every touched pill (repeat: expansion can reach further pills).
  let expanded = true;
  while (expanded) {
    expanded = false;
    for (const mention of value.mentions) {
      if (!mentionIntersects(mention, start, end)) continue;
      if (mention.start < start) {
        start = mention.start;
        expanded = true;
      }
      if (mention.end > end) {
        end = mention.end;
        expanded = true;
      }
    }
  }
  if (start === end) {
    return { value, from: start, to: end };
  }
  const removed = end - start;
  const nextText = value.text.slice(0, start) + value.text.slice(end);
  const mentions: ComposerMention[] = [];
  for (const mention of value.mentions) {
    if (mention.end <= start) {
      mentions.push(mention);
    } else if (mention.start >= end) {
      mentions.push({
        ...mention,
        start: mention.start - removed,
        end: mention.end - removed,
      });
    }
  }
  return { value: { text: nextText, mentions }, from: start, to: end };
}

export interface ReplaceRangeResult {
  value: ComposerValue;
  /** Caret position after the replacement (end of the inserted content). */
  caret: number;
}

/**
 * Replace `[from, to)` with plain text. Pills touched by a non-empty range go
 * (see `deleteRange`); a collapsed range is a plain insertion (typing inside
 * a pill dissolves it, see `insertText`); pills after it shift.
 */
export function replaceRange(
  value: ComposerValue,
  from: number,
  to: number,
  text: string,
): ReplaceRangeResult {
  const deleted = deleteRange(value, from, to);
  const inserted = insertText(deleted.value, deleted.from, text);
  return { value: inserted, caret: deleted.from + text.length };
}

export interface InsertMentionArgs {
  from: number;
  to: number;
  displayText: string;
  serializedText: string;
  resource: PromptMentionResource;
  /** Text appended after the pill (the web inserts " " unless one follows). */
  trailingText?: string;
}

/**
 * Replace `[from, to)` (typically the active trigger + query) with a pill.
 * Returns the caret after the pill and its trailing text.
 */
export function insertMention(
  value: ComposerValue,
  args: InsertMentionArgs,
): ReplaceRangeResult {
  const trailing = args.trailingText ?? "";
  const replaced = replaceRange(
    value,
    args.from,
    args.to,
    args.displayText + trailing,
  );
  const start = replaced.caret - trailing.length - args.displayText.length;
  const mention: ComposerMention = {
    start,
    end: start + args.displayText.length,
    resource: args.resource,
    serializedText: args.serializedText,
  };
  return {
    value: {
      text: replaced.value.text,
      mentions: normalizeComposerMentions(
        [...replaced.value.mentions, mention],
        replaced.value.text.length,
      ),
    },
    caret: replaced.caret,
  };
}

/** Remove one pill and its display text. */
export function removeMention(
  value: ComposerValue,
  mention: ComposerMention,
): ReplaceRangeResult {
  const deleted = deleteRange(value, mention.start, mention.end);
  return { value: deleted.value, caret: deleted.from };
}

/** True when `text[offset]` (or the end of text) is whitespace. */
export function hasWhitespaceAt(text: string, offset: number): boolean {
  if (offset >= text.length) return false;
  return /\s/u.test(text.charAt(offset));
}

export interface TextChange {
  /** Replaced range in the previous text. */
  from: number;
  to: number;
  inserted: string;
}

export interface TextSelection {
  start: number;
  end: number;
}

function isConsistentChange(
  previous: string,
  next: string,
  change: TextChange,
): boolean {
  if (
    change.from < 0 ||
    change.to > previous.length ||
    change.from > change.to
  ) {
    return false;
  }
  if (
    next.length !==
    previous.length - (change.to - change.from) + change.inserted.length
  ) {
    return false;
  }
  return (
    next.startsWith(previous.slice(0, change.from)) &&
    next.endsWith(previous.slice(change.to)) &&
    next.slice(change.from, change.from + change.inserted.length) ===
      change.inserted
  );
}

/**
 * Derive the edit the native input applied from the previous and next text.
 * The common prefix/suffix diff is ambiguous inside runs of repeated
 * characters (typing `@` right before an `@pill`), so when the selection
 * before the edit is known it is tried first — as the caret before the edit
 * (iOS reports the text before the selection) and as the caret after it — and
 * kept only when it reproduces `next` exactly.
 */
export function computeTextChange(
  previous: string,
  next: string,
  selectionHint: TextSelection | null = null,
): TextChange | null {
  if (previous === next) return null;
  let prefix = 0;
  const maxPrefix = Math.min(previous.length, next.length);
  while (
    prefix < maxPrefix &&
    previous.charCodeAt(prefix) === next.charCodeAt(prefix)
  ) {
    prefix += 1;
  }
  let suffix = 0;
  const maxSuffix = maxPrefix - prefix;
  while (
    suffix < maxSuffix &&
    previous.charCodeAt(previous.length - 1 - suffix) ===
      next.charCodeAt(next.length - 1 - suffix)
  ) {
    suffix += 1;
  }
  const diff: TextChange = {
    from: prefix,
    to: previous.length - suffix,
    inserted: next.slice(prefix, next.length - suffix),
  };
  if (selectionHint === null) return diff;

  const deletedLength = diff.to - diff.from;
  const insertedLength = diff.inserted.length;
  const start = Math.min(selectionHint.start, selectionHint.end);
  const end = Math.max(selectionHint.start, selectionHint.end);
  const candidates: TextChange[] = [];
  const candidate = (from: number, to: number) => {
    if (from < 0 || to > previous.length || from > to) return;
    candidates.push({
      from,
      to,
      inserted: next.slice(from, from + insertedLength),
    });
  };
  // iOS reports the selection change before the text change, so the hint
  // is usually the caret AFTER the edit; the pre-edit reading is tried next.
  if (start !== end) {
    // A range selection that was typed over / deleted.
    candidate(start, end);
  } else if (deletedLength === 0) {
    candidate(start - insertedLength, start - insertedLength);
    candidate(start, start);
  } else if (insertedLength === 0) {
    candidate(start, start + deletedLength);
    candidate(start - deletedLength, start);
  } else {
    // Replacement (autocorrect, predictive text) ending at / before the caret.
    candidate(start - insertedLength, start - insertedLength + deletedLength);
    candidate(start - deletedLength, start);
    candidate(start, start + deletedLength);
  }
  for (const option of candidates) {
    if (
      option.to - option.from === deletedLength &&
      isConsistentChange(previous, next, option)
    ) {
      return option;
    }
  }
  return diff;
}

export interface ApplyTextChangeResult {
  value: ComposerValue;
  /** Caret position implied by the change (after the inserted text). */
  caret: number;
  /** True when pills made the model text differ from the native text. */
  textDiffersFromInput: boolean;
}

/**
 * Reconcile the model with the text the native input now holds. Pills that
 * the edit touched are removed whole, which can make the model text shorter
 * than the input's; the caller then pushes the model text back to the input.
 */
export function applyTextChange(
  value: ComposerValue,
  nextText: string,
  selectionHint: TextSelection | null = null,
): ApplyTextChangeResult {
  const change = computeTextChange(value.text, nextText, selectionHint);
  if (change === null) {
    return { value, caret: nextText.length, textDiffersFromInput: false };
  }
  const replaced = replaceRange(value, change.from, change.to, change.inserted);
  return {
    value: replaced.value,
    caret: replaced.caret,
    textDiffersFromInput: replaced.value.text !== nextText,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
