import { fuzzyMatchText } from "@bb/fuzzy-match";
import type { PromptMentionSuggestion } from "@/components/promptbox/mentions/types";
import { compareCodepoint } from "@/lib/codepoint-compare";

export type ProjectMentionSuggestion = Extract<
  PromptMentionSuggestion,
  { kind: "project" }
>;

/** A project the mention menu can offer, reduced to what the picker needs. */
export interface ProjectMentionCandidate {
  id: string;
  name: string;
}

export interface BuildProjectMentionSuggestionsArgs {
  projects: readonly ProjectMentionCandidate[];
  query: string;
  limit: number;
}

function getProjectSearchTexts(
  project: ProjectMentionCandidate,
): readonly string[] {
  const name = project.name.trim();
  return name ? [name, project.id] : [project.id];
}

function toProjectMentionSuggestion(
  project: ProjectMentionCandidate,
): ProjectMentionSuggestion {
  return {
    kind: "project",
    path: `project:${project.id}`,
    replacement: `project:${project.id}`,
    projectId: project.id,
    name: project.name.trim() || project.id,
  };
}

export function buildProjectMentionSuggestions(
  args: BuildProjectMentionSuggestionsArgs,
): ProjectMentionSuggestion[] {
  const trimmedQuery = args.query.trim();
  if (trimmedQuery.length === 0 || args.limit <= 0) {
    return [];
  }

  const matches = fuzzyMatchText({
    items: args.projects,
    query: trimmedQuery,
    getText: getProjectSearchTexts,
    limit: args.projects.length,
  });

  return matches
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.item.name.localeCompare(right.item.name) ||
        compareCodepoint(left.item.id, right.item.id),
    )
    .slice(0, args.limit)
    .map((match) => toProjectMentionSuggestion(match.item));
}
