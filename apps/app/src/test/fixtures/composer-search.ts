import { useSyncExternalStore } from "react";
import { vi } from "vitest";
import {
  DEFAULT_PLUGIN_MENTION_TRIGGER,
  type PluginMentionTrigger,
  type PromptMentionSuggestion,
  type ProviderCommandSuggestion,
} from "@bb/client-core";
import type { PromptMentionCommandTrigger } from "@bb/domain";
import { orderPromptMentionSuggestions } from "@/hooks/promptMentionCandidates";
import type {
  CommandSuggestionSource,
  useCommandSuggestions,
} from "@/hooks/useCommandSuggestions";
import type { TypeaheadConfig } from "@/components/promptbox/ComposerBox";
import type {
  PromptMentionSource,
  usePromptMentions,
} from "@/hooks/usePromptMentions";

interface ComposerSearchResults {
  mentionSuggestions: readonly PromptMentionSuggestion[];
  commandSuggestions: readonly ProviderCommandSuggestion[];
}

let state: ComposerSearchResults = {
  mentionSuggestions: [],
  commandSuggestions: [],
};
const listeners = new Set<() => void>();

function subscribeToComposerSearchResults(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function readComposerSearchResults(): ComposerSearchResults {
  return state;
}

function sameItems<T>(left: readonly T[], right: readonly T[]): boolean {
  return (
    left.length === right.length &&
    left.every((item, index) => item === right[index])
  );
}

export const composerSearchQueries = {
  mention: vi.fn<(text: string | null, trigger: string | null) => void>(),
  command: vi.fn<(text: string | null, trigger: string | null) => void>(),
};

export function setComposerSearchResults({
  mentionSuggestions = [],
  commandSuggestions = [],
}: {
  mentionSuggestions?: readonly PromptMentionSuggestion[];
  commandSuggestions?: readonly ProviderCommandSuggestion[];
} = {}): void {
  composerSearchQueries.mention.mockClear();
  composerSearchQueries.command.mockClear();
  if (
    sameItems(state.mentionSuggestions, mentionSuggestions) &&
    sameItems(state.commandSuggestions, commandSuggestions)
  ) {
    return;
  }
  state = { mentionSuggestions, commandSuggestions };
  for (const listener of [...listeners]) listener();
}

function useComposerSearchResults(): ComposerSearchResults {
  return useSyncExternalStore(
    subscribeToComposerSearchResults,
    readComposerSearchResults,
    readComposerSearchResults,
  );
}

function useFakePromptMentions(
  _source: PromptMentionSource,
  mention: { text: string; trigger: PluginMentionTrigger } | null,
): ReturnType<typeof usePromptMentions> {
  const { mentionSuggestions } = useComposerSearchResults();
  composerSearchQueries.mention(
    mention?.text ?? null,
    mention?.trigger ?? null,
  );
  return {
    results: orderPromptMentionSuggestions({
      query: mention?.text.trim() ?? "",
      suggestions: mentionSuggestions,
    }),
    isLoading: false,
    isRefreshing: false,
    isError: false,
  };
}

function useFakeCommandSuggestions(
  args: CommandSuggestionSource & {
    activeTrigger: PromptMentionCommandTrigger | null;
    query: string | null;
  },
): ReturnType<typeof useCommandSuggestions> {
  const { commandSuggestions } = useComposerSearchResults();
  composerSearchQueries.command(args.query, args.activeTrigger);
  return {
    suggestions: [...commandSuggestions],
    isLoading: false,
    isRefreshing: false,
    isError: false,
  };
}

export function fakePromptMentionsModule() {
  return {
    usePromptMentions: useFakePromptMentions,
    usePromptMentionTriggers: (): readonly PluginMentionTrigger[] => [
      DEFAULT_PLUGIN_MENTION_TRIGGER,
    ],
  };
}

export function fakeCommandSuggestionsModule() {
  return { useCommandSuggestions: useFakeCommandSuggestions };
}

export function testTypeaheadConfig({
  mentionTriggers,
  commandTriggers = [],
}: {
  mentionTriggers?: readonly PluginMentionTrigger[];
  commandTriggers?: readonly PromptMentionCommandTrigger[];
} = {}): TypeaheadConfig {
  return {
    mention: {
      triggers: mentionTriggers,
      source: { projectId: undefined, environmentId: null },
    },
    command: {
      source: {
        projectId: undefined,
        providerId: undefined,
        commandScope: "thread",
        skillsTriggers: commandTriggers,
        environmentId: null,
      },
    },
  };
}
