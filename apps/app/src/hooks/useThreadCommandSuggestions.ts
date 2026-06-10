import { useMemo } from "react";
import { useDebounceValue } from "usehooks-ts";
import { commandTriggerForProvider } from "@/components/promptbox/mentions/command-trigger";
import {
  toProviderCommandSuggestion,
  type ProviderCommandSuggestion,
} from "@/components/promptbox/mentions/types";
import { useThreadCommands } from "./queries/thread-queries";
import { PATH_SUGGESTION_DEBOUNCE_MS } from "./usePathSuggestions";

const COMMAND_SUGGESTION_LIMIT = 8;

export interface UseThreadCommandSuggestionsArgs {
  threadId: string;
  providerId: string;
  /** Text typed after the trigger char, or `null` when no command trigger is active. */
  query: string | null;
}

export interface UseThreadCommandSuggestionsResult {
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
 * Thread-scoped command typeahead data source, parallel to `usePromptMentions`.
 * Resolves the provider's trigger char and, when present, fetches the
 * discoverable skills/commands for the thread (debounced like path
 * suggestions). With no command trigger the hook is inert: it never fetches and
 * returns an empty list. Unlike mentions, it is enabled even when `query` is
 * empty — `/`/`$` show the full available list.
 */
export function useThreadCommandSuggestions(
  args: UseThreadCommandSuggestionsArgs,
): UseThreadCommandSuggestionsResult {
  const trigger = commandTriggerForProvider(args.providerId);
  const isActive = trigger !== null && args.query !== null;

  const [debouncedNonNullQuery] = useDebounceValue(
    args.query,
    PATH_SUGGESTION_DEBOUNCE_MS,
  );
  const debouncedQuery = args.query === null ? null : debouncedNonNullQuery;
  const trimmedQuery = args.query?.trim() ?? "";
  const debouncedTrimmedQuery = debouncedQuery?.trim() ?? "";
  const isDebouncing = isActive && trimmedQuery !== debouncedTrimmedQuery;

  const commandsQuery = useThreadCommands(
    {
      threadId: args.threadId,
      query: debouncedTrimmedQuery,
      limit: COMMAND_SUGGESTION_LIMIT,
    },
    { enabled: isActive && Boolean(args.threadId) },
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
