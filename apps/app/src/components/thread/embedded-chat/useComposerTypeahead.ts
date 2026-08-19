import { useCallback, useMemo, useState } from "react";
import type { TypeaheadConfig } from "@/components/promptbox/PromptBoxInternal";
import type { PromptMentionLinkResolver } from "@/components/promptbox/editor/prompt-mention-link";
import type { PromptBoxAction } from "@/components/promptbox/PromptBoxActionsMenu";
import { withAppPromptActions } from "@/components/promptbox/PromptBoxActionsMenu";
import type { ProviderComposerAction } from "@bb/domain";
import { buildProviderPromptActionProps } from "@/components/promptbox/mentions/command-trigger";
import { useCommandSuggestions } from "@/hooks/useCommandSuggestions";
import { usePromptMentions } from "@/hooks/usePromptMentions";

interface UseComposerTypeaheadArgs {
  projectId: string;
  /** Project scope for @-mentions when it differs from the command scope. */
  mentionsProjectId?: string;
  providerId: string;
  environmentId: string | null;
  /** Composer surface used to exclude commands that require an existing thread. */
  commandScope: "new-thread" | "thread";
  /** The thread the composer belongs to (excluded from thread mentions). */
  currentThreadId: string;
  selectedProviderComposerActions:
    | readonly ProviderComposerAction[]
    | undefined;
  resolveMentionLink: PromptMentionLinkResolver;
}

export interface UseComposerTypeaheadResult {
  typeaheadConfig: TypeaheadConfig;
  promptActions: readonly PromptBoxAction[];
}

/**
 * The @-mention and command-trigger typeahead wiring shared by every
 * thread-chat composer, plus the provider prompt actions (with the app-owned
 * actions appended) that seed the command suggestion list.
 */
export function useComposerTypeahead({
  projectId,
  mentionsProjectId,
  providerId,
  environmentId,
  commandScope,
  currentThreadId,
  selectedProviderComposerActions,
  resolveMentionLink,
}: UseComposerTypeaheadArgs): UseComposerTypeaheadResult {
  const promptMentions = usePromptMentions(mentionsProjectId ?? projectId, {
    currentThreadId,
    environmentId,
    threadStorageThreadId: currentThreadId,
  });
  const [commandQuery, setCommandQuery] = useState<string | null>(null);
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
    skillsTrigger: providerPromptActions.skillsTrigger,
    promptActions,
    environmentId,
    query: commandQuery,
    composerFocused: hasComposerFocused,
  });

  const typeaheadConfig = useMemo<TypeaheadConfig>(
    () => ({
      mention: {
        triggers: promptMentions.triggers,
        suggestions: promptMentions.suggestions,
        isLoading: promptMentions.isLoading,
        isError: promptMentions.isError,
        onQueryChange: promptMentions.setQuery,
        resolveLink: resolveMentionLink,
      },
      command: {
        trigger: commandSuggestions.trigger,
        suggestions: commandSuggestions.suggestions,
        isLoading: commandSuggestions.isLoading,
        isError: commandSuggestions.isError,
        hasMore: commandSuggestions.hasMore,
        isLoadingMore: commandSuggestions.isLoadingMore,
        loadMore: commandSuggestions.loadMore,
        onQueryChange: setCommandQuery,
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
      commandSuggestions.trigger,
      handleEditorFocus,
      promptMentions.isError,
      promptMentions.isLoading,
      promptMentions.setQuery,
      promptMentions.suggestions,
      promptMentions.triggers,
      resolveMentionLink,
    ],
  );

  return { typeaheadConfig, promptActions };
}
