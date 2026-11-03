import type { ComposerMentionTargetShape } from "./composer-mention.js";
import type { OrderedMentionSuggestions } from "./mention-candidates.js";
import type {
  PromptMentionSuggestion,
  ThreadMentionRelation,
} from "./types.js";

type TargetOf<Kind extends ComposerMentionTargetShape["kind"]> = Extract<
  ComposerMentionTargetShape,
  { kind: Kind }
>;

export type ComposerMentionSuggestionShape = { key: string; text: string } & (
  | { kind: "path"; mention: TargetOf<"path"> }
  | {
      kind: "thread";
      mention: TargetOf<"thread"> & { projectId: string };
      title: string | null;
      projectName: string | null;
      relation: ThreadMentionRelation | null;
    }
  | { kind: "project"; mention: TargetOf<"project"> }
  | { kind: "section"; mention: TargetOf<"section"> }
  | {
      kind: "plugin";
      mention: TargetOf<"plugin">;
      providerLabel: string;
      subtitle: string | null;
    }
);

export interface ComposerMentionSuggestionGroupShape {
  key: string;
  label: string;
  suggestions: readonly ComposerMentionSuggestionShape[];
}

export function promptMentionSuggestionKey(
  suggestion: PromptMentionSuggestion,
): string {
  switch (suggestion.kind) {
    case "path":
      return JSON.stringify([
        suggestion.kind,
        suggestion.source,
        suggestion.entryKind,
        suggestion.path,
      ]);
    case "plugin":
      return JSON.stringify([
        suggestion.kind,
        suggestion.pluginId,
        suggestion.providerId,
        suggestion.itemId,
      ]);
    case "thread":
      return JSON.stringify([suggestion.kind, suggestion.threadId]);
    case "project":
      return JSON.stringify([suggestion.kind, suggestion.projectId]);
    case "section":
      return JSON.stringify([suggestion.kind, suggestion.sectionId]);
  }
}

export function composerMentionSuggestionFromPrompt(
  suggestion: PromptMentionSuggestion,
): ComposerMentionSuggestionShape {
  const key = promptMentionSuggestionKey(suggestion);
  const text = suggestion.replacement;
  switch (suggestion.kind) {
    case "path":
      return {
        kind: "path",
        key,
        text,
        mention: {
          kind: "path",
          source: suggestion.source,
          entryKind: suggestion.entryKind,
          path: suggestion.path,
          label: suggestion.name,
        },
      };
    case "thread":
      return {
        kind: "thread",
        key,
        text,
        mention: {
          kind: "thread",
          threadId: suggestion.threadId,
          projectId: suggestion.projectId,
          label: suggestion.title?.trim() || suggestion.threadId,
        },
        title: suggestion.title || null,
        projectName: suggestion.projectName ?? null,
        relation: suggestion.relation,
      };
    case "project":
      return {
        kind: "project",
        key,
        text,
        mention: {
          kind: "project",
          projectId: suggestion.projectId,
          label: suggestion.name.trim() || suggestion.projectId,
        },
      };
    case "section":
      return {
        kind: "section",
        key,
        text,
        mention: {
          kind: "section",
          sectionId: suggestion.sectionId,
          label: suggestion.name.trim() || suggestion.sectionId,
        },
      };
    case "plugin": {
      const separator = suggestion.itemId.indexOf(":");
      return {
        kind: "plugin",
        key,
        text,
        mention: {
          kind: "plugin",
          pluginId: suggestion.pluginId,
          provider: suggestion.providerId,
          id:
            separator === -1
              ? suggestion.itemId
              : suggestion.itemId.slice(separator + 1),
          label: suggestion.title.trim() || suggestion.itemId,
          icon: suggestion.icon,
        },
        providerLabel: suggestion.providerLabel,
        subtitle: suggestion.subtitle,
      };
    }
  }
}

export function composerMentionGroupsFromOrdered(
  results: OrderedMentionSuggestions,
): ComposerMentionSuggestionGroupShape[] {
  return results.groups.map((group) => ({
    key: group.key,
    label: group.label,
    suggestions: group.suggestions.map(composerMentionSuggestionFromPrompt),
  }));
}
