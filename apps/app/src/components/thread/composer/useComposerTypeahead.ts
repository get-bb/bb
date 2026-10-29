import { useMemo } from "react";
import type { TypeaheadConfig } from "@/components/promptbox/ComposerBox";
import type { PromptMentionLinkResolver } from "@bb/client-core";
import type { PromptBoxAction } from "@/components/promptbox/ComposerBox";
import type { ProviderComposerAction } from "@bb/domain";
import type { ProviderCommand } from "@bb/server-contract";
import { buildProviderPromptActionProps } from "@bb/client-core";
import { usePromptMentionTriggers } from "@/hooks/usePromptMentions";

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
  threadProviderCommands?: readonly ProviderCommand[] | null;
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
  threadProviderCommands,
  resolveMentionLink,
}: UseComposerTypeaheadArgs): UseComposerTypeaheadResult {
  const mentionTriggers = usePromptMentionTriggers();
  const providerPromptActions = useMemo(
    () => buildProviderPromptActionProps(selectedProviderComposerActions ?? []),
    [selectedProviderComposerActions],
  );
  const { promptActions, skillsTriggers } = providerPromptActions;
  const mentionSourceProjectId = mentionsProjectId ?? projectId;

  const typeaheadConfig = useMemo<TypeaheadConfig>(
    () => ({
      mention: {
        triggers: mentionTriggers,
        source: {
          projectId: mentionSourceProjectId,
          currentThreadId,
          environmentId,
          threadStorageThreadId: currentThreadId,
        },
        resolveLink: resolveMentionLink,
      },
      command: {
        source: {
          projectId,
          providerId,
          commandScope,
          skillsTriggers,
          promptActions,
          threadProviderCommands: threadProviderCommands ?? null,
          environmentId,
        },
      },
    }),
    [
      commandScope,
      currentThreadId,
      environmentId,
      mentionSourceProjectId,
      mentionTriggers,
      projectId,
      promptActions,
      providerId,
      resolveMentionLink,
      skillsTriggers,
      threadProviderCommands,
    ],
  );

  return { typeaheadConfig, promptActions };
}
