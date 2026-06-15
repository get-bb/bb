import { z } from "zod";
import {
  promptMentionResourceSchema,
  type PromptMentionResource,
} from "@bb/domain";

export const PROMPT_MENTION_CLIPBOARD_RESOURCE_ATTR =
  "data-prompt-mention-resource";
export const PROMPT_MENTION_CLIPBOARD_SERIALIZED_TEXT_ATTR =
  "data-prompt-mention-serialized-text";

export interface PromptMentionClipboardPayload {
  resource: PromptMentionResource;
  serializedText: string;
}

export interface PromptMentionClipboardDataAttributes {
  "data-prompt-mention": "true";
  "data-prompt-mention-resource": string;
  "data-prompt-mention-serialized-text": string;
}

interface PromptMentionClipboardDataAttributesArgs {
  resource: PromptMentionResource;
  serializedText: string;
}

interface ParsePromptMentionClipboardElementArgs {
  element: Element;
}

const promptMentionClipboardResourcePayloadSchema = z.object({
  resource: promptMentionResourceSchema,
});

function parseJsonAttribute(value: string): unknown | null {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export function promptMentionClipboardDataAttributes(
  args: PromptMentionClipboardDataAttributesArgs,
): PromptMentionClipboardDataAttributes {
  return {
    "data-prompt-mention": "true",
    [PROMPT_MENTION_CLIPBOARD_RESOURCE_ATTR]: JSON.stringify(args.resource),
    [PROMPT_MENTION_CLIPBOARD_SERIALIZED_TEXT_ATTR]: args.serializedText,
  };
}

export function serializedTextForPromptMentionResource(
  resource: PromptMentionResource,
): string {
  if (resource.kind === "thread") {
    return `@thread:${resource.threadId}`;
  }
  if (resource.kind === "command") {
    return `${resource.trigger}${resource.name}`;
  }

  const sourceQualifiedPath =
    resource.source === "thread-storage"
      ? `thread-storage:${resource.path}`
      : resource.path;
  const directorySuffix =
    resource.entryKind === "directory" && !sourceQualifiedPath.endsWith("/")
      ? "/"
      : "";
  return `@${sourceQualifiedPath}${directorySuffix}`;
}

export function parsePromptMentionClipboardElement({
  element,
}: ParsePromptMentionClipboardElementArgs): PromptMentionClipboardPayload | null {
  if (element.getAttribute("data-prompt-mention") !== "true") {
    return null;
  }

  const serializedText = element.getAttribute(
    PROMPT_MENTION_CLIPBOARD_SERIALIZED_TEXT_ATTR,
  );
  const resourceJson = element.getAttribute(
    PROMPT_MENTION_CLIPBOARD_RESOURCE_ATTR,
  );
  if (!serializedText || !resourceJson) {
    return null;
  }

  const parsedResource = parseJsonAttribute(resourceJson);
  const result = promptMentionClipboardResourcePayloadSchema.safeParse({
    resource: parsedResource,
  });
  if (!result.success) {
    return null;
  }

  return {
    resource: result.data.resource,
    serializedText: serializedTextForPromptMentionResource(
      result.data.resource,
    ),
  };
}
