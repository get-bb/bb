import type {
  ThreadSectionMutationResponse,
  ThreadSectionResponse,
} from "@bb/server-contract";
import {
  useMutation,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { useProfileClient } from "@/app-shell/ProfilesProvider";
import {
  projectsQueryKey,
  sidebarNavigationQueryKey,
  threadSearchQueryKeyPrefix,
  threadsQueryKey,
} from "@/lib/query/query-keys";

/**
 * Thread section (manual-mode bucket) mutations over `/thread-sections`.
 * Section rows live in the sidebar bootstrap and thread membership in
 * `thread.sectionId`, so both list caches are invalidated. Name conflicts
 * come back as `BbHttpError` with code `section_name_conflict`; create and
 * rename render that inline (no global toast).
 */

function invalidateSectionQueries(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: projectsQueryKey() });
  void queryClient.invalidateQueries({ queryKey: sidebarNavigationQueryKey() });
  void queryClient.invalidateQueries({ queryKey: threadsQueryKey() });
  void queryClient.invalidateQueries({
    queryKey: threadSearchQueryKeyPrefix(),
  });
}

export function useCreateSection() {
  const { sdk } = useProfileClient();
  const queryClient = useQueryClient();
  return useMutation<ThreadSectionResponse, Error, { name: string }>({
    meta: { errorMessage: "Failed to create section.", showErrorToast: false },
    mutationFn: ({ name }) => sdk.threadSections.create({ name }),
    onSuccess: () => invalidateSectionQueries(queryClient),
  });
}

export function useRenameSection() {
  const { sdk } = useProfileClient();
  const queryClient = useQueryClient();
  return useMutation<
    ThreadSectionMutationResponse,
    Error,
    { id: string; name: string }
  >({
    meta: { errorMessage: "Failed to rename section.", showErrorToast: false },
    mutationFn: ({ id, name }) => sdk.threadSections.update({ id, name }),
    onSuccess: () => invalidateSectionQueries(queryClient),
  });
}

/** Threads in the section move back to Unorganized. */
export function useDeleteSection() {
  const { sdk } = useProfileClient();
  const queryClient = useQueryClient();
  return useMutation<ThreadSectionMutationResponse, Error, { id: string }>({
    meta: { errorMessage: "Failed to remove section." },
    mutationFn: ({ id }) => sdk.threadSections.delete({ id }),
    onSuccess: () => invalidateSectionQueries(queryClient),
  });
}
