import { fuzzyMatchText } from "@bb/fuzzy-match";
import type { PromptMentionSuggestion } from "@bb/client-core";
import { compareCodepoint } from "@bb/client-core";

type ProjectMentionSuggestion = Extract<
  PromptMentionSuggestion,
  { kind: "project" }
>;

type SectionMentionSuggestion = Extract<
  PromptMentionSuggestion,
  { kind: "section" }
>;

export interface NamedMentionCandidate {
  id: string;
  name: string;
}

interface RankNamedMentionCandidatesArgs {
  candidates: readonly NamedMentionCandidate[];
  query: string;
  limit: number;
}

interface BuildProjectMentionSuggestionsArgs {
  projects: readonly NamedMentionCandidate[];
  query: string;
  limit: number;
}

interface BuildSectionMentionSuggestionsArgs {
  sections: readonly NamedMentionCandidate[];
  query: string;
  limit: number;
}

function getNamedMentionText(candidate: NamedMentionCandidate): string {
  return candidate.name.trim() || candidate.id;
}

function rankNamedMentionCandidates({
  candidates,
  query,
  limit,
}: RankNamedMentionCandidatesArgs): NamedMentionCandidate[] {
  const trimmedQuery = query.trim();
  if (trimmedQuery.length === 0 || limit <= 0) {
    return [];
  }

  const matches = fuzzyMatchText({
    items: candidates,
    query: trimmedQuery,
    getText: getNamedMentionText,
    getAliases: (candidate) => [candidate.id],
    limit: candidates.length,
  });

  return matches
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.item.name.localeCompare(right.item.name) ||
        compareCodepoint(left.item.id, right.item.id),
    )
    .slice(0, limit)
    .map((match) => match.item);
}

export function buildProjectMentionSuggestions({
  projects,
  query,
  limit,
}: BuildProjectMentionSuggestionsArgs): ProjectMentionSuggestion[] {
  return rankNamedMentionCandidates({
    candidates: projects,
    query,
    limit,
  }).map((project) => ({
    kind: "project",
    path: `project:${project.id}`,
    replacement: `project:${project.id}`,
    projectId: project.id,
    name: getNamedMentionText(project),
  }));
}

export function buildSectionMentionSuggestions({
  sections,
  query,
  limit,
}: BuildSectionMentionSuggestionsArgs): SectionMentionSuggestion[] {
  return rankNamedMentionCandidates({
    candidates: sections,
    query,
    limit,
  }).map((section) => ({
    kind: "section",
    path: `section:${section.id}`,
    replacement: `section:${section.id}`,
    sectionId: section.id,
    name: getNamedMentionText(section),
  }));
}
