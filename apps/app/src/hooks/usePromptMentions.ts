import { useMemo, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { SidebarBootstrapResponse } from "@bb/server-contract";
import { buildPathMentionSuggestions } from "./pathMentionSuggestions";
import { useSidebarNavigation } from "./queries/project-queries";
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
  trimmedQuery: string;
}

function buildPromptMentionSuggestions(
  args: BuildPromptMentionSuggestionsArgs,
): PromptMentionSuggestion[] {
  return args.trimmedQuery.includes("/")
    ? [...args.pathSuggestions, ...args.threadSuggestions]
    : [...args.threadSuggestions, ...args.pathSuggestions];
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
  const suggestions = useMemo(
    () =>
      hasQuery
        ? buildPromptMentionSuggestions({
            pathSuggestions,
            threadSuggestions,
            trimmedQuery,
          })
        : [],
    [hasQuery, pathSuggestions, threadSuggestions, trimmedQuery],
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
