import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { sdk } from "@/lib/sdk";
import { invalidateSavedThreadQueries } from "@/hooks/cache-owners/saved-thread-cache-owner";
import {
  savedThreadsQueryKey,
  type SavedThreadsFilters,
} from "@/hooks/queries/query-keys";

const SAVED_THREADS_LIMIT = 200;
const SAVING_REFRESH_MS = 5_000;

export function useSavedThreads(
  filters: SavedThreadsFilters,
  options: { enabled: boolean },
) {
  return useQuery({
    queryKey: savedThreadsQueryKey(filters),
    queryFn: ({ signal }) =>
      sdk.threads.experimental_listSaved({
        limit: SAVED_THREADS_LIMIT,
        ...(filters.projectId === null ? {} : { projectId: filters.projectId }),
        ...(filters.search.trim().length === 0
          ? {}
          : { search: filters.search.trim() }),
        signal,
      }),
    enabled: options.enabled,
    refetchInterval: (query) =>
      query.state.data?.savedThreads.some((entry) => entry.state !== "saved")
        ? SAVING_REFRESH_MS
        : false,
  });
}

function useSavedThreadMutation(
  key: string,
  errorMessage: string,
  run: (threadId: string) => Promise<unknown>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: [key],
    meta: { errorMessage },
    mutationFn: async ({ threadId }: { threadId: string }) => {
      await run(threadId);
    },
    onSettled: () => invalidateSavedThreadQueries({ queryClient }),
  });
}

export function useRestoreSavedThread() {
  return useSavedThreadMutation(
    "restore-saved-thread",
    "Failed to restore the saved thread.",
    (threadId) => sdk.threads.experimental_restoreSaved({ threadId }),
  );
}

export function useDeleteSavedThread() {
  return useSavedThreadMutation(
    "delete-saved-thread",
    "Failed to delete the saved thread.",
    (threadId) => sdk.threads.experimental_deleteSaved({ threadId }),
  );
}
