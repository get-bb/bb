import {
  type PromptMentionCommandTrigger,
  type PromptMentionResource,
} from "@bb/domain";
import type {
  PromptMentionSuggestion,
  ProviderCommandSuggestion,
} from "@bb/client-core";

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

  if (suggestion.kind === "project") {
    return {
      kind: "project",
      projectId: suggestion.projectId,
      label: suggestion.name.trim() || suggestion.projectId,
    };
  }

  if (suggestion.kind === "section") {
    return {
      kind: "section",
      sectionId: suggestion.sectionId,
      label: suggestion.name.trim() || suggestion.sectionId,
    };
  }

  if (suggestion.kind === "plugin") {
    return {
      kind: "plugin",
      pluginId: suggestion.pluginId,
      icon: suggestion.icon,
      itemId: suggestion.itemId,
      label: suggestion.title.trim() || suggestion.itemId,
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
