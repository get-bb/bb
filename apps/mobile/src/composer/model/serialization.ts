import {
  appendQuoteToDraftText,
  promptDraftToInput,
  promptInputToDraft,
  type PromptDraftAttachment,
  type PromptDraftState,
  type PromptMentionSuggestion,
  type ProviderCommandSuggestion,
} from "@bb/client-core";
import type {
  PromptInput,
  PromptMentionCommandTrigger,
  PromptMentionResource,
  PromptTextMention,
} from "@bb/domain";
import {
  createComposerValue,
  type ComposerMention,
  type ComposerValue,
} from "./document";

/**
 * The web composer's value contract (`apps/app/.../prompt-editor-serialization.ts`):
 * serialized text with mention ranges over it. Drafts are persisted in this
 * shape and `PromptInput` is derived from it, so both clients read alike.
 */
export interface PromptEditorValue {
  text: string;
  mentions: PromptTextMention[];
}

function normalizeTextMentions(
  mentions: readonly PromptTextMention[],
  textLength: number,
): PromptTextMention[] {
  const sorted = [...mentions]
    .filter(
      (mention) =>
        mention.start >= 0 &&
        mention.end > mention.start &&
        mention.end <= textLength,
    )
    .sort((left, right) => left.start - right.start || left.end - right.end);
  const result: PromptTextMention[] = [];
  let cursor = 0;
  for (const mention of sorted) {
    if (mention.start < cursor) continue;
    result.push(mention);
    cursor = mention.end;
  }
  return result;
}

/**
 * What a pill shows in the input: the trigger char the web serialized it
 * with, then the resource label (`@My thread`, `@foo.ts`, `/review`,
 * `#Task 12`). Falls back to the serialized text for an empty label.
 */
export function mentionDisplayText(
  resource: PromptMentionResource,
  serializedText: string,
): string {
  const label = resource.label.trim();
  if (label.length === 0) return serializedText;
  const trigger = serializedText.charAt(0);
  if (resource.kind === "command") {
    return `${resource.trigger}${label}`;
  }
  return trigger.length > 0 && !/[\p{L}\p{N}]/u.test(trigger)
    ? `${trigger}${label}`
    : label;
}

/** Replace every pill's display text with its serialized text. */
export function composerValueToPromptEditorValue(
  value: ComposerValue,
): PromptEditorValue {
  let text = "";
  let cursor = 0;
  const mentions: PromptTextMention[] = [];
  for (const mention of value.mentions) {
    text += value.text.slice(cursor, mention.start);
    const start = text.length;
    text += mention.serializedText;
    mentions.push({ start, end: text.length, resource: mention.resource });
    cursor = mention.end;
  }
  text += value.text.slice(cursor);
  return { text, mentions };
}

/** Inverse of `composerValueToPromptEditorValue`. */
export function composerValueFromPromptEditorValue(
  value: PromptEditorValue,
): ComposerValue {
  const sourceMentions = normalizeTextMentions(
    value.mentions,
    value.text.length,
  );
  let text = "";
  let cursor = 0;
  const mentions: ComposerMention[] = [];
  for (const mention of sourceMentions) {
    text += value.text.slice(cursor, mention.start);
    const serializedText = value.text.slice(mention.start, mention.end);
    const displayText = mentionDisplayText(mention.resource, serializedText);
    const start = text.length;
    text += displayText;
    mentions.push({
      start,
      end: text.length,
      resource: mention.resource,
      serializedText,
    });
    cursor = mention.end;
  }
  text += value.text.slice(cursor);
  return createComposerValue(text, mentions);
}

/** The client-core draft shape (serialized text + attachments). */
export function composerValueToDraftState(
  value: ComposerValue,
  attachments: readonly PromptDraftAttachment[],
): PromptDraftState {
  const editorValue = composerValueToPromptEditorValue(value);
  return {
    text: editorValue.text,
    mentions: editorValue.mentions,
    attachments: [...attachments],
  };
}

export function composerValueFromDraftState(draft: PromptDraftState): {
  value: ComposerValue;
  attachments: PromptDraftAttachment[];
} {
  return {
    value: composerValueFromPromptEditorValue({
      text: draft.text,
      mentions: draft.mentions,
    }),
    attachments: [...draft.attachments],
  };
}

/**
 * The `PromptInput[]` the server receives: identical to what the web
 * composer sends for the same draft (trimmed text, visible mention ranges,
 * automation prompt expansion, then one part per attachment).
 */
export function composerValueToPromptInput(
  value: ComposerValue,
  attachments: readonly PromptDraftAttachment[] = [],
): PromptInput[] {
  return promptDraftToInput(composerValueToDraftState(value, attachments));
}

/** Seed a composer from a submitted prompt (fork, handoff, edit). */
export function composerValueFromPromptInput(input: readonly PromptInput[]): {
  value: ComposerValue;
  attachments: PromptDraftAttachment[];
} {
  return composerValueFromDraftState(promptInputToDraft(input));
}

/**
 * Append a quoted selection as a `> ` block. Appending at the end keeps
 * every pill offset unchanged, so the display text is quoted directly.
 */
export function appendQuoteToComposerValue(
  value: ComposerValue,
  quotedText: string,
): ComposerValue {
  const quoted = appendQuoteToDraftText(
    { text: value.text, mentions: [], attachments: [] },
    quotedText,
  );
  if (quoted.text === value.text) return value;
  return { text: quoted.text, mentions: value.mentions };
}

export interface MentionInsertion {
  resource: PromptMentionResource;
  serializedText: string;
  displayText: string;
}

/**
 * Resource + serialized text for a picked `@`-style suggestion, as the web's
 * `applyMentionSuggestion` inserts it: the replacement prefixed with the
 * trigger char unless it already starts with it.
 */
export function mentionInsertionFromSuggestion(
  suggestion: PromptMentionSuggestion,
  triggerChar: string,
): MentionInsertion {
  const replacement = suggestion.replacement.trim();
  const serializedText = replacement.startsWith(triggerChar)
    ? replacement
    : `${triggerChar}${replacement}`;
  const resource = promptMentionResourceFromSuggestion(suggestion);
  return {
    resource,
    serializedText,
    displayText: mentionDisplayText(resource, serializedText),
  };
}

/** Resource + serialized text (`/name`) for a picked slash command. */
export function commandInsertionFromSuggestion(
  suggestion: ProviderCommandSuggestion,
  trigger: PromptMentionCommandTrigger,
): MentionInsertion {
  const resource: PromptMentionResource = {
    kind: "command",
    trigger,
    name: suggestion.name,
    source: suggestion.source,
    origin: suggestion.origin,
    label: suggestion.name,
    argumentHint: suggestion.argumentHint,
  };
  const serializedText = `${trigger}${suggestion.name}`;
  return {
    resource,
    serializedText,
    displayText: mentionDisplayText(resource, serializedText),
  };
}

/** Port of the web's `promptMentionResourceFromSuggestion`. */
function promptMentionResourceFromSuggestion(
  suggestion: PromptMentionSuggestion,
): PromptMentionResource {
  switch (suggestion.kind) {
    case "thread":
      return {
        kind: "thread",
        threadId: suggestion.threadId,
        projectId: suggestion.projectId,
        label: suggestion.title?.trim() || suggestion.threadId,
      };
    case "project":
      return {
        kind: "project",
        projectId: suggestion.projectId,
        label: suggestion.name.trim() || suggestion.projectId,
      };
    case "section":
      return {
        kind: "section",
        sectionId: suggestion.sectionId,
        label: suggestion.name.trim() || suggestion.sectionId,
      };
    case "plugin":
      return {
        kind: "plugin",
        pluginId: suggestion.pluginId,
        icon: suggestion.icon,
        itemId: suggestion.itemId,
        label: suggestion.title.trim() || suggestion.itemId,
      };
    case "path":
      return {
        kind: "path",
        source: suggestion.source,
        entryKind: suggestion.entryKind,
        path: suggestion.path,
        label: suggestion.name,
      };
  }
}
