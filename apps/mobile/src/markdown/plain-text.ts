import type { Heading, Nodes, RootContent } from "mdast";
import { toString as mdastToString } from "mdast-util-to-string";
import { parseMarkdown, splitMarkdownFrontmatter } from "./parse";

/**
 * Plain-text projections of a markdown body for previews (thread list
 * snippets, notification bodies) and the table-of-contents sheet.
 */

const PLAIN_TEXT_PARSE_OPTIONS = {
  preserveSoftBreaks: false,
  threadMentions: false,
  promptMentions: false,
  directives: false,
} as const;

function blockToPlainText(node: RootContent): string {
  switch (node.type) {
    case "code":
      return node.value;
    case "image":
      return node.alt ?? "";
    case "thematicBreak":
      return "";
    case "list":
      return node.children
        .map((item, index) => {
          const marker =
            item.checked === true
              ? "[x] "
              : item.checked === false
                ? "[ ] "
                : node.ordered
                  ? `${(node.start ?? 1) + index}. `
                  : "- ";
          return `${marker}${blocksToPlainText(item.children)}`;
        })
        .join("\n");
    case "table":
      return node.children
        .map((row) =>
          row.children.map((cell) => mdastToString(cell)).join(" | "),
        )
        .join("\n");
    case "blockquote":
      return blocksToPlainText(node.children);
    case "html":
      return node.value;
    default:
      return mdastToString(node as Nodes);
  }
}

function blocksToPlainText(nodes: readonly RootContent[]): string {
  const parts: string[] = [];
  for (const node of nodes) {
    const text = blockToPlainText(node);
    if (text.length > 0) {
      parts.push(text);
    }
  }
  return parts.join("\n");
}

/**
 * Strips markdown syntax: headings/emphasis/links become their text, images
 * their alt text, lists get plain markers, code blocks keep their source.
 * Frontmatter is dropped. Block boundaries become single newlines.
 */
export function markdownToPlainText(markdown: string): string {
  if (markdown.trim().length === 0) {
    return "";
  }
  const { body } = splitMarkdownFrontmatter(markdown);
  const tree = parseMarkdown(body, PLAIN_TEXT_PARSE_OPTIONS);
  return blocksToPlainText(tree.children).trim();
}

export interface MarkdownHeading {
  /** 1–6. */
  depth: Heading["depth"];
  /** Heading text with inline markup stripped. */
  text: string;
  /** 1-based source line of the heading, when the parser recorded one. */
  line: number | null;
}

/** Headings in document order (for a table of contents). */
export function extractMarkdownHeadings(markdown: string): MarkdownHeading[] {
  if (markdown.trim().length === 0) {
    return [];
  }
  const { body, frontmatter } = splitMarkdownFrontmatter(markdown);
  const lineOffset =
    frontmatter === null
      ? 0
      : markdown.slice(0, markdown.length - body.length).split("\n").length - 1;
  const tree = parseMarkdown(body, PLAIN_TEXT_PARSE_OPTIONS);
  const headings: MarkdownHeading[] = [];
  for (const node of tree.children) {
    if (node.type !== "heading") {
      continue;
    }
    const text = mdastToString(node).trim();
    if (text.length === 0) {
      continue;
    }
    const line = node.position?.start.line;
    headings.push({
      depth: node.depth,
      text,
      line: line === undefined ? null : line + lineOffset,
    });
  }
  return headings;
}
