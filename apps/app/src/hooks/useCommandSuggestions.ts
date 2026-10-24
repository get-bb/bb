import { useMemo } from "react";
import type { PromptMentionCommandTrigger } from "@bb/domain";
import type { ProviderCommand } from "@bb/server-contract";
import {
  filterCommandSuggestions,
  toProviderCommandSuggestion,
  type ProviderCommandSuggestion,
} from "@bb/client-core";
import { useProjectCommands } from "./queries/project-queries";

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
}

export type CommandSuggestionSource = Omit<
  UseCommandSuggestionsArgs,
  "activeTrigger" | "query"
>;

interface UseCommandSuggestionsResult {
  triggers: readonly PromptMentionCommandTrigger[];
  suggestions: ProviderCommandSuggestion[];
  isLoading: boolean;
  isRefreshing: boolean;
  isError: boolean;
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
  catalog,
  query,
  trigger,
}: {
  commands: readonly ProviderCommand[] | null | undefined;
  catalog: readonly ProviderCommand[];
  query: string;
  trigger: PromptMentionCommandTrigger | null;
}): ProviderCommandSuggestion[] {
  if (trigger !== "/") {
    return [];
  }
  const catalogNames = new Set(catalog.map((command) => command.name));
  return filterCommandSuggestions(
    (commands ?? [])
      .filter((command) => !catalogNames.has(command.name))
      .map(toProviderCommandSuggestion),
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

function isCommandSuggestionsActive({
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
  const suggestions = useMemo<ProviderCommandSuggestion[]>(() => {
    if (!isActive) {
      return [];
    }
    const catalog = commandsQuery.data?.commands ?? [];
    const discoveredSuggestions = discoveredCommandSuggestions({
      commands: catalog,
      trigger,
      commandScope: args.commandScope,
      query: trimmedQuery,
    });
    return mergeCommandSuggestions(
      mergeCommandSuggestions(
        promptActionSuggestions,
        threadProviderCommandSuggestions({
          commands: args.threadProviderCommands,
          catalog,
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
  const isRefreshing =
    isActive && suggestions.length > 0 && commandsQuery.isFetching;
  const isError = isActive && commandsQuery.isError;

  return {
    triggers: args.skillsTriggers,
    suggestions,
    isLoading,
    isRefreshing,
    isError,
  };
}
