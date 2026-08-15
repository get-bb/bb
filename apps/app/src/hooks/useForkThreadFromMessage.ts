import { useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import type { Thread } from "@bb/domain";
import { sdk } from "@/lib/sdk";
import {
  FORK_THREAD_CREATE_SEED_LOCATION_STATE_KEY,
  isThreadForkable,
  type ForkThreadCreateSeed,
} from "@/lib/fork-thread-request";
import { getRootComposeRoutePath } from "@/lib/route-paths";
import { getThreadDisplayTitle } from "@/lib/thread-title";
import { useSetRootComposeProjectId } from "@/lib/root-compose-selection";
import { threadDefaultExecutionOptionsQueryKey } from "@/hooks/queries/query-keys";
import { findCachedProviderInfo } from "@/hooks/queries/system-queries";

export interface UseForkThreadFromMessageArgs {
  /** Source thread the fork branches from. Null until the thread loads. */
  sourceThread: Thread | null;
}

export interface ForkThreadFromMessageTarget {
  sourceSeqEnd: number;
}

export function useForkThreadFromMessage({
  sourceThread,
}: UseForkThreadFromMessageArgs): (
  target: ForkThreadFromMessageTarget,
) => Promise<void> {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const setRootComposeProjectId = useSetRootComposeProjectId();
  const forkInFlightRef = useRef(false);

  return useCallback(async (target: ForkThreadFromMessageTarget) => {
    if (
      sourceThread === null ||
      !isThreadForkable(
        sourceThread,
        findCachedProviderInfo(queryClient, sourceThread.providerId)
          ?.capabilities.supportsFork ?? false,
      ) ||
      forkInFlightRef.current
    ) {
      return;
    }

    forkInFlightRef.current = true;
    try {
      const executionOptions = await queryClient.fetchQuery({
        queryKey: threadDefaultExecutionOptionsQueryKey(sourceThread.id),
        queryFn: ({ signal }) =>
          sdk.threads.defaultExecutionOptions({
            signal,
            threadId: sourceThread.id,
          }),
      });
      if (executionOptions === null || sourceThread.environmentId === null) {
        return;
      }

      const seed: ForkThreadCreateSeed = {
        environmentId: sourceThread.environmentId,
        model: executionOptions.model,
        permissionMode: executionOptions.permissionMode,
        projectId: sourceThread.projectId,
        providerId: sourceThread.providerId,
        reasoningLevel: executionOptions.reasoningLevel,
        serviceTier: executionOptions.serviceTier,
        sourceSeqEnd: target.sourceSeqEnd,
        sourceThreadId: sourceThread.id,
        sourceThreadTitle: getThreadDisplayTitle(sourceThread),
      };
      setRootComposeProjectId(sourceThread.projectId);
      navigate(getRootComposeRoutePath(), {
        state: {
          focusPrompt: true,
          reuseEnvironmentId: sourceThread.environmentId,
          [FORK_THREAD_CREATE_SEED_LOCATION_STATE_KEY]: seed,
        },
      });
    } finally {
      forkInFlightRef.current = false;
    }
  }, [navigate, queryClient, setRootComposeProjectId, sourceThread]);
}
