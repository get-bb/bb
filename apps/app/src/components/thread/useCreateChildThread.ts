import { useCallback, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Thread } from "@bb/domain";
import { sdk } from "@/lib/sdk";
import { getThreadRoutePath } from "@/lib/route-paths";
import { useRouteNavigate } from "@/components/ui/app-route-anchor";
import { appToast } from "@/components/ui/app-toast";
import { useCreateThread } from "@/hooks/mutations/thread-runtime-mutations";
import { threadDefaultExecutionOptionsQueryKey } from "@/hooks/queries/query-keys";
import { findCachedProviderInfo } from "@/hooks/queries/system-queries";

export function useCreateChildThread(): (thread: Thread) => Promise<void> {
  const navigate = useRouteNavigate();
  const queryClient = useQueryClient();
  const createThread = useCreateThread();
  const createInFlightRef = useRef(false);

  return useCallback(
    async (thread: Thread) => {
      if (createInFlightRef.current) {
        return;
      }
      if (thread.environmentId === null) {
        appToast.error("Could not create child thread", {
          description:
            "This thread has no workspace yet, so a child cannot reuse it.",
        });
        return;
      }

      createInFlightRef.current = true;
      try {
        const executionOptions = await queryClient.fetchQuery({
          queryKey: threadDefaultExecutionOptionsQueryKey(thread.id),
          queryFn: ({ signal }) =>
            sdk.threads.defaultExecutionOptions({
              signal,
              threadId: thread.id,
            }),
        });
        if (executionOptions === null) {
          appToast.error("Could not create child thread", {
            description: "The parent thread's execution defaults are unavailable.",
          });
          return;
        }

        const supportsServiceTier =
          findCachedProviderInfo(queryClient, thread.providerId)?.capabilities
            .supportsServiceTier ?? false;
        const created = await createThread.mutateAsync({
          environment: {
            type: "reuse",
            environmentId: thread.environmentId,
          },
          input: [],
          model: executionOptions.model,
          originKind: null,
          parentThreadId: thread.id,
          permissionMode: executionOptions.permissionMode,
          projectId: thread.projectId,
          providerId: thread.providerId,
          reasoningLevel: executionOptions.reasoningLevel,
          ...(supportsServiceTier && executionOptions.serviceTier
            ? { serviceTier: executionOptions.serviceTier }
            : {}),
          startedOnBehalfOf: null,
        });
        navigate(
          getThreadRoutePath({
            projectId: created.projectId,
            threadId: created.id,
          }),
        );
      } catch {
        // useCreateThread reports the failure through its mutation meta toast.
      } finally {
        createInFlightRef.current = false;
      }
    },
    [createThread, navigate, queryClient],
  );
}
