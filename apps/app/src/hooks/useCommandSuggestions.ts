import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import type { PromptMentionCommandTrigger } from "@bb/domain";
import type { ProviderCommand } from "@bb/server-contract";
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
  threadProviderCommands?: readonly ProviderCommand[] | null;
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

export function threadProviderCommandSuggestions({
  commands,
  query,
  trigger,
}: {
  commands: readonly ProviderCommand[] | null | undefined;
  query: string;
  trigger: PromptMentionCommandTrigger | null;
}): ProviderCommandSuggestion[] {
  if (trigger !== "/") {
    return [];
  }
  return filterCommandSuggestions(
    (commands ?? []).map(toProviderCommandSuggestion),
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

export function isCommandSuggestionsActive({
  projectId,
  providerId,
  skillsTriggers,
  activeTrigger,
  query,
}: Pick<
  UseCommandSuggestionsArgs,
  "projectId" | "providerId" | "skillsTriggers" | "activeTrigger" | "query"
>): boolean {
  return (
    projectId !== undefined &&
    providerId !== undefined &&
    activeTrigger !== null &&
    skillsTriggers.includes(activeTrigger) &&
    query !== null
  );
}

export function shouldPrefetchCommandCatalog({
  composerFocused,
  isPointerCoarse,
  projectId,
  providerId,
  skillsTriggers,
}: Pick<
  UseCommandSuggestionsArgs,
  "composerFocused" | "projectId" | "providerId" | "skillsTriggers"
> & { isPointerCoarse: boolean }): boolean {
  return (
    composerFocused === true &&
    isPointerCoarse &&
    projectId !== undefined &&
    providerId !== undefined &&
    skillsTriggers.length > 0
  );
}

export function prefetchCommandCatalog(
  queryClient: QueryClient,
  target: {
    projectId: string | undefined;
    providerId: string | undefined;
    environmentId: string | null;
    hostId: string | null;
  },
): Promise<void> {
  return queryClient.prefetchQuery({
    ...projectCommandsQueryOptions(target),
    retry: false,
    staleTime: COMMAND_CATALOG_PREFETCH_STALE_TIME_MS,
  });
}

export function discoveredCommandSuggestions({
  commands,
  trigger,
  commandScope,
  query,
}: {
  commands: readonly ProviderCommand[];
  trigger: PromptMentionCommandTrigger | null;
  commandScope: UseCommandSuggestionsArgs["commandScope"];
  query: string;
}): ProviderCommandSuggestion[] {
  return filterCommandSuggestions(
    commands
      .map(toProviderCommandSuggestion)
      .filter(
        (suggestion) =>
          (trigger !== "$" || suggestion.source === "skill") &&
          (commandScope === "thread" ||
            suggestion.source !== "command" ||
            suggestion.origin !== "builtin" ||
            suggestion.name !== "compact"),
      ),
    query,
  );
}

export function useCommandSuggestions(
  args: UseCommandSuggestionsArgs,
): UseCommandSuggestionsResult {
  const trigger = args.activeTrigger;
  const isActive = isCommandSuggestionsActive(args);

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
  const shouldPrefetchCatalog = shouldPrefetchCommandCatalog({
    ...args,
    isPointerCoarse,
  });
  const prefetchProjectId = args.projectId;
  const prefetchProviderId = args.providerId;
  const prefetchEnvironmentId = args.environmentId;
  const prefetchHostId = args.hostId ?? null;
  useEffect(() => {
    if (!shouldPrefetchCatalog) {
      return;
    }
    void prefetchCommandCatalog(queryClient, {
      projectId: prefetchProjectId,
      providerId: prefetchProviderId,
      environmentId: prefetchEnvironmentId,
      hostId: prefetchHostId,
    });
  }, [
    prefetchEnvironmentId,
    prefetchHostId,
    prefetchProjectId,
    prefetchProviderId,
    queryClient,
    shouldPrefetchCatalog,
  ]);

  const suggestions = useMemo<ProviderCommandSuggestion[]>(() => {
    if (!isActive) {
      return [];
    }
    const discoveredSuggestions = discoveredCommandSuggestions({
      commands: commandsQuery.data?.commands ?? [],
      trigger,
      commandScope: args.commandScope,
      query: trimmedQuery,
    });
    return mergeCommandSuggestions(
      mergeCommandSuggestions(
        promptActionSuggestions,
        threadProviderCommandSuggestions({
          commands: args.threadProviderCommands,
          query: trimmedQuery,
          trigger,
        }),
      ),
      discoveredSuggestions,
    );
  }, [
    args.threadProviderCommands,
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
  };
}
