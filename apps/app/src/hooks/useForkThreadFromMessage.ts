import { useOpenNewThreadDraft } from "@/hooks/useOpenNewThreadDraft";
import { useCallback, useLayoutEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Thread } from "@bb/domain";
import { sdk } from "@/lib/sdk";
import {
  FORK_THREAD_CREATE_SEED_LOCATION_STATE_KEY,
  isThreadForkable,
  type ForkThreadCreateSeed,
} from "@bb/client-core";
import { getThreadDisplayTitle } from "@/lib/thread-title";
import { useSetRootComposeProjectId } from "@/lib/root-compose-selection";
import { threadDefaultExecutionOptionsQueryKey } from "@/hooks/queries/query-keys";
import { findCachedProviderInfo } from "@/hooks/queries/system-queries";

interface UseForkThreadFromMessageArgs {
  sourceThread: Thread | null;
}

interface ForkThreadFromMessageTarget {
  sourceSeqEnd: number;
}

export function useForkThreadFromMessage({
  sourceThread,
}: UseForkThreadFromMessageArgs): (
  target: ForkThreadFromMessageTarget,
) => Promise<void> {
  const openNewDraft = useOpenNewThreadDraft();
  const queryClient = useQueryClient();
  const setRootComposeProjectId = useSetRootComposeProjectId();
  const forkInFlightRef = useRef(false);
  const sourceThreadRef = useRef(sourceThread);
  useLayoutEffect(() => {
    sourceThreadRef.current = sourceThread;
  }, [sourceThread]);

  return useCallback(
    async (target: ForkThreadFromMessageTarget) => {
      const source = sourceThreadRef.current;
      if (
        source === null ||
        !isThreadForkable(
          source,
          findCachedProviderInfo(queryClient, source.providerId)?.capabilities
            .supportsFork ?? false,
        ) ||
        forkInFlightRef.current
      ) {
        return;
      }

      forkInFlightRef.current = true;
      try {
        const executionOptions = await queryClient.fetchQuery({
          queryKey: threadDefaultExecutionOptionsQueryKey(source.id),
          queryFn: ({ signal }) =>
            sdk.threads.defaultExecutionOptions({
              signal,
              threadId: source.id,
            }),
        });
        if (executionOptions === null || source.environmentId === null) {
          return;
        }

        const seed: ForkThreadCreateSeed = {
          environmentId: source.environmentId,
          model: executionOptions.model,
          permissionMode: executionOptions.permissionMode,
          projectId: source.projectId,
          providerId: source.providerId,
          reasoningLevel: executionOptions.reasoningLevel,
          serviceTier: executionOptions.serviceTier,
          sourceSeqEnd: target.sourceSeqEnd,
          sourceThreadId: source.id,
          sourceThreadTitle: getThreadDisplayTitle(source),
        };
        setRootComposeProjectId(source.projectId);
        openNewDraft(
          { projectId: source.projectId },
          {
            state: {
              focusPrompt: true,
              reuseEnvironmentId: source.environmentId,
              [FORK_THREAD_CREATE_SEED_LOCATION_STATE_KEY]: seed,
            },
          },
        );
      } finally {
        forkInFlightRef.current = false;
      }
    },
    [openNewDraft, queryClient, setRootComposeProjectId],
  );
}
