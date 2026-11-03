import { useMemo } from "react";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { isRawThreadId } from "@bb/domain";
import type { PromptDraftState } from "@bb/client-core";
import {
  resolveSerializedPromptMentions,
  useSidebarThreadTitleMentionResources,
} from "@/components/thread/ThreadTitleMentions";
import { sdk } from "@/lib/sdk";
import { resolveThreadMentionsInBatches } from "@/lib/thread-links";
import { useSidebarNavigation } from "@/hooks/queries/sidebar-navigation-query";

export async function resolveInitialPromptDraft(
  draft: PromptDraftState,
  resolveMentions: typeof sdk.threads.resolveMentions,
  signal: AbortSignal,
): Promise<PromptDraftState> {
  const threadIds = [
    ...new Set(
      draft.mentions.flatMap(({ resource }) =>
        resource.kind === "thread" &&
        resource.projectId === undefined &&
        isRawThreadId(resource.threadId)
          ? [resource.threadId]
          : [],
      ),
    ),
  ];
  if (threadIds.length === 0) return draft;
  const resolvedById = new Map<string, { projectId: string; label: string }>();
  const unavailableIds = new Set<string>();
  await resolveThreadMentionsInBatches(
    threadIds,
    (batch) => resolveMentions({ threadIds: batch, signal }),
    signal,
    ({ threadIds: batch, threads }) => {
      for (const thread of threads) resolvedById.set(thread.threadId, thread);
      for (const id of batch) if (!resolvedById.has(id)) unavailableIds.add(id);
    },
  );
  if (signal.aborted) return draft;
  return {
    ...draft,
    mentions: draft.mentions.map((mention) => {
      const { resource } = mention;
      if (resource.kind !== "thread") return mention;
      const resolved = resolvedById.get(resource.threadId);
      if (resolved !== undefined) {
        return {
          ...mention,
          resource: {
            ...resource,
            projectId: resolved.projectId,
            label: resolved.label,
          },
        };
      }
      return unavailableIds.has(resource.threadId)
        ? { ...mention, resource: { ...resource, label: "Unavailable thread" } }
        : mention;
    }),
  };
}

interface InitialPromptDraftQueryOptionsArgs {
  text: string | null;
  navigationPending: boolean;
  draft: PromptDraftState;
  resolveMentions: typeof sdk.threads.resolveMentions;
}

export function initialPromptDraftQueryOptions({
  text,
  navigationPending,
  draft,
  resolveMentions,
}: InitialPromptDraftQueryOptionsArgs) {
  return queryOptions({
    queryKey: ["initial-prompt-draft", draft],
    queryFn: ({ signal }) =>
      resolveInitialPromptDraft(draft, resolveMentions, signal),
    enabled: text !== null && !navigationPending,
    staleTime: Infinity,
  });
}

export function useInitialPromptDraft(
  text: string | null,
): PromptDraftState | undefined {
  const navigation = useSidebarNavigation({ enabled: text !== null });
  const resources = useSidebarThreadTitleMentionResources(navigation.data);
  const draft = useMemo<PromptDraftState>(
    () => ({
      text: text ?? "",
      mentions: resolveSerializedPromptMentions(text ?? "", resources),
      attachments: [],
    }),
    [resources, text],
  );
  return useQuery(
    initialPromptDraftQueryOptions({
      text,
      navigationPending: navigation.isPending,
      draft,
      resolveMentions: (args) => sdk.threads.resolveMentions(args),
    }),
  ).data;
}
