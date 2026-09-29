import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef } from "react";
import type { PromptMentionCommandTrigger } from "@bb/domain";
import { usePointerCoarse } from "@bb/shared-ui/hooks/use-pointer-coarse";
import {
  filterCommandSuggestions,
  toProviderCommandSuggestion,
  type ProviderCommandSuggestion,
} from "@bb/client-core";
import {
  projectCommandsQueryOptions,
  useProjectCommands,
} from "./queries/project-queries";

interface UseCommandSuggestionsArgs {
  projectId: string | undefined;
  providerId: string | undefined;
  commandScope: "new-thread" | "thread";
  skillsTriggers: readonly PromptMentionCommandTrigger[];
  activeTrigger: PromptMentionCommandTrigger | null;
  promptActions?: readonly CommandSuggestionPromptAction[];
  environmentId: string | null;
  hostId?: string | null;
  query: string | null;
  composerFocused?: boolean;
}

const COMMAND_CATALOG_PREFETCH_STALE_TIME_MS = 30_000;

interface UseCommandSuggestionsResult {
  triggers: readonly PromptMentionCommandTrigger[];
  suggestions: ProviderCommandSuggestion[];
  isLoading: boolean;
  isError: boolean;
  hasMore: boolean;
  isLoadingMore: boolean;
  loadMore: () => void;
  prefetchCatalog: () => void;
}

interface CommandCatalogTarget {
  projectId: string;
  providerId: string;
  environmentId: string | null;
  hostId: string | null;
}

interface CommandSuggestionPromptAction {
  text?: string;
  command?: {
    trigger: PromptMentionCommandTrigger;
    name: string;
    trailingText: string;
  };
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

  return filterCommandSuggestions(
    (promptActions ?? []).flatMap((action): ProviderCommandSuggestion[] => {
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
    }),
    query,
  );
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

export function useCommandSuggestions(
  args: UseCommandSuggestionsArgs,
): UseCommandSuggestionsResult {
  const trigger = args.activeTrigger;
  const isActive =
    args.projectId !== undefined &&
    args.providerId !== undefined &&
    trigger !== null &&
    args.skillsTriggers.includes(trigger) &&
    args.query !== null;

  const trimmedQuery = args.query?.trim() ?? "";
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

  const commandsQuery = useProjectCommands(
    {
      projectId: args.projectId,
      providerId: args.providerId,
      environmentId: args.environmentId,
      hostId: args.hostId ?? null,
    },
    { enabled: isActive },
  );
  const queryClient = useQueryClient();
  const isPointerCoarse = usePointerCoarse();
  const catalogTarget = useMemo<CommandCatalogTarget | null>(
    () =>
      args.projectId !== undefined &&
      args.providerId !== undefined &&
      args.skillsTriggers.length > 0
        ? {
            projectId: args.projectId,
            providerId: args.providerId,
            environmentId: args.environmentId,
            hostId: args.hostId ?? null,
          }
        : null,
    [
      args.environmentId,
      args.hostId,
      args.projectId,
      args.providerId,
      args.skillsTriggers.length,
    ],
  );
  const catalogTargetRef = useRef(catalogTarget);
  useEffect(() => {
    catalogTargetRef.current = catalogTarget;
  }, [catalogTarget]);
  const prefetchCatalog = useCallback(() => {
    const target = catalogTargetRef.current;
    if (target === null) {
      return;
    }
    void queryClient.prefetchQuery({
      ...projectCommandsQueryOptions(target),
      retry: false,
      staleTime: COMMAND_CATALOG_PREFETCH_STALE_TIME_MS,
    });
  }, [queryClient]);
  const shouldPrefetchOnFocus =
    args.composerFocused === true && isPointerCoarse && catalogTarget !== null;
  useEffect(() => {
    if (shouldPrefetchOnFocus) {
      prefetchCatalog();
    }
  }, [catalogTarget, prefetchCatalog, shouldPrefetchOnFocus]);

  const suggestions = useMemo<ProviderCommandSuggestion[]>(() => {
    if (!isActive) {
      return [];
    }
    const discoveredSuggestions = filterCommandSuggestions(
      (commandsQuery.data?.commands ?? [])
        .map(toProviderCommandSuggestion)
        .filter(
          (suggestion) =>
            (trigger !== "$" || suggestion.source === "skill") &&
            (args.commandScope === "thread" ||
              suggestion.source !== "command" ||
              suggestion.origin !== "builtin" ||
              suggestion.name !== "compact"),
        ),
      trimmedQuery,
    );
    return mergeCommandSuggestions(
      promptActionSuggestions,
      discoveredSuggestions,
    );
  }, [
    commandsQuery.data?.commands,
    args.commandScope,
    trigger,
    isActive,
    promptActionSuggestions,
    trimmedQuery,
  ]);

  const isLoading =
    isActive &&
    suggestions.length === 0 &&
    commandsQuery.data === undefined &&
    (commandsQuery.isPending || commandsQuery.isFetching);
  const isError = isActive && commandsQuery.isError;

  return {
    triggers: args.skillsTriggers,
    suggestions,
    isLoading,
    isError,
    hasMore: false,
    isLoadingMore: false,
    loadMore: () => {},
    prefetchCatalog,
  };
}
