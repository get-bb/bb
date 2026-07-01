import { useMemo, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { SidebarBootstrapResponse } from "@bb/server-contract";
import { buildPathMentionSuggestions } from "./pathMentionSuggestions";
import {
  buildProjectMentionSuggestions,
  type ProjectMentionCandidate,
} from "./projectMentionSuggestions";
import { useSidebarNavigation } from "./queries/sidebar-navigation-query";
import { useThreadMentionCandidates } from "./queries/thread-queries";
import { buildThreadMentionSuggestions } from "./threadMentionSuggestions";
import { usePathSuggestions } from "./usePathSuggestions";
import type { PromptMentionSuggestion } from "@/components/promptbox/mentions/types";

const PROMPT_MENTION_SOURCE_LIMIT = 8;

export interface UsePromptMentionsOptions {
  currentThreadId?: string;
  environmentId: string | null;
}

export interface UsePromptMentionsResult {
  query: string | null;
  setQuery: Dispatch<SetStateAction<string | null>>;
  suggestions: PromptMentionSuggestion[];
  isLoading: boolean;
  isError: boolean;
}

interface BuildPromptMentionSuggestionsArgs {
  pathSuggestions: readonly PromptMentionSuggestion[];
  threadSuggestions: readonly PromptMentionSuggestion[];
  projectSuggestions: readonly PromptMentionSuggestion[];
  trimmedQuery: string;
}

function buildPromptMentionSuggestions(
  args: BuildPromptMentionSuggestionsArgs,
): PromptMentionSuggestion[] {
  // A query containing "/" reads as a file path, so paths lead; otherwise the
  // named entities (threads then projects) lead and paths trail.
  return args.trimmedQuery.includes("/")
    ? [
        ...args.pathSuggestions,
        ...args.threadSuggestions,
        ...args.projectSuggestions,
      ]
    : [
        ...args.threadSuggestions,
        ...args.projectSuggestions,
        ...args.pathSuggestions,
      ];
}

function buildProjectNamesById(
  sidebarNavigation: SidebarBootstrapResponse | undefined,
): ReadonlyMap<string, string> {
  const projectNamesById = new Map<string, string>();
  if (!sidebarNavigation) {
    return projectNamesById;
  }

  for (const project of sidebarNavigation.projects) {
    projectNamesById.set(project.id, project.name);
  }
  return projectNamesById;
}

// The sidebar bootstrap keeps the personal project separate from the named
// project list; project mentions offer both so every project is reachable.
function buildProjectMentionCandidates(
  sidebarNavigation: SidebarBootstrapResponse | undefined,
): ProjectMentionCandidate[] {
  if (!sidebarNavigation) {
    return [];
  }

  return [
    ...sidebarNavigation.projects,
    sidebarNavigation.personalProject,
  ].map((project) => ({ id: project.id, name: project.name }));
}

export function usePromptMentions(
  projectId: string | undefined,
  options: UsePromptMentionsOptions,
): UsePromptMentionsResult {
  const [query, setQuery] = useState<string | null>(null);
  const hasQuery = (query?.trim().length ?? 0) > 0;
  const trimmedQuery = query?.trim() ?? "";

  const pathSearch = usePathSuggestions({
    projectId,
    query,
    limit: PROMPT_MENTION_SOURCE_LIMIT,
    environmentId: options.environmentId,
    currentThreadId: options.currentThreadId,
    includeDirectories: true,
  });
  const projectNamesQuery = useSidebarNavigation({
    enabled: hasQuery,
  });
  const threadsQuery = useThreadMentionCandidates({
    enabled: hasQuery,
  });
  const projectNamesById = useMemo(
    () => buildProjectNamesById(projectNamesQuery.data),
    [projectNamesQuery.data],
  );
  const projectCandidates = useMemo(
    () => buildProjectMentionCandidates(projectNamesQuery.data),
    [projectNamesQuery.data],
  );

  const currentThreadId = options.currentThreadId;
  const pathSuggestions = useMemo(
    () =>
      buildPathMentionSuggestions({
        paths: pathSearch.suggestions,
      }),
    [pathSearch.suggestions],
  );
  const threadSuggestions = useMemo(() => {
    return buildThreadMentionSuggestions({
      threads: threadsQuery.data ?? [],
      query: trimmedQuery,
      currentProjectId: projectId,
      currentThreadId,
      projectNamesById,
      limit: PROMPT_MENTION_SOURCE_LIMIT,
    });
  }, [
    currentThreadId,
    projectId,
    projectNamesById,
    threadsQuery.data,
    trimmedQuery,
  ]);
  const projectSuggestions = useMemo(() => {
    return buildProjectMentionSuggestions({
      projects: projectCandidates,
      query: trimmedQuery,
      limit: PROMPT_MENTION_SOURCE_LIMIT,
    });
  }, [projectCandidates, trimmedQuery]);
  const suggestions = useMemo(
    () =>
      hasQuery
        ? buildPromptMentionSuggestions({
            pathSuggestions,
            threadSuggestions,
            projectSuggestions,
            trimmedQuery,
          })
        : [],
    [
      hasQuery,
      pathSuggestions,
      threadSuggestions,
      projectSuggestions,
      trimmedQuery,
    ],
  );

  // Loading flips on only when there are zero suggestions to show. Once the
  // first fetch returns (or placeholderData carries prior results across a
  // refetch), suggestions stay populated and the menu never collapses back
  // to the loading state mid-typing.
  const isLoading =
    hasQuery &&
    suggestions.length === 0 &&
    (pathSearch.isDebouncing ||
      pathSearch.isLoading ||
      threadsQuery.isLoading ||
      threadsQuery.isFetching);
  const isThreadError =
    hasQuery &&
    threadsQuery.isError &&
    !threadsQuery.isLoading &&
    !threadsQuery.isFetching;
  const isError = pathSearch.isError || isThreadError;

  return {
    query,
    setQuery,
    suggestions,
    isLoading,
    isError,
  };
}
