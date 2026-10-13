import { useCallback, useLayoutEffect, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Thread } from "@bb/domain";
import { sdk } from "@/lib/sdk";
import { isThreadForkable, type AppCreateThreadRequest } from "@bb/client-core";
import type { ThreadRoutePathArgs } from "@/lib/route-paths";
import { threadDefaultExecutionOptionsQueryKey } from "@/hooks/queries/query-keys";
import { findCachedProviderInfo } from "@/hooks/queries/system-queries";
import {
  applyCreateThreadResult,
  beginCreateThreadTransaction,
} from "@/hooks/cache-owners/thread-runtime-cache-owner";

interface UseForkThreadFromMessageArgs {
  navigateInPane: (thread: ThreadRoutePathArgs) => void;
  sourceThread: Thread | null;
}

interface ForkThreadFromMessageTarget {
  sourceSeqEnd: number;
}

export function useForkThreadFromMessage({
  navigateInPane,
  sourceThread,
}: UseForkThreadFromMessageArgs): (
  target: ForkThreadFromMessageTarget,
) => Promise<void> {
  const queryClient = useQueryClient();
  const forkThread = useMutation({
    meta: {
      errorMessage: "Failed to fork thread.",
      lifecycleOperation: "create_thread",
    },
    mutationFn: (request: AppCreateThreadRequest) =>
      sdk.threads.spawn({
        ...request,
        origin: "app",
        originKind: "fork",
        startedOnBehalfOf: null,
      }),
    onMutate: async () => beginCreateThreadTransaction({ queryClient }),
    onSuccess: (thread, request) => {
      applyCreateThreadResult({ queryClient, request, thread });
    },
  });
  const forkThreadRef = useRef(forkThread.mutateAsync);
  const forkInFlightRef = useRef(false);
  const sourceThreadRef = useRef(sourceThread);
  const navigateInPaneRef = useRef(navigateInPane);
  useLayoutEffect(() => {
    forkThreadRef.current = forkThread.mutateAsync;
    sourceThreadRef.current = sourceThread;
    navigateInPaneRef.current = navigateInPane;
  }, [forkThread.mutateAsync, navigateInPane, sourceThread]);

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

        const fork = await forkThreadRef.current({
          environment: { type: "reuse", environmentId: source.environmentId },
          input: [],
          model: executionOptions.model,
          originKind: "fork",
          permissionMode: executionOptions.permissionMode,
          pinned: source.pinnedAt !== null,
          projectId: source.projectId,
          providerId: source.providerId,
          reasoningLevel: executionOptions.reasoningLevel,
          sectionId: source.sectionId,
          ...(executionOptions.serviceTier
            ? { serviceTier: executionOptions.serviceTier }
            : {}),
          sourceSeqEnd: target.sourceSeqEnd,
          sourceThreadId: source.id,
          startedOnBehalfOf: null,
        });
        navigateInPaneRef.current({
          projectId: fork.projectId,
          threadId: fork.id,
        });
      } catch {
        return;
      } finally {
        forkInFlightRef.current = false;
      }
    },
    [queryClient],
  );
}
