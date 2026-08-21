import type { Nodes, Parent, PhrasingContent, Text } from "mdast";
import { visit } from "unist-util-visit";
import type { PromptTextMention } from "@bb/domain";
import type { BbPromptMentionNode, IndexedPromptMention } from "./mdast-nodes";

/**
 * Offset-based mention pipeline for authored prompt bodies (user messages).
 * Headless copy of `apps/app/src/components/ui/markdown-prompt-mentions.tsx`.
 *
 * An authored prompt arrives with an authoritative offset-based `mentions`
 * array spanning every kind (thread, file/path, slash command) — file and
 * command serializations (`@src/foo.ts`, `/deploy`) have no stable token
 * shape to regex. So each mention's exact source span is replaced with an
 * inert sentinel before markdown parsing, and the remark transform turns the
 * sentinel back into a `bbPromptMention` node the renderer draws as a pill.
 */

// Private-use sentinels (U+E000/U+E001) wrap the mention index: OPEN <index>
// CLOSE. Private-use code points cannot be typed in a normal prompt and carry
// no markdown meaning, so the token survives parsing intact inside whatever
// block or inline context it lands in.
const SENTINEL_OPEN = String.fromCharCode(0xe000);
const SENTINEL_CLOSE = String.fromCharCode(0xe001);
const PROMPT_MENTION_PATTERN = new RegExp(
  `${SENTINEL_OPEN}(\\d+)${SENTINEL_CLOSE}`,
  "gu",
);

function promptMentionSentinel(index: number): string {
  return `${SENTINEL_OPEN}${index}${SENTINEL_CLOSE}`;
}

export interface SubstitutePromptMentionsResult {
  /** `text` with each mention span replaced by its sentinel. */
  content: string;
  /** Resolved mentions, indexed to match the sentinel each one produced. */
  mentions: IndexedPromptMention[];
}

/**
 * Drops out-of-range mentions and sorts by start (copy of the web
 * `normalizePromptTextMentions`).
 */
function normalizePromptTextMentions({
  mentions,
  textLength,
}: {
  mentions: readonly PromptTextMention[];
  textLength: number;
}): PromptTextMention[] {
  return mentions
    .filter(
      (mention) =>
        mention.start >= 0 &&
        mention.end > mention.start &&
        mention.end <= textLength,
    )
    .sort((left, right) => left.start - right.start || left.end - right.end);
}

/**
 * Replace each in-range mention span in `text` with a sentinel token, returning
 * the rewritten content plus the index-aligned mention list. Out-of-range and
 * overlapping mentions are dropped, so a sentinel always maps to exactly one
 * entry in `mentions`.
 */
export function substitutePromptMentions(
  text: string,
  mentions: readonly PromptTextMention[],
): SubstitutePromptMentionsResult {
  const normalized = normalizePromptTextMentions({
    mentions,
    textLength: text.length,
  });
  if (normalized.length === 0) {
    return { content: text, mentions: [] };
  }

  const indexed: IndexedPromptMention[] = [];
  let content = "";
  let cursor = 0;
  for (const mention of normalized) {
    if (mention.start < cursor) {
      continue;
    }
    content += text.slice(cursor, mention.start);
    content += promptMentionSentinel(indexed.length);
    indexed.push({
      resource: mention.resource,
      serializedText: text.slice(mention.start, mention.end),
    });
    cursor = mention.end;
  }
  content += text.slice(cursor);
  return { content, mentions: indexed };
}

function promptMentionNode(index: number): BbPromptMentionNode {
  return { type: "bbPromptMention", index };
}

// Splits a text node on the sentinel token, returning the original node when no
// sentinel is present so untouched text stays a plain text node.
function splitTextNodeOnMentions(node: Text): PhrasingContent[] {
  const { value } = node;
  PROMPT_MENTION_PATTERN.lastIndex = 0;
  const replacements: PhrasingContent[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = PROMPT_MENTION_PATTERN.exec(value)) !== null) {
    const index = match[1] === undefined ? Number.NaN : Number(match[1]);
    if (!Number.isInteger(index)) {
      continue;
    }
    if (match.index > cursor) {
      replacements.push({
        type: "text",
        value: value.slice(cursor, match.index),
      });
    }
    replacements.push(promptMentionNode(index));
    cursor = match.index + match[0].length;
  }
  if (replacements.length === 0) {
    return [node];
  }
  if (cursor < value.length) {
    replacements.push({ type: "text", value: value.slice(cursor) });
  }
  return replacements;
}

/**
 * Remark plugin that rewrites each sentinel token inside text nodes into a
 * `bbPromptMention` node. No-op for bodies without sentinels.
 */
export function remarkPromptMentions() {
  return (tree: Nodes): void => {
    visit(tree, "text", (node: Text, index, parent: Parent | undefined) => {
      if (parent === undefined || index === undefined) {
        return;
      }
      const replacements = splitTextNodeOnMentions(node);
      if (replacements.length === 1 && replacements[0] === node) {
        return;
      }
      parent.children.splice(index, 1, ...replacements);
      return index + replacements.length;
    });
  };
}
