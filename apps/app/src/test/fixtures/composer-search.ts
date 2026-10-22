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

const state: {
  mentionSuggestions: readonly PromptMentionSuggestion[];
  commandSuggestions: readonly ProviderCommandSuggestion[];
} = { mentionSuggestions: [], commandSuggestions: [] };

export const composerSearchQueries = {
  mention: vi.fn<(text: string | null, trigger: string | null) => void>(),
  command: vi.fn<(text: string | null, trigger: string | null) => void>(),
  commandPrefetch: vi.fn<(requested: boolean) => void>(),
};

export function setComposerSearchResults({
  mentionSuggestions = [],
  commandSuggestions = [],
}: {
  mentionSuggestions?: readonly PromptMentionSuggestion[];
  commandSuggestions?: readonly ProviderCommandSuggestion[];
} = {}): void {
  state.mentionSuggestions = mentionSuggestions;
  state.commandSuggestions = commandSuggestions;
  composerSearchQueries.mention.mockClear();
  composerSearchQueries.command.mockClear();
  composerSearchQueries.commandPrefetch.mockClear();
}

function fakeUsePromptMentions(
  _source: PromptMentionSource,
  mention: { text: string; trigger: PluginMentionTrigger } | null,
): ReturnType<typeof usePromptMentions> {
  composerSearchQueries.mention(
    mention?.text ?? null,
    mention?.trigger ?? null,
  );
  return {
    results: orderPromptMentionSuggestions({
      query: mention?.text.trim() ?? "",
      suggestions: state.mentionSuggestions,
    }),
    isLoading: false,
    isRefreshing: false,
    isError: false,
  };
}

function fakeUseCommandSuggestions(
  args: CommandSuggestionSource & {
    activeTrigger: PromptMentionCommandTrigger | null;
    query: string | null;
    composerFocused?: boolean;
  },
): ReturnType<typeof useCommandSuggestions> {
  composerSearchQueries.command(args.query, args.activeTrigger);
  composerSearchQueries.commandPrefetch(args.composerFocused === true);
  return {
    triggers: args.skillsTriggers,
    suggestions: [...state.commandSuggestions],
    isLoading: false,
    isRefreshing: false,
    isError: false,
  };
}

export function fakePromptMentionsModule() {
  return {
    usePromptMentions: fakeUsePromptMentions,
    usePromptMentionTriggers: (): readonly PluginMentionTrigger[] => [
      DEFAULT_PLUGIN_MENTION_TRIGGER,
    ],
  };
}

export function fakeCommandSuggestionsModule() {
  return { useCommandSuggestions: fakeUseCommandSuggestions };
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
