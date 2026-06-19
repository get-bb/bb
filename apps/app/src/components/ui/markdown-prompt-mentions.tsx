import type { ComponentType } from "react";
import type { Nodes, Parent, PhrasingContent, Text } from "mdast";
// Side-effect import: augments mdast's `Data` with `hName`/`hProperties` so a
// plain `text` node can carry the custom element instructions below.
import type {} from "mdast-util-to-hast";
import { visit } from "unist-util-visit";
import type { PromptTextMention } from "@bb/domain";
import {
  normalizePromptTextMentions,
  PromptMentionPill,
} from "@/components/thread/timeline/ConversationMessageMentions.js";
import type { PromptMentionLinkResolver } from "@/components/promptbox/editor/prompt-mention-link";
import type { TimelineTitleLinkResolver } from "@/components/thread/timeline/TimelineTitleView.js";

/**
 * Offset-based mention pipeline for authored prompt bodies (user messages),
 * complementing the token/regex pipeline in `markdown-thread-mentions.tsx`.
 *
 * Generated bodies (system messages) carry a single `@thread:<id>` token that a
 * template injects into already-rendered text, so that path matches the token
 * by regex. An authored prompt instead arrives with an authoritative
 * offset-based `mentions` array spanning every kind (thread, file/path, slash
 * command) — file and command serializations (`@src/foo.ts`, `/deploy`) have no
 * stable token shape to regex. So here we replace each mention's exact source
 * span with an inert sentinel before markdown parsing, then render the sentinel
 * back into the canonical pill. This preserves every mention kind without
 * guessing at token shapes, and reuses the shared `PromptMentionPill`.
 */

// Private-use sentinels (U+E000/U+E001) wrap the mention index: OPEN <index>
// CLOSE. Built via fromCharCode so the source stays free of invisible glyphs.
// Private-use code points can't be typed in a normal prompt, so a sentinel can
// never collide with authored text, and they carry no markdown meaning (no
// emphasis/link/list parsing), so the token survives parsing intact inside
// whatever block or inline context it lands in.
const SENTINEL_OPEN = String.fromCharCode(0xe000);
const SENTINEL_CLOSE = String.fromCharCode(0xe001);
const PROMPT_MENTION_PATTERN = new RegExp(
  `${SENTINEL_OPEN}(\\d+)${SENTINEL_CLOSE}`,
  "gu",
);

const PROMPT_MENTION_HAST_NAME = "bb-prompt-mention";
// hast property key — `mdast-util-to-hast` lowercases it into the
// `data-mention-index` DOM attribute the component reads back.
const PROMPT_MENTION_INDEX_PROPERTY = "dataMentionIndex";

function promptMentionSentinel(index: number): string {
  return `${SENTINEL_OPEN}${index}${SENTINEL_CLOSE}`;
}

export interface IndexedPromptMention {
  resource: PromptTextMention["resource"];
  /** The exact source span (`@thread:<id>`, `@src/foo.ts`, `/deploy`, …). */
  serializedText: string;
}

export interface SubstitutePromptMentionsResult {
  /** `text` with each mention span replaced by its sentinel. */
  content: string;
  /** Resolved mentions, indexed to match the sentinel each one produced. */
  mentions: IndexedPromptMention[];
}

/**
 * Replace each in-range mention span in `text` with a sentinel token, returning
 * the rewritten content plus the index-aligned mention list. Out-of-range and
 * overlapping mentions are dropped (matching `renderMentionTextSegments`), so a
 * sentinel always maps to exactly one entry in `mentions`.
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

// Builds a real mdast `text` node that, via `data.hName`, renders as the custom
// element rather than its (empty) text value.
function promptMentionNode(index: number): Text {
  return {
    type: "text",
    value: "",
    data: {
      hName: PROMPT_MENTION_HAST_NAME,
      hProperties: { [PROMPT_MENTION_INDEX_PROPERTY]: index },
    },
  };
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
 * custom inline node the `components` map renders as the canonical mention pill.
 * No-op for bodies without sentinels.
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

export interface MarkdownPromptMentions {
  /** Mentions with offsets into the `content` passed to `MarkdownPreview`. */
  mentions: readonly PromptTextMention[];
  /** Routes a thread mention's pill link (the resolver the title links use). */
  resolveLinkHref?: TimelineTitleLinkResolver;
  /** Resolves a file/path mention's click action; null keeps it display-only. */
  resolveMentionLink?: PromptMentionLinkResolver;
}

interface BuildPromptMentionComponentArgs {
  mentions: readonly IndexedPromptMention[];
  resolveLinkHref?: TimelineTitleLinkResolver;
  resolveMentionLink?: PromptMentionLinkResolver;
}

interface PromptMentionElementProps {
  "data-mention-index"?: string;
}

// `react-markdown`'s `Components` map is keyed by `JSX.IntrinsicElements`, so
// the custom element the remark plugin emits must be declared there for the
// `components` entry to type-check. It is render-only (never authored as JSX).
declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "bb-prompt-mention": PromptMentionElementProps;
    }
  }
}

function resolveThreadMentionHref(
  resource: PromptTextMention["resource"],
  resolveLinkHref: TimelineTitleLinkResolver | undefined,
): string | undefined {
  if (resource.kind !== "thread" || !resolveLinkHref) {
    return undefined;
  }
  return (
    resolveLinkHref({ kind: "thread", threadId: resource.threadId }) ??
    undefined
  );
}

/**
 * The `components` renderer for prompt mentions, keyed (by the caller) on the
 * custom hast element the remark plugin emits. Looks the mention up by its
 * sentinel index and renders the canonical `PromptMentionPill` — thread links
 * routed through `resolveLinkHref`, file/path activation through
 * `resolveMentionLink`, commands display-only.
 */
export function buildPromptMentionComponent({
  mentions,
  resolveLinkHref,
  resolveMentionLink,
}: BuildPromptMentionComponentArgs): ComponentType<PromptMentionElementProps> {
  function PromptMentionElement(props: PromptMentionElementProps) {
    const rawIndex = props["data-mention-index"];
    if (rawIndex === undefined) {
      return null;
    }
    const mention = mentions[Number(rawIndex)];
    if (mention === undefined) {
      return null;
    }
    return (
      <PromptMentionPill
        resource={mention.resource}
        resolveMentionLink={resolveMentionLink}
        serializedText={mention.serializedText}
        linkHref={resolveThreadMentionHref(mention.resource, resolveLinkHref)}
      />
    );
  }

  return PromptMentionElement;
}
