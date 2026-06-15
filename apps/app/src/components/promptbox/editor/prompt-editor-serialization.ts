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

export function promptEditorContentFromValue(
  value: PromptEditorContentValue,
): JSONContent {
  return {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: promptEditorInlineContentFromValue(value),
      },
    ],
  };
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

export function promptEditorValueFromDoc(
  doc: ProseMirrorNode,
): PromptEditorValue {
  let text = "";
  let hasSerializedBlock = false;
  const mentions: PromptTextMention[] = [];

  const appendNode = (node: ProseMirrorNode) => {
    if (node.type.name === "text") {
      text += node.text ?? "";
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
