import { useCallback, useMemo, useState } from "react";
import type { TypeaheadConfig } from "@/components/promptbox/PromptBoxInternal";
import type { PromptMentionLinkResolver } from "@/components/promptbox/editor/prompt-mention-link";
import type { PromptBoxAction } from "@/components/promptbox/PromptBoxActionsMenu";
import { withAppPromptActions } from "@/components/promptbox/PromptBoxActionsMenu";
import type { ProviderComposerAction } from "@bb/domain";
import { buildProviderPromptActionProps } from "@bb/client-core";
import { useCommandSuggestions } from "@/hooks/useCommandSuggestions";
import { usePromptMentions } from "@/hooks/usePromptMentions";

interface UseComposerTypeaheadArgs {
  projectId: string;
  mentionsProjectId?: string;
  providerId: string;
  commandScope?: "new-thread" | "thread";
  environmentId: string | null;
  currentThreadId: string;
  selectedProviderComposerActions:
    | readonly ProviderComposerAction[]
    | undefined;
  resolveMentionLink: PromptMentionLinkResolver;
}

interface UseComposerTypeaheadResult {
  typeaheadConfig: TypeaheadConfig;
  promptActions: readonly PromptBoxAction[];
}

export function useComposerTypeahead({
  projectId,
  mentionsProjectId,
  providerId,
  commandScope = "thread",
  environmentId,
  currentThreadId,
  selectedProviderComposerActions,
  resolveMentionLink,
}: UseComposerTypeaheadArgs): UseComposerTypeaheadResult {
  const promptMentions = usePromptMentions(mentionsProjectId ?? projectId, {
    currentThreadId,
    environmentId,
    threadStorageThreadId: currentThreadId,
  });
  const [commandState, setCommandState] = useState<{
    query: string | null;
    trigger: import("@bb/domain").PromptMentionCommandTrigger | null;
  }>({ query: null, trigger: null });
  const [hasComposerFocused, setHasComposerFocused] = useState(false);
  const handleEditorFocus = useCallback(() => {
    setHasComposerFocused(true);
  }, []);
  const providerPromptActions = useMemo(
    () => buildProviderPromptActionProps(selectedProviderComposerActions ?? []),
    [selectedProviderComposerActions],
  );
  const promptActions = useMemo(
    () => withAppPromptActions(providerPromptActions.promptActions),
    [providerPromptActions.promptActions],
  );
  const commandSuggestions = useCommandSuggestions({
    projectId,
    providerId,
    commandScope,
    skillsTriggers: providerPromptActions.skillsTriggers,
    activeTrigger: commandState.trigger,
    promptActions,
    environmentId,
    query: commandState.query,
    composerFocused: hasComposerFocused,
  });

  const typeaheadConfig = useMemo<TypeaheadConfig>(
    () => ({
      mention: {
        triggers: promptMentions.triggers,
        results: promptMentions.results,
        isLoading: promptMentions.isLoading,
        isError: promptMentions.isError,
        onQueryChange: promptMentions.setQuery,
        resolveLink: resolveMentionLink,
      },
      command: {
        triggers: commandSuggestions.triggers,
        suggestions: commandSuggestions.suggestions,
        isLoading: commandSuggestions.isLoading,
        isError: commandSuggestions.isError,
        hasMore: commandSuggestions.hasMore,
        isLoadingMore: commandSuggestions.isLoadingMore,
        loadMore: commandSuggestions.loadMore,
        onQueryChange: (query, trigger) => setCommandState({ query, trigger }),
        onEditorFocus: handleEditorFocus,
      },
    }),
    [
      commandSuggestions.hasMore,
      commandSuggestions.isError,
      commandSuggestions.isLoading,
      commandSuggestions.isLoadingMore,
      commandSuggestions.loadMore,
      commandSuggestions.suggestions,
      commandSuggestions.triggers,
      handleEditorFocus,
      promptMentions.isError,
      promptMentions.isLoading,
      promptMentions.setQuery,
      promptMentions.results,
      promptMentions.triggers,
      resolveMentionLink,
    ],
  );

  return { typeaheadConfig, promptActions };
}
