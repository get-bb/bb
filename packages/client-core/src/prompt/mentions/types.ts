import { fuzzyMatchText } from "@bb/fuzzy-match";
import {
  providerCommandSection,
  providerCommandSectionRank,
  type ProviderCommand,
  type ProviderCommandOrigin,
  type ProviderCommandSection,
  type ProviderCommandSource,
} from "@bb/server-contract";

type PromptPathMentionSource = "workspace" | "thread-storage";
type PromptPathMentionEntryKind = "file" | "directory";

export const threadMentionRelationValues = [
  "parent",
  "child",
  "same-parent",
  "same-environment",
] as const;
export type ThreadMentionRelation =
  (typeof threadMentionRelationValues)[number];

export type PromptMentionSuggestion =
  | {
      kind: "path";
      source: PromptPathMentionSource;
      entryKind: PromptPathMentionEntryKind;
      path: string;
      name: string;
      replacement: string;
    }
  | {
      kind: "thread";
      path: string;
      replacement: string;
      projectId: string;
      projectName?: string;
      threadId: string;
      title?: string;
      relation: ThreadMentionRelation | null;
    }
  | {
      kind: "project";
      path: string;
      replacement: string;
      projectId: string;
      name: string;
    }
  | {
      kind: "section";
      path: string;
      replacement: string;
      sectionId: string;
      name: string;
    }
  | {
      kind: "plugin";
      pluginId: string;
      providerId: string;
      itemId: string;
      providerLabel: string;
      title: string;
      subtitle: string | null;
      icon: string | null;
      replacement: string;
    };

export interface ProviderCommandSuggestion {
  kind: "command";
  name: string;
  source: ProviderCommandSource;
  origin: ProviderCommandOrigin;
  description: string | null;
  argumentHint: string | null;
  pluginId?: string;
}

export function toProviderCommandSuggestion(
  command: ProviderCommand,
): ProviderCommandSuggestion {
  return {
    kind: "command",
    name: command.name,
    source: command.source,
    origin: command.origin,
    description: command.description,
    argumentHint: command.argumentHint,
    ...(command.pluginId !== undefined ? { pluginId: command.pluginId } : {}),
  };
}

function matchingCommandNames(
  suggestions: readonly ProviderCommandSuggestion[],
  query: string,
): Set<ProviderCommandSuggestion> {
  return new Set(
    fuzzyMatchText({
      items: suggestions,
      query,
      getText: (suggestion) => suggestion.name,
      limit: suggestions.length,
    }).map((match) => match.item),
  );
}

export function filterCommandSuggestions(
  suggestions: readonly ProviderCommandSuggestion[],
  query: string,
): ProviderCommandSuggestion[] {
  const normalizedQuery = query.trim().toLowerCase();
  const nameMatches = matchingCommandNames(suggestions, normalizedQuery);
  return suggestions.filter(
    (suggestion) =>
      nameMatches.has(suggestion) ||
      [suggestion.description ?? "", suggestion.argumentHint ?? ""].some(
        (text) => text.toLowerCase().includes(normalizedQuery),
      ),
  );
}

function compareCommandSuggestionSections(
  left: ProviderCommandSuggestion,
  right: ProviderCommandSuggestion,
): number {
  return providerCommandSectionRank(left) - providerCommandSectionRank(right);
}

function commandSuggestionSearchNames(
  suggestion: ProviderCommandSuggestion,
): string[] {
  const name = suggestion.name.toLowerCase();
  if (suggestion.source !== "skill") {
    return [name];
  }
  const separatorIndex = name.lastIndexOf(":");
  return separatorIndex < 0 ? [name] : [name, name.slice(separatorIndex + 1)];
}

function commandSuggestionMatchRank(
  suggestion: ProviderCommandSuggestion,
  normalizedQuery: string,
  nameMatches: ReadonlySet<ProviderCommandSuggestion>,
): number {
  const canonicalName = suggestion.name.toLowerCase();
  if (canonicalName === normalizedQuery) {
    return 0;
  }
  const names = commandSuggestionSearchNames(suggestion);
  if (names.includes(normalizedQuery)) {
    return 1;
  }
  if (names.some((name) => name.startsWith(normalizedQuery))) {
    return 2;
  }
  if (names.some((name) => name.includes(normalizedQuery))) {
    return 3;
  }
  return nameMatches.has(suggestion) ? 4 : 5;
}

function compareCommandSuggestions(
  left: ProviderCommandSuggestion,
  right: ProviderCommandSuggestion,
  normalizedQuery: string,
  nameMatches: ReadonlySet<ProviderCommandSuggestion>,
): number {
  const byMatch =
    commandSuggestionMatchRank(left, normalizedQuery, nameMatches) -
    commandSuggestionMatchRank(right, normalizedQuery, nameMatches);
  return byMatch !== 0
    ? byMatch
    : compareCommandSuggestionSections(left, right);
}

export function orderCommandSuggestions(
  suggestions: readonly ProviderCommandSuggestion[],
  query: string,
): ProviderCommandSuggestion[] {
  const normalizedQuery = query.trim().toLowerCase();
  const nameMatches = matchingCommandNames(suggestions, normalizedQuery);
  const ranked = [...suggestions].sort((left, right) =>
    compareCommandSuggestions(left, right, normalizedQuery, nameMatches),
  );

  const bySection = new Map<
    ProviderCommandSection,
    ProviderCommandSuggestion[]
  >();
  for (const suggestion of ranked) {
    const section = providerCommandSection(suggestion);
    const existing = bySection.get(section);
    if (existing) {
      existing.push(suggestion);
      continue;
    }
    bySection.set(section, [suggestion]);
  }
  return [...bySection.values()].flat();
}

const COMMAND_SECTION_LABELS: Record<ProviderCommandSection, string> = {
  "agent-command": "Commands",
  skill: "Skills",
  "project-command": "Project commands",
  "user-command": "User commands",
};

export interface ProviderCommandSuggestionGroup {
  key: ProviderCommandSection;
  label: string;
  suggestions: ProviderCommandSuggestion[];
}

export function groupCommandSuggestions(
  suggestions: readonly ProviderCommandSuggestion[],
): ProviderCommandSuggestionGroup[] {
  const groups = new Map<
    ProviderCommandSection,
    ProviderCommandSuggestionGroup
  >();
  for (const suggestion of suggestions) {
    const key = providerCommandSection(suggestion);
    const group = groups.get(key);
    if (group) {
      group.suggestions.push(suggestion);
      continue;
    }
    groups.set(key, {
      key,
      label: COMMAND_SECTION_LABELS[key],
      suggestions: [suggestion],
    });
  }
  return [...groups.values()];
}
