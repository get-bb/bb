import { useCallback, useEffect, useMemo, useRef } from "react";
import { useDebounceValue } from "usehooks-ts";
import type { PromptMentionCommandTrigger } from "@bb/domain";
import {
  toProviderCommandSuggestion,
  type ProviderCommandSuggestion,
} from "@/components/promptbox/mentions/types";
import { useProjectCommandsPages } from "./queries/project-queries";
import { PATH_SUGGESTION_DEBOUNCE_MS } from "./usePathSuggestions";

const COMMAND_SUGGESTION_PAGE_SIZE = 50;

export interface UseCommandSuggestionsArgs {
  projectId: string | undefined;
  providerId: string | undefined;
  skillsTrigger: PromptMentionCommandTrigger | null;
  promptActions?: readonly CommandSuggestionPromptAction[];
  /**
   * Environment whose workspace scopes discovery (e.g. a thread's worktree, or
   * a reused environment in the new-thread composer), or `null` to fall back to
   * the project's default source.
   */
  environmentId: string | null;
  /** Text typed after the trigger char, or `null` when no command trigger is active. */
  query: string | null;
}

export interface UseCommandSuggestionsResult {
  /** The provider's command trigger char, or `null` when the feature is inert. */
  trigger: PromptMentionCommandTrigger | null;
  suggestions: ProviderCommandSuggestion[];
  /**
   * `true` only before the first result lands (and not yet placeholder-backed).
   * Distinct from a loaded-empty list, so the composer can suppress opening an
   * empty menu without flashing a spinner.
   */
  isLoading: boolean;
  isError: boolean;
  hasMore: boolean;
  isLoadingMore: boolean;
  loadMore: () => void;
}

export interface CommandSuggestionPromptAction {
  text?: string;
  command?: {
    trigger: PromptMentionCommandTrigger;
    name: string;
    trailingText: string;
  };
}

function commandSuggestionMatchesQuery(
  suggestion: ProviderCommandSuggestion,
  query: string,
): boolean {
  if (query.length === 0) {
    return true;
  }

  return [
    suggestion.name,
    suggestion.description ?? "",
    suggestion.argumentHint ?? "",
  ]
    .join(" ")
    .toLowerCase()
    .includes(query);
}

export function promptActionCommandSuggestions({
  promptActions,
  query,
  trigger,
}: {
  promptActions: readonly CommandSuggestionPromptAction[] | undefined;
  query: string;
  trigger: PromptMentionCommandTrigger | null;
}): ProviderCommandSuggestion[] {
  if (trigger === null) {
    return [];
  }

  return (promptActions ?? [])
    .flatMap((action): ProviderCommandSuggestion[] => {
      if (!action.command || action.command.trigger !== trigger) {
        return [];
      }
      return [
        {
          kind: "command",
          name: action.command.name,
          source: "command",
          origin: "user",
          description: null,
          argumentHint: null,
        },
      ];
    })
    .filter((suggestion) => commandSuggestionMatchesQuery(suggestion, query));
}

function mergeCommandSuggestions(
  preferred: readonly ProviderCommandSuggestion[],
  fallback: readonly ProviderCommandSuggestion[],
): ProviderCommandSuggestion[] {
  const suggestions: ProviderCommandSuggestion[] = [];
  const seen = new Set<string>();

  for (const suggestion of [...preferred, ...fallback]) {
    const key = `${suggestion.source}:${suggestion.name}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    suggestions.push(suggestion);
  }

  return suggestions;
}

/**
 * Project+provider-scoped command typeahead data source, parallel to
 * `usePromptMentions`. The selected provider's `skills` composer action owns
 * the trigger char; when present, this hook fetches the discoverable
 * skills/commands for the project (debounced like path suggestions). Serves
 * both the existing-thread follow-up composer and the new-thread composer. The
 * hook is inert — never fetches, returns an empty list — when there is no
 * project, no provider, no command trigger for the provider, or no active
 * command query. Unlike mentions, it is enabled even when `query` is empty —
 * the provider-owned trigger shows the full available list.
 */
export function useCommandSuggestions(
  args: UseCommandSuggestionsArgs,
): UseCommandSuggestionsResult {
  const trigger = args.skillsTrigger;
  const isActive =
    args.projectId !== undefined &&
    args.providerId !== undefined &&
    trigger !== null &&
    args.query !== null;

  const [debouncedNonNullQuery] = useDebounceValue(
    args.query,
    PATH_SUGGESTION_DEBOUNCE_MS,
  );
  const debouncedQuery = args.query === null ? null : debouncedNonNullQuery;
  const trimmedQuery = args.query?.trim() ?? "";
  const debouncedTrimmedQuery = debouncedQuery?.trim() ?? "";
  const isDebouncing = isActive && trimmedQuery !== debouncedTrimmedQuery;
  const loadMoreInFlightRef = useRef(false);
  const promptActionSuggestions = useMemo(
    () =>
      isActive
        ? promptActionCommandSuggestions({
            promptActions: args.promptActions,
            query: trimmedQuery.toLowerCase(),
            trigger,
          })
        : [],
    [args.promptActions, isActive, trigger, trimmedQuery],
  );

  useEffect(() => {
    loadMoreInFlightRef.current = false;
  }, [
    args.environmentId,
    args.projectId,
    args.providerId,
    trigger,
    debouncedTrimmedQuery,
  ]);

  const commandsQuery = useProjectCommandsPages(
    {
      projectId: args.projectId,
      providerId: args.providerId,
      environmentId: args.environmentId,
      query: debouncedTrimmedQuery,
      limit: COMMAND_SUGGESTION_PAGE_SIZE,
    },
    { enabled: isActive },
  );

  const suggestions = useMemo<ProviderCommandSuggestion[]>(() => {
    if (!isActive) {
      return [];
    }
    const discoveredSuggestions = (commandsQuery.data?.pages ?? [])
      .flatMap((page) => page.commands)
      .map(toProviderCommandSuggestion);
    return mergeCommandSuggestions(
      promptActionSuggestions,
      discoveredSuggestions,
    );
  }, [commandsQuery.data?.pages, isActive, promptActionSuggestions]);

  const hasMore = isActive && commandsQuery.hasNextPage === true;
  const isLoadingMore = isActive && commandsQuery.isFetchingNextPage;
  const fetchNextPage = commandsQuery.fetchNextPage;
  const loadMore = useCallback(() => {
    if (!hasMore || isLoadingMore || loadMoreInFlightRef.current) {
      return;
    }
    loadMoreInFlightRef.current = true;
    void fetchNextPage().finally(() => {
      loadMoreInFlightRef.current = false;
    });
  }, [fetchNextPage, hasMore, isLoadingMore]);

  // Loading flips on only before any result is available. Once the first page
  // returns, fetching additional pages leaves suggestions populated — and a
  // loaded-empty list reports `isLoading: false` so the composer can suppress
  // opening an empty menu.
  const isLoading =
    isActive &&
    suggestions.length === 0 &&
    commandsQuery.data === undefined &&
    (isDebouncing || commandsQuery.isPending || commandsQuery.isFetching);
  const isError = isActive && commandsQuery.isError;

  return {
    trigger,
    suggestions,
    isLoading,
    isError,
    hasMore,
    isLoadingMore,
    loadMore,
  };
}
