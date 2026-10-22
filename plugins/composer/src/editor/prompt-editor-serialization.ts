import * as z from "zod/mini";
import type { ComposerMention } from "@get-bb/plugin-sdk/app";
import type { JSONContent } from "@tiptap/react";
import {
  Fragment,
  Slice,
  type Node as ProseMirrorNode,
  type Schema,
} from "@tiptap/pm/model";
import type { Selection } from "@tiptap/pm/state";
import {
  compareMentions,
  mentionInRange,
  mentionTarget,
  mentionTargetSchema,
  shiftMention,
  type MentionTarget,
} from "./composer-mentions";

export interface PromptEditorValue {
  text: string;
  mentions: ComposerMention[];
}

export interface PromptEditorOffsetSegment {
  textFrom: number;
  textTo: number;
  docFrom: number;
  docTo: number;
  kind: "text" | "mention";
}

interface PromptEditorSerialization extends PromptEditorValue {
  offsetMapping: PromptEditorOffsetSegment[];
}

interface PromptEditorContentValue {
  text: string;
  mentions: readonly ComposerMention[];
}

export interface PromptEditorMentionAttrs {
  mention: MentionTarget;
  serializedText: string;
}

const promptEditorMentionAttrsSchema = z.object({
  mention: mentionTargetSchema,
  serializedText: z.string().check(z.minLength(1)),
});

const parsedMentionAttrs = new WeakMap<
  ProseMirrorNode["attrs"],
  PromptEditorMentionAttrs | null
>();

export function parsePromptEditorMentionAttrs(
  attrs: ProseMirrorNode["attrs"],
): PromptEditorMentionAttrs | null {
  const cached = parsedMentionAttrs.get(attrs);
  if (cached !== undefined) return cached;
  const result = promptEditorMentionAttrsSchema.safeParse(attrs);
  const parsed = result.success ? result.data : null;
  parsedMentionAttrs.set(attrs, parsed);
  return parsed;
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

function normalizeMentions(value: PromptEditorContentValue): ComposerMention[] {
  return value.mentions
    .filter(
      (mention) =>
        mention.from >= 0 &&
        mention.to > mention.from &&
        mention.to <= value.text.length,
    )
    .sort(compareMentions);
}

function isQuoteLine(line: string): boolean {
  return line === ">" || line.startsWith("> ");
}

function isBlankLine(line: string): boolean {
  return line.length === 0;
}

function stripQuotePrefix(line: string): string {
  if (line.startsWith("> ")) return line.slice(2);
  if (line === ">") return "";
  return line;
}

interface StrippedLineSpan {
  contentStart: number;
  contentEnd: number;
  innerStart: number;
}

function rebaseMentionsToSpan(
  value: PromptEditorContentValue,
  lineSpans: readonly StrippedLineSpan[],
): ComposerMention[] {
  const rebased: ComposerMention[] = [];
  for (const mention of value.mentions) {
    for (const span of lineSpans) {
      if (mention.from >= span.contentStart && mention.to <= span.contentEnd) {
        rebased.push(
          shiftMention(mention, span.innerStart - span.contentStart),
        );
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
    innerCursor += strippedLines[index]!.length + 1;
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
  return {
    type: "paragraph",
    content: promptEditorInlineContentFromSourceSpan({
      sourceEnd: spanEnd,
      sourceStart: spanStart,
      value,
    }),
  };
}

function promptEditorContentValueFromSourceSpan({
  sourceEnd,
  sourceStart,
  value,
}: {
  sourceEnd: number;
  sourceStart: number;
  value: PromptEditorContentValue;
}): PromptEditorContentValue {
  const subText = value.text.slice(sourceStart, sourceEnd);
  const subMentions = value.mentions.flatMap((mention) =>
    mention.from >= sourceStart && mention.to <= sourceEnd
      ? [shiftMention(mention, -sourceStart)]
      : [],
  );
  return { text: subText, mentions: subMentions };
}

function promptEditorInlineContentFromSourceSpan({
  sourceEnd,
  sourceStart,
  value,
}: {
  sourceEnd: number;
  sourceStart: number;
  value: PromptEditorContentValue;
}): JSONContent[] {
  return promptEditorInlineContentFromValue(
    promptEditorContentValueFromSourceSpan({
      sourceEnd,
      sourceStart,
      value,
    }),
  );
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
  const lineGlobalStarts: number[] = [];
  let offset = 0;
  for (const line of lines) {
    lineGlobalStarts.push(offset);
    offset += line.length + 1;
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
      if (
        isBlankLine(lines[end] ?? "") &&
        end + 1 < lines.length &&
        !isQuoteLine(lines[end + 1]!)
      ) {
        end += 1;
      }
    } else {
      const spanStart = groupStarts[0]!;
      const lastLine = groupLines[groupLines.length - 1]!;
      const spanEnd = groupStarts[groupStarts.length - 1]! + lastLine.length;
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
    if (mention.from < cursor) {
      continue;
    }
    content.push(...splitTextContent(value.text.slice(cursor, mention.from)));
    content.push({
      type: "mention",
      attrs: {
        mention: mentionTarget(mention),
        serializedText: value.text.slice(mention.from, mention.to),
      } satisfies PromptEditorMentionAttrs,
    });
    cursor = mention.to;
  }

  content.push(...splitTextContent(value.text.slice(cursor)));

  return content;
}

function serializePromptEditorNode(
  doc: ProseMirrorNode,
  rootPosition: number,
): PromptEditorSerialization {
  let text = "";
  let previousSerializedBlockWasBlockquote: boolean | null = null;
  const mentions: ComposerMention[] = [];
  const offsetMapping: PromptEditorOffsetSegment[] = [];

  const appendInlineText = (
    value: string,
    docFrom: number,
    docTo: number,
    kind: PromptEditorOffsetSegment["kind"],
  ): { end: number; start: number } => {
    const start = text.length;
    text += value;
    offsetMapping.push({
      textFrom: start,
      textTo: text.length,
      docFrom,
      docTo,
      kind,
    });
    return { start, end: text.length };
  };

  const appendBlockBoundary = (blockIsBlockquote: boolean) => {
    if (previousSerializedBlockWasBlockquote !== null) {
      text +=
        previousSerializedBlockWasBlockquote && !blockIsBlockquote
          ? "\n\n"
          : "\n";
    }
    previousSerializedBlockWasBlockquote = blockIsBlockquote;
  };

  const appendInline = (node: ProseMirrorNode, nodePosition: number) => {
    if (node.type.name === "text") {
      const value = node.text ?? "";
      if (value.length === 0) {
        return;
      }
      appendInlineText(
        value,
        nodePosition,
        nodePosition + node.nodeSize,
        "text",
      );
      return;
    }
    if (node.type.name === "hardBreak") {
      text += "\n";
      return;
    }
    if (node.type.name === "mention") {
      const attrs = parsePromptEditorMentionAttrs(node.attrs);
      if (attrs) {
        const span = appendInlineText(
          attrs.serializedText,
          nodePosition,
          nodePosition + node.nodeSize,
          "mention",
        );
        mentions.push(mentionInRange(attrs.mention, span.start, span.end));
      }
      return;
    }
    appendChildren(node, nodePosition);
  };

  const appendBlockquote = (node: ProseMirrorNode, nodePosition: number) => {
    const inner = serializePromptEditorNode(node, nodePosition);
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

    const prefixedOffset = (offset: number): number => {
      let lineIndex = lines.length - 1;
      for (let index = 0; index < lines.length; index += 1) {
        if (offset <= lineGlobalStarts[index]! + lines[index]!.length) {
          lineIndex = index;
          break;
        }
      }
      const prefixDelta = prefixedLines
        .slice(0, lineIndex + 1)
        .reduce(
          (sum, prefixedLine, index) =>
            sum + (prefixedLine.length - lines[index]!.length),
          0,
        );
      return offset + prefixDelta;
    };

    for (const segment of inner.offsetMapping) {
      offsetMapping.push({
        ...segment,
        textFrom: blockStart + prefixedOffset(segment.textFrom),
        textTo: blockStart + prefixedOffset(segment.textTo),
      });
    }

    for (const innerMention of inner.mentions) {
      mentions.push({
        ...innerMention,
        from: blockStart + prefixedOffset(innerMention.from),
        to: blockStart + prefixedOffset(innerMention.to),
      });
    }
  };

  const appendNode = (node: ProseMirrorNode, nodePosition: number) => {
    if (
      node.type.name === "text" ||
      node.type.name === "hardBreak" ||
      node.type.name === "mention"
    ) {
      appendInline(node, nodePosition);
      return;
    }

    if (node.type.name === "blockquote") {
      appendBlockBoundary(true);
      appendBlockquote(node, nodePosition);
      return;
    }

    if (node.isBlock && node.type.name !== "doc") {
      appendBlockBoundary(false);
      appendChildren(node, nodePosition);
      return;
    }
    appendChildren(node, nodePosition);
  };

  const appendChildren = (node: ProseMirrorNode, nodePosition: number) => {
    let childPosition =
      node.type.name === "doc" ? nodePosition : nodePosition + 1;
    for (let index = 0; index < node.childCount; index += 1) {
      const child = node.child(index);
      appendNode(child, childPosition);
      childPosition += child.nodeSize;
    }
  };

  appendChildren(doc, rootPosition);

  return { text, mentions, offsetMapping };
}

export function promptEditorSerializationFromDoc(
  doc: ProseMirrorNode,
): PromptEditorSerialization {
  return serializePromptEditorNode(doc, 0);
}

export function promptEditorValueFromDoc(
  doc: ProseMirrorNode,
): PromptEditorValue {
  const { text, mentions } = promptEditorSerializationFromDoc(doc);
  return { text, mentions };
}

export function promptEditorValueFromSlice(
  slice: Slice,
  schema: Schema,
): PromptEditorValue {
  const doc = schema.topNodeType.createAndFill(null, slice.content);
  if (doc) {
    return promptEditorValueFromDoc(doc);
  }

  return {
    text: slice.content.textBetween(0, slice.content.size, "\n"),
    mentions: [],
  };
}

function selectionCoversWholeLines({ $from, $to }: Selection): boolean {
  const startsLine =
    $from.parentOffset === 0 || $from.nodeBefore?.type.name === "hardBreak";
  const endsLine =
    $to.parentOffset === $to.parent.content.size ||
    $to.nodeAfter?.type.name === "hardBreak";
  return startsLine && endsLine;
}

export function promptEditorCopiedSlice(
  slice: Slice,
  selection: Selection,
): Slice {
  if (selectionCoversWholeLines(selection)) {
    return slice;
  }

  const schema = selection.$from.doc.type.schema;
  let { content, openStart, openEnd } = slice;
  let result = slice;
  while (openStart > 0 && openEnd > 0 && content.childCount === 1) {
    const ancestor = content.firstChild!;
    if (ancestor.isTextblock) {
      return new Slice(
        Fragment.from(schema.nodes.paragraph!.create(null, ancestor.content)),
        1,
        1,
      );
    }
    content = ancestor.content;
    openStart -= 1;
    openEnd -= 1;
    if (schema.topNodeType.validContent(content)) {
      result = new Slice(content, openStart, openEnd);
    }
  }
  return result;
}

export function promptEditorClipboardTextFromSlice(
  slice: Slice,
  schema: Schema,
): string {
  return promptEditorValueFromSlice(slice, schema).text;
}
