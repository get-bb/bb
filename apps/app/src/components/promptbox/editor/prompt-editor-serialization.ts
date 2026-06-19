import { z } from "zod";
import {
  promptMentionResourceSchema,
  type PromptMentionCommandTrigger,
  type PromptMentionResource,
  type PromptTextMention,
} from "@bb/domain";
import type { JSONContent } from "@tiptap/react";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type {
  PromptMentionSuggestion,
  ProviderCommandSuggestion,
} from "@/components/promptbox/mentions/types";

export interface PromptEditorValue {
  text: string;
  mentions: PromptTextMention[];
}

interface PromptEditorContentValue {
  text: string;
  mentions: readonly PromptTextMention[];
}

export interface PromptEditorMentionAttrs {
  resource: PromptMentionResource;
  serializedText: string;
}

const promptEditorMentionAttrsSchema = z.object({
  resource: promptMentionResourceSchema,
  serializedText: z.string().min(1),
});

export function parsePromptEditorMentionAttrs(
  attrs: ProseMirrorNode["attrs"],
): PromptEditorMentionAttrs | null {
  const result = promptEditorMentionAttrsSchema.safeParse(attrs);
  return result.success ? result.data : null;
}

function splitTextContent(text: string): JSONContent[] {
  if (text.length === 0) {
    return [];
  }

  const nodes: JSONContent[] = [];
  const parts = text.split("\n");
  for (const [index, part] of parts.entries()) {
    if (index > 0) {
      nodes.push({ type: "hardBreak" });
    }
    if (part.length > 0) {
      nodes.push({ type: "text", text: part });
    }
  }
  return nodes;
}

function normalizeMentions(
  value: PromptEditorContentValue,
): PromptTextMention[] {
  return value.mentions
    .filter(
      (mention) =>
        mention.start >= 0 &&
        mention.end > mention.start &&
        mention.end <= value.text.length,
    )
    .sort((left, right) => left.start - right.start || left.end - right.end);
}

function isQuoteLine(line: string): boolean {
  return line === ">" || line.startsWith("> ");
}

function stripQuotePrefix(line: string): string {
  if (line.startsWith("> ")) return line.slice(2);
  if (line === ">") return "";
  return line;
}

/**
 * Shift mentions that fall within a global text span into a sub-value relative
 * to `spanStart`, optionally accounting for characters stripped from the front
 * of each line (the `> `/`>` quote prefix). `lineSpans` lists each source
 * line's global [start,end) plus the cumulative number of characters removed
 * before it in the stripped sub-text, so a mention's offset can be rebased onto
 * the stripped inner text.
 */
interface StrippedLineSpan {
  /** Global offset of the first content character of this line (after prefix). */
  contentStart: number;
  /** Global offset just past this line's content. */
  contentEnd: number;
  /** Offset of this line's content within the stripped sub-text. */
  innerStart: number;
}

function rebaseMentionsToSpan(
  value: PromptEditorContentValue,
  lineSpans: readonly StrippedLineSpan[],
): PromptTextMention[] {
  const rebased: PromptTextMention[] = [];
  for (const mention of value.mentions) {
    for (const span of lineSpans) {
      if (mention.start >= span.contentStart && mention.end <= span.contentEnd) {
        const delta = span.innerStart - span.contentStart;
        rebased.push({
          ...mention,
          start: mention.start + delta,
          end: mention.end + delta,
        });
        break;
      }
    }
  }
  return rebased;
}

function blockquoteFromLines(
  value: PromptEditorContentValue,
  lines: readonly string[],
  lineGlobalStarts: readonly number[],
): JSONContent {
  const strippedLines = lines.map((line) => stripQuotePrefix(line));
  const innerText = strippedLines.join("\n");

  const lineSpans: StrippedLineSpan[] = [];
  let innerCursor = 0;
  for (const [index, line] of lines.entries()) {
    const prefixLength = line.length - strippedLines[index]!.length;
    const contentStart = lineGlobalStarts[index]! + prefixLength;
    const contentEnd = lineGlobalStarts[index]! + line.length;
    lineSpans.push({
      contentStart,
      contentEnd,
      innerStart: innerCursor,
    });
    innerCursor += strippedLines[index]!.length + 1; // +1 for joining "\n"
  }

  const innerMentions = rebaseMentionsToSpan(value, lineSpans);
  return {
    type: "blockquote",
    content: [
      {
        type: "paragraph",
        content: promptEditorInlineContentFromValue({
          text: innerText,
          mentions: innerMentions,
        }),
      },
    ],
  };
}

function paragraphFromSpan(
  value: PromptEditorContentValue,
  spanStart: number,
  spanEnd: number,
): JSONContent {
  const subText = value.text.slice(spanStart, spanEnd);
  const subMentions = value.mentions.flatMap((mention) =>
    mention.start >= spanStart && mention.end <= spanEnd
      ? [
          {
            ...mention,
            start: mention.start - spanStart,
            end: mention.end - spanStart,
          },
        ]
      : [],
  );
  return {
    type: "paragraph",
    content: promptEditorInlineContentFromValue({
      text: subText,
      mentions: subMentions,
    }),
  };
}

export function promptEditorContentFromValue(
  value: PromptEditorContentValue,
): JSONContent {
  if (value.text.length === 0) {
    return {
      type: "doc",
      content: [{ type: "paragraph", content: [] }],
    };
  }

  const lines = value.text.split("\n");
  // Global start offset of each line within value.text.
  const lineGlobalStarts: number[] = [];
  let offset = 0;
  for (const line of lines) {
    lineGlobalStarts.push(offset);
    offset += line.length + 1; // +1 for the "\n" delimiter
  }

  const blocks: JSONContent[] = [];
  let index = 0;
  while (index < lines.length) {
    const quote = isQuoteLine(lines[index]!);
    let end = index;
    while (end < lines.length && isQuoteLine(lines[end]!) === quote) {
      end += 1;
    }
    const groupLines = lines.slice(index, end);
    const groupStarts = lineGlobalStarts.slice(index, end);
    if (quote) {
      blocks.push(blockquoteFromLines(value, groupLines, groupStarts));
    } else {
      const spanStart = groupStarts[0]!;
      const lastLine = groupLines[groupLines.length - 1]!;
      const spanEnd =
        groupStarts[groupStarts.length - 1]! + lastLine.length;
      blocks.push(paragraphFromSpan(value, spanStart, spanEnd));
    }
    index = end;
  }

  if (blocks.length === 0) {
    blocks.push({ type: "paragraph", content: [] });
  }

  return { type: "doc", content: blocks };
}

export function promptEditorInlineContentFromValue(
  value: PromptEditorContentValue,
): JSONContent[] {
  const content: JSONContent[] = [];
  let cursor = 0;

  for (const mention of normalizeMentions(value)) {
    if (mention.start < cursor) {
      continue;
    }
    content.push(...splitTextContent(value.text.slice(cursor, mention.start)));
    content.push({
      type: "mention",
      attrs: {
        resource: mention.resource,
        serializedText: value.text.slice(mention.start, mention.end),
      } satisfies PromptEditorMentionAttrs,
    });
    cursor = mention.end;
  }

  content.push(...splitTextContent(value.text.slice(cursor)));

  return content;
}

function mentionAttrsFromNode(
  node: ProseMirrorNode,
): PromptEditorMentionAttrs | null {
  return parsePromptEditorMentionAttrs(node.attrs);
}

/**
 * Markdown delimiters that wrap a text run carrying inline marks. `code` is
 * literal, so it never combines with emphasis. Bold wraps outside italic, e.g.
 * a run with both marks becomes `**_text_**`.
 */
function markdownDelimitersForMarks(
  marks: readonly ProseMirrorNode["marks"][number][],
): { open: string; close: string } {
  const names = new Set(marks.map((mark) => mark.type.name));
  if (names.has("code")) {
    return { open: "`", close: "`" };
  }
  let open = "";
  let close = "";
  if (names.has("bold")) {
    open = `${open}**`;
    close = `**${close}`;
  }
  if (names.has("italic")) {
    open = `${open}_`;
    close = `_${close}`;
  }
  return { open, close };
}

export function promptEditorValueFromDoc(
  doc: ProseMirrorNode,
): PromptEditorValue {
  let text = "";
  let hasSerializedBlock = false;
  const mentions: PromptTextMention[] = [];

  const appendInline = (node: ProseMirrorNode) => {
    if (node.type.name === "text") {
      const value = node.text ?? "";
      if (value.length === 0) {
        return;
      }
      const { open, close } = markdownDelimitersForMarks(node.marks);
      text += `${open}${value}${close}`;
      return;
    }
    if (node.type.name === "hardBreak") {
      text += "\n";
      return;
    }
    if (node.type.name === "mention") {
      const attrs = mentionAttrsFromNode(node);
      if (attrs) {
        const start = text.length;
        text += attrs.serializedText;
        mentions.push({
          start,
          end: text.length,
          resource: attrs.resource,
        });
      }
      return;
    }
    appendChildren(node);
  };

  // Serialize a blockquote: build its inner value via a fresh walk, then emit
  // each inner line with a "> "/">" prefix. The prefix characters count toward
  // text.length, so inner mention offsets are shifted to reflect the prefixes.
  const appendBlockquote = (node: ProseMirrorNode) => {
    const inner = promptEditorValueFromDoc(node);
    const lines = inner.text.split("\n");
    const lineGlobalStarts: number[] = [];
    let innerOffset = 0;
    for (const line of lines) {
      lineGlobalStarts.push(innerOffset);
      innerOffset += line.length + 1;
    }

    const blockStart = text.length;
    const prefixedLines = lines.map((line) =>
      line.length > 0 ? `> ${line}` : ">",
    );
    text += prefixedLines.join("\n");

    for (const innerMention of inner.mentions) {
      // Find which inner line the mention sits on, then add the cumulative
      // prefix length up to and including that line.
      let lineIndex = 0;
      for (let i = 0; i < lines.length; i += 1) {
        const lineStart = lineGlobalStarts[i]!;
        if (innerMention.start >= lineStart) {
          lineIndex = i;
        } else {
          break;
        }
      }
      const prefixDelta = prefixedLines
        .slice(0, lineIndex + 1)
        .reduce((sum, p, i) => sum + (p.length - lines[i]!.length), 0);
      mentions.push({
        ...innerMention,
        start: blockStart + innerMention.start + prefixDelta,
        end: blockStart + innerMention.end + prefixDelta,
      });
    }
  };

  // Serialize a bullet/ordered list. Each item gets an indent + marker on its
  // own line; the marker is appended to the running text before the item's
  // inline content, so mention offsets recorded during that walk are correct.
  // Nested lists recurse with deeper indentation.
  const appendListItems = (
    listNode: ProseMirrorNode,
    ordered: boolean,
    depth: number,
  ) => {
    let itemNumber =
      ordered && typeof listNode.attrs.start === "number"
        ? listNode.attrs.start
        : 1;
    for (let index = 0; index < listNode.childCount; index += 1) {
      const item = listNode.child(index);
      if (hasSerializedBlock) {
        text += "\n";
      }
      hasSerializedBlock = true;
      const indent = "  ".repeat(depth);
      const marker = ordered ? `${itemNumber}. ` : "- ";
      text += `${indent}${marker}`;
      for (let childIndex = 0; childIndex < item.childCount; childIndex += 1) {
        const block = item.child(childIndex);
        if (
          block.type.name === "bulletList" ||
          block.type.name === "orderedList"
        ) {
          appendListItems(block, block.type.name === "orderedList", depth + 1);
        } else {
          // Paragraph (or other inline block) shares the marker line.
          appendChildren(block);
        }
      }
      itemNumber += 1;
    }
  };

  const appendNode = (node: ProseMirrorNode) => {
    if (
      node.type.name === "text" ||
      node.type.name === "hardBreak" ||
      node.type.name === "mention"
    ) {
      appendInline(node);
      return;
    }

    if (node.type.name === "blockquote") {
      if (hasSerializedBlock) {
        text += "\n";
      }
      hasSerializedBlock = true;
      appendBlockquote(node);
      return;
    }

    if (node.type.name === "heading") {
      if (hasSerializedBlock) {
        text += "\n";
      }
      hasSerializedBlock = true;
      const level = typeof node.attrs.level === "number" ? node.attrs.level : 1;
      const clampedLevel = Math.min(Math.max(level, 1), 6);
      text += `${"#".repeat(clampedLevel)} `;
      appendChildren(node);
      return;
    }

    if (node.type.name === "bulletList" || node.type.name === "orderedList") {
      appendListItems(node, node.type.name === "orderedList", 0);
      return;
    }

    if (node.isBlock && node.type.name !== "doc") {
      if (hasSerializedBlock) {
        text += "\n";
      }
      hasSerializedBlock = true;
      appendChildren(node);
      return;
    }
    appendChildren(node);
  };

  const appendChildren = (node: ProseMirrorNode) => {
    for (let index = 0; index < node.childCount; index += 1) {
      appendNode(node.child(index));
    }
  };

  appendChildren(doc);

  return { text, mentions };
}

export function promptMentionResourceFromSuggestion(
  suggestion: PromptMentionSuggestion,
): PromptMentionResource {
  if (suggestion.kind === "thread") {
    return {
      kind: "thread",
      threadId: suggestion.threadId,
      projectId: suggestion.projectId,
      label: suggestion.title?.trim() || suggestion.threadId,
    };
  }

  return {
    kind: "path",
    source: suggestion.source,
    entryKind: suggestion.entryKind,
    path: suggestion.path,
    label: suggestion.name,
  };
}

interface PromptCommandResourceFromSuggestionArgs {
  suggestion: ProviderCommandSuggestion;
  trigger: PromptMentionCommandTrigger;
}

export function promptCommandResourceFromSuggestion({
  suggestion,
  trigger,
}: PromptCommandResourceFromSuggestionArgs): PromptMentionResource {
  return {
    kind: "command",
    trigger,
    name: suggestion.name,
    source: suggestion.source,
    origin: suggestion.origin,
    label: suggestion.name,
    argumentHint: suggestion.argumentHint,
  };
}
