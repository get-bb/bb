import { useMemo } from "react";
import { useDebounceValue } from "usehooks-ts";
import { commandTriggerForProvider } from "@/components/promptbox/mentions/command-trigger";
import {
  toProviderCommandSuggestion,
  type ProviderCommandSuggestion,
} from "@/components/promptbox/mentions/types";
import { useProjectCommands } from "./queries/project-queries";
import { PATH_SUGGESTION_DEBOUNCE_MS } from "./usePathSuggestions";

const COMMAND_SUGGESTION_LIMIT = 8;

export interface UseCommandSuggestionsArgs {
  projectId: string | undefined;
  providerId: string | undefined;
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
  trigger: "/" | "$" | null;
  suggestions: ProviderCommandSuggestion[];
  /**
   * `true` only before the first result lands (and not yet placeholder-backed).
   * Distinct from a loaded-empty list, so the composer can suppress opening an
   * empty menu without flashing a spinner.
   */
  isLoading: boolean;
  isError: boolean;
}

/**
 * Project+provider-scoped command typeahead data source, parallel to
 * `usePromptMentions`. Resolves the provider's trigger char and, when present,
 * fetches the discoverable skills/commands for the project (debounced like path
 * suggestions). Serves both the existing-thread follow-up composer and the
 * new-thread composer. The hook is inert — never fetches, returns an empty list
 * — when there is no project, no command trigger for the provider, or no active
 * command query. Unlike mentions, it is enabled even when `query` is empty —
 * `/`/`$` show the full available list.
 */
export function useCommandSuggestions(
  args: UseCommandSuggestionsArgs,
): UseCommandSuggestionsResult {
  const trigger =
    args.providerId !== undefined
      ? commandTriggerForProvider(args.providerId)
      : null;
  const isActive =
    args.projectId !== undefined && trigger !== null && args.query !== null;

  const [debouncedNonNullQuery] = useDebounceValue(
    args.query,
    PATH_SUGGESTION_DEBOUNCE_MS,
  );
  const debouncedQuery = args.query === null ? null : debouncedNonNullQuery;
  const trimmedQuery = args.query?.trim() ?? "";
  const debouncedTrimmedQuery = debouncedQuery?.trim() ?? "";
  const isDebouncing = isActive && trimmedQuery !== debouncedTrimmedQuery;

  const commandsQuery = useProjectCommands(
    {
      projectId: args.projectId,
      providerId: args.providerId,
      environmentId: args.environmentId,
      query: debouncedTrimmedQuery,
      limit: COMMAND_SUGGESTION_LIMIT,
    },
    { enabled: isActive },
  );

  const suggestions = useMemo<ProviderCommandSuggestion[]>(() => {
    if (!isActive) {
      return [];
    }
    return (commandsQuery.data?.commands ?? []).map(toProviderCommandSuggestion);
  }, [commandsQuery.data?.commands, isActive]);

  // Loading flips on only before any result is available. Once the first fetch
  // returns (or placeholderData carries prior results across a refetch),
  // suggestions stay populated and the menu never collapses to loading
  // mid-typing — and a loaded-empty list reports `isLoading: false` so the
  // composer can suppress opening an empty menu.
  const isLoading =
    isActive &&
    commandsQuery.data === undefined &&
    (isDebouncing || commandsQuery.isPending || commandsQuery.isFetching);
  const isError = isActive && commandsQuery.isError;

  return {
    trigger,
    suggestions,
    isLoading,
    isError,
  };
}
