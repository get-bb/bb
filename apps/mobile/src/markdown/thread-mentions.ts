import type { InlineCode, Nodes, Parent, PhrasingContent, Text } from "mdast";
import { visit } from "unist-util-visit";
import { isRawThreadId, RAW_THREAD_ID_PATTERN_SOURCE } from "@bb/domain";
import type { BbThreadMentionNode } from "./mdast-nodes";

/**
 * Token/regex mention pipeline for generated bodies and assistant prose.
 * Headless copy of `apps/app/src/components/ui/markdown-thread-mentions.tsx`
 * (the mdast transform only; resolution of a thread id to a display resource
 * happens at render time through a lookup the host supplies).
 */

// Matches both the serialized generated-message token (`@thread:<id>`) and a
// raw persisted thread id. Raw ids deliberately use the exact db alphabet and
// suffix length so lookalike words and other entity ids remain ordinary text.
const THREAD_MENTION_PATTERN = new RegExp(
  `@thread:([A-Za-z0-9_-]+)|(${RAW_THREAD_ID_PATTERN_SOURCE})`,
  "gu",
);
const THREAD_MENTION_PREFIX = "@thread";
const THREAD_MENTION_ID_PATTERN = /^[A-Za-z0-9_-]+$/u;

function threadMentionNode(
  threadId: string,
  rawThreadId = false,
  inlineCode = false,
): BbThreadMentionNode {
  return { type: "bbThreadMention", threadId, rawThreadId, inlineCode };
}

interface PhrasingTextContext {
  offset: number;
  text: string;
}

function collectPhrasingTextContexts(
  tree: Nodes,
): WeakMap<object, PhrasingTextContext> {
  const contexts = new WeakMap<object, PhrasingTextContext>();
  visit(tree, (node) => {
    if (
      node.type !== "paragraph" &&
      node.type !== "heading" &&
      node.type !== "tableCell"
    ) {
      return;
    }

    const leaves: Array<{ node: InlineCode | Text; offset: number }> = [];
    let visibleText = "";
    visit(node, (descendant) => {
      if (descendant.type === "text" || descendant.type === "inlineCode") {
        leaves.push({ node: descendant, offset: visibleText.length });
        visibleText += descendant.value;
        return;
      }
      if (descendant.type === "image" || descendant.type === "imageReference") {
        visibleText += descendant.alt ?? "";
        return;
      }
      if (descendant.type === "break") {
        visibleText += "\n";
      }
    });
    for (const leaf of leaves) {
      contexts.set(leaf.node, { offset: leaf.offset, text: visibleText });
    }
  });
  return contexts;
}

function splitTextNodeOnMentions(
  node: Text,
  context: PhrasingTextContext | undefined,
): PhrasingContent[] {
  const { value } = node;
  THREAD_MENTION_PATTERN.lastIndex = 0;
  const replacements: PhrasingContent[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = THREAD_MENTION_PATTERN.exec(value)) !== null) {
    const serializedThreadId = match[1];
    const rawThreadId = match[2];
    const threadId = serializedThreadId ?? rawThreadId;
    const matchEnd = match.index + match[0].length;
    const boundaryText = rawThreadId === undefined ? value : context?.text;
    const boundaryStart =
      rawThreadId === undefined
        ? match.index
        : (context?.offset ?? 0) + match.index;
    const boundaryEnd = boundaryStart + match[0].length;
    if (
      threadId === undefined ||
      !(rawThreadId === undefined
        ? isMentionBoundary(value, match.index)
        : isRawThreadIdBoundary(boundaryText ?? value, boundaryStart)) ||
      !(rawThreadId === undefined
        ? isMentionEndBoundary(value, matchEnd)
        : isRawThreadIdEndBoundary(boundaryText ?? value, boundaryEnd))
    ) {
      continue;
    }
    if (match.index > cursor) {
      replacements.push({
        type: "text",
        value: value.slice(cursor, match.index),
      });
    }
    replacements.push(threadMentionNode(threadId, rawThreadId !== undefined));
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

function isUndecoratedTextDirective(directive: ParsedTextDirective): boolean {
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

function isRawThreadIdBoundary(text: string, index: number): boolean {
  const previous = text[index - 1];
  return (
    previous !== "/" && previous !== "\\" && isMentionBoundary(text, index)
  );
}

function isMentionEndBoundary(text: string, index: number): boolean {
  const next = text[index];
  if (next === undefined) return true;
  if (next === ".") {
    const afterPeriod = text[index + 1];
    return afterPeriod === undefined || /[\s,;:!?)}\]"'’”]/u.test(afterPeriod);
  }
  return !/[\p{L}\p{N}_.+\/-]/u.test(next);
}

function isRawThreadIdEndBoundary(text: string, index: number): boolean {
  return text[index] !== "\\" && isMentionEndBoundary(text, index);
}

function isDirectiveMentionEndBoundary(parent: Parent, index: number): boolean {
  const next = parent.children[index + 1];
  return next?.type !== "text" || isMentionEndBoundary(next.value, 0);
}

/**
 * Remark plugin that rewrites serialized thread mentions and raw persisted
 * thread ids into `bbThreadMention` nodes. An inline-code node is eligible
 * only when its complete value is one exact raw thread id; mixed inline code,
 * fenced code, and inline code used as an authored Markdown link label remain
 * literal. When `remark-directive` is active, its parser splits `@thread:<id>`
 * into an `@thread` text suffix plus a `:<id>` text directive; the last pass
 * rejoins that exact pair before the directive normalizer sees it.
 */
export function remarkThreadMentions() {
  return (tree: Nodes): void => {
    const authoredMarkdownLinkNodes = collectAuthoredMarkdownLinkNodes(tree);
    const phrasingTextContexts = collectPhrasingTextContexts(tree);
    visit(
      tree,
      "inlineCode",
      (node: InlineCode, index, parent: Parent | undefined) => {
        if (
          parent === undefined ||
          index === undefined ||
          authoredMarkdownLinkNodes.has(node) ||
          !isRawThreadId(node.value) ||
          !isRawThreadIdBoundary(
            phrasingTextContexts.get(node)?.text ?? node.value,
            phrasingTextContexts.get(node)?.offset ?? 0,
          ) ||
          !isRawThreadIdEndBoundary(
            phrasingTextContexts.get(node)?.text ?? node.value,
            (phrasingTextContexts.get(node)?.offset ?? 0) + node.value.length,
          )
        ) {
          return;
        }
        parent.children.splice(
          index,
          1,
          threadMentionNode(node.value, true, true),
        );
        return index + 1;
      },
    );
    visit(tree, "text", (node: Text, index, parent: Parent | undefined) => {
      if (
        parent === undefined ||
        index === undefined ||
        authoredMarkdownLinkNodes.has(node)
      ) {
        return;
      }
      const replacements = splitTextNodeOnMentions(
        node,
        phrasingTextContexts.get(node),
      );
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
      if (prefixStart < 0 || !previous.value.endsWith(THREAD_MENTION_PREFIX)) {
        return;
      }
      if (
        !isMentionBoundary(previous.value, prefixStart) ||
        !isDirectiveMentionEndBoundary(parent, index) ||
        authoredMarkdownLinkNodes.has(node)
      ) {
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
