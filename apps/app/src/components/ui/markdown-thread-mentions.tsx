import type { ComponentType } from "react";
import type { Nodes, Parent, PhrasingContent, Text } from "mdast";
// Side-effect import: augments mdast's `Data` with `hName`/`hProperties` so a
// plain `text` node can carry the custom element instructions below.
import type {} from "mdast-util-to-hast";
import { visit } from "unist-util-visit";
import type { PromptTextMention } from "@bb/domain";
import type { TimelineTitleLink } from "@bb/thread-view";
import {
  PromptMentionPill,
  resolveThreadMentionResource,
} from "@/components/thread/timeline/ConversationMessageMentions.js";
import { useThreadMentionResource } from "@/components/thread/ThreadTitleMentions.js";
import type { TimelineTitleLinkResolver } from "@/components/thread/timeline/TimelineTitleView.js";

// Literal token the generated-message body uses to reference a thread:
// `@thread:<id>`. The id is the trailing run of id-safe characters.
const THREAD_MENTION_PATTERN = /@thread:([A-Za-z0-9_-]+)/gu;
const THREAD_MENTION_PREFIX = "@thread";
const THREAD_MENTION_ID_PATTERN = /^[A-Za-z0-9_-]+$/u;

// Custom hast element the remark plugin emits for each token; mapped back to a
// React pill via the `components` entry below. Lowercase + hyphenated so it is a
// valid custom-element tag name in the hast tree.
const THREAD_MENTION_HAST_NAME = "bb-thread-mention";
// hast property key — `mdast-util-to-hast` lowercases it into the
// `data-thread-id` DOM attribute that the component reads back.
const THREAD_MENTION_THREAD_ID_PROPERTY = "dataThreadId";

// Builds a real mdast `text` node that, via `data.hName`, renders as the custom
// element rather than its (empty) text value. `mdast-util-to-hast` honours
// `data.hName`/`data.hProperties` for any node.
function threadMentionNode(threadId: string): Text {
  return {
    type: "text",
    value: "",
    data: {
      hName: THREAD_MENTION_HAST_NAME,
      hProperties: { [THREAD_MENTION_THREAD_ID_PROPERTY]: threadId },
    },
  };
}

// Splits a text node on the `@thread:<id>` token, returning the original node
// when no token is present so untouched text stays a plain text node.
function splitTextNodeOnMentions(node: Text): PhrasingContent[] {
  const { value } = node;
  THREAD_MENTION_PATTERN.lastIndex = 0;
  const replacements: PhrasingContent[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = THREAD_MENTION_PATTERN.exec(value)) !== null) {
    const threadId = match[1];
    if (threadId === undefined) {
      continue;
    }
    if (match.index > cursor) {
      replacements.push({
        type: "text",
        value: value.slice(cursor, match.index),
      });
    }
    replacements.push(threadMentionNode(threadId));
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

interface ParsedTextDirective {
  attributes: unknown;
  children: unknown;
  name: string;
  type: "textDirective";
}

function parseTextDirective(node: unknown): ParsedTextDirective | null {
  if (typeof node !== "object" || node === null) {
    return null;
  }
  const candidate = node as {
    attributes?: unknown;
    children?: unknown;
    name?: unknown;
    type?: unknown;
  };
  return candidate.type === "textDirective" &&
    typeof candidate.name === "string"
    ? {
        type: candidate.type,
        name: candidate.name,
        attributes: candidate.attributes,
        children: candidate.children,
      }
    : null;
}

function isUndecoratedTextDirective(
  directive: ParsedTextDirective,
): boolean {
  return (
    Array.isArray(directive.children) &&
    directive.children.length === 0 &&
    typeof directive.attributes === "object" &&
    directive.attributes !== null &&
    !Array.isArray(directive.attributes) &&
    Object.keys(directive.attributes).length === 0
  );
}

function collectAuthoredMarkdownLinkNodes(tree: Nodes): WeakSet<object> {
  const linkNodes = new WeakSet<object>();
  visit(tree, (node) => {
    if (node.type !== "link" && node.type !== "linkReference") {
      return;
    }
    visit(node, (descendant) => {
      linkNodes.add(descendant);
    });
  });
  return linkNodes;
}

function isMentionBoundary(text: string, index: number): boolean {
  const previous = text[index - 1];
  return previous === undefined || !/[\p{L}\p{N}_.+-]/u.test(previous);
}

/**
 * Remark plugin that rewrites the literal `@thread:<id>` token inside text
 * nodes into custom inline nodes the `components` map renders as the canonical
 * thread-mention pill. When `remark-directive` is active, its parser splits the
 * same source into an `@thread` text suffix plus a `:<id>` text directive; the
 * second pass rejoins that exact pair before the directive renderer sees it.
 * No-op for bodies without the token.
 */
export function remarkThreadMentions() {
  return (tree: Nodes): void => {
    const authoredMarkdownLinkNodes = collectAuthoredMarkdownLinkNodes(tree);
    visit(tree, "text", (node: Text, index, parent: Parent | undefined) => {
      if (
        parent === undefined ||
        index === undefined ||
        authoredMarkdownLinkNodes.has(node)
      ) {
        return;
      }
      const replacements = splitTextNodeOnMentions(node);
      if (replacements.length === 1 && replacements[0] === node) {
        return;
      }
      parent.children.splice(index, 1, ...replacements);
      return index + replacements.length;
    });
    visit(tree, (node, index, parent: Parent | undefined) => {
      const directive = parseTextDirective(node);
      if (
        directive === null ||
        index === undefined ||
        index === 0 ||
        parent === undefined ||
        !isUndecoratedTextDirective(directive) ||
        !THREAD_MENTION_ID_PATTERN.test(directive.name)
      ) {
        return;
      }
      const previous = parent.children[index - 1];
      if (previous?.type !== "text") {
        return;
      }
      const prefixStart = previous.value.length - THREAD_MENTION_PREFIX.length;
      if (
        prefixStart < 0 ||
        !previous.value.endsWith(THREAD_MENTION_PREFIX) ||
        !isMentionBoundary(previous.value, prefixStart)
      ) {
        return;
      }
      if (authoredMarkdownLinkNodes.has(node)) {
        const leadingText = previous.value.slice(0, prefixStart);
        const mentionText: Text = {
          type: "text",
          value: `${THREAD_MENTION_PREFIX}:${directive.name}`,
        };
        if (leadingText.length === 0) {
          parent.children.splice(index - 1, 2, mentionText);
          return index;
        }
        previous.value = leadingText;
        parent.children.splice(index, 1, mentionText);
        return index + 1;
      }
      previous.value = previous.value.slice(0, prefixStart);
      parent.children.splice(index, 1, threadMentionNode(directive.name));
      return index + 1;
    });
  };
}

interface BuildThreadMentionComponentArgs {
  mentions: readonly PromptTextMention[];
  resolveSegmentLinkHref?: TimelineTitleLinkResolver;
}

interface ThreadMentionElementProps {
  "data-thread-id"?: string;
}

// `react-markdown`'s `Components` map is keyed by `JSX.IntrinsicElements`, so
// the custom element the remark plugin emits must be declared there for the
// `components` entry to type-check. It is render-only (never authored as JSX).
declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "bb-thread-mention": ThreadMentionElementProps;
    }
  }
}

function resolveThreadMentionHref(
  threadId: string,
  resolveSegmentLinkHref: TimelineTitleLinkResolver | undefined,
): string | undefined {
  if (!resolveSegmentLinkHref) {
    return undefined;
  }
  const link: TimelineTitleLink = { kind: "thread", threadId };
  return resolveSegmentLinkHref(link) ?? undefined;
}

/**
 * The `components` renderer for thread mentions, keyed (by the caller) on the
 * custom hast element the remark plugin emits. Resolves the mention's display
 * resource from the body `mentions` array and routes the link through
 * `resolveSegmentLinkHref`, reusing the canonical `PromptMentionPill`.
 */
export function buildThreadMentionComponent({
  mentions,
  resolveSegmentLinkHref,
}: BuildThreadMentionComponentArgs): ComponentType<ThreadMentionElementProps> {
  function ThreadMentionElement(props: ThreadMentionElementProps) {
    const threadId = props["data-thread-id"] ?? "";
    const liveResource = useThreadMentionResource(threadId);
    if (threadId.length === 0) {
      return null;
    }
    const resource =
      liveResource ?? resolveThreadMentionResource(mentions, threadId);
    return (
      <PromptMentionPill
        resource={resource}
        serializedText={`@thread:${threadId}`}
        linkHref={resolveThreadMentionHref(threadId, resolveSegmentLinkHref)}
      />
    );
  }

  return ThreadMentionElement;
}
