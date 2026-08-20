import type { AppCreateThreadRequest } from "@bb/client-core";
import type { ThreadResponse } from "@bb/server-contract";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useProfileClient } from "@/app-shell/ProfilesProvider";
import {
  projectSourceBranchesQueryKeyPrefix,
  sidebarNavigationQueryKey,
  threadQueryKey,
  threadSearchQueryKeyPrefix,
  threadsQueryKey,
} from "@/lib/query/query-keys";
import { insertThreadIntoCachedLists } from "./thread-list-cache";

export type { AppCreateThreadRequest } from "@bb/client-core";

function hasUnmanagedCheckoutIntent(request: AppCreateThreadRequest): boolean {
  return (
    request.environment.type === "host" &&
    request.environment.workspace.type === "unmanaged" &&
    request.environment.workspace.branch !== undefined
  );
}

/**
 * `POST /threads` for the app's own composers (mirrors the web
 * `useCreateThread`). Build the body with `buildCreateThreadRequest`
 * (src/data/compose). Resolves to the created thread; on success the thread
 * is written into the detail cache and inserted into every matching cached
 * list and the sidebar, then the lists refetch so the server's ordering wins.
 */
export function useCreateThread() {
  const { sdk } = useProfileClient();
  const queryClient = useQueryClient();
  return useMutation<ThreadResponse, Error, AppCreateThreadRequest>({
    meta: { errorMessage: "Failed to create thread." },
    mutationFn: (request) =>
      sdk.threads.spawn({
        ...request,
        origin: "app",
        originKind: request.originKind ?? null,
        startedOnBehalfOf: request.startedOnBehalfOf ?? null,
      }),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: threadsQueryKey() });
    },
    onSuccess: (thread, request) => {
      queryClient.setQueryData<ThreadResponse>(
        threadQueryKey(thread.id),
        thread,
      );
      insertThreadIntoCachedLists(queryClient, thread);
      if (hasUnmanagedCheckoutIntent(request)) {
        void queryClient.invalidateQueries({
          queryKey: projectSourceBranchesQueryKeyPrefix(request.projectId),
        });
      }
      void queryClient.refetchQueries({
        queryKey: threadsQueryKey(),
        type: "active",
      });
      void queryClient.refetchQueries({
        queryKey: sidebarNavigationQueryKey(),
        type: "active",
      });
      void queryClient.refetchQueries({
        queryKey: threadSearchQueryKeyPrefix(),
        type: "active",
      });
    },
  });
}
