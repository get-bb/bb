import { useQueries } from "@tanstack/react-query";
import { sdk } from "@/lib/sdk";
import { useProjectDetailRealtimeSubscription } from "@/hooks/useRealtimeSubscription";
import { projectSourceFoldersQueryKey } from "./query-keys";

interface UseProjectSourceFoldersArgs {
  projectId: string;
  sourceIds: readonly string[];
}

export function useProjectSourceFolders({
  projectId,
  sourceIds,
}: UseProjectSourceFoldersArgs) {
  useProjectDetailRealtimeSubscription(projectId, { enabled: true });
  return useQueries({
    queries: sourceIds.map((sourceId) => ({
      queryKey: projectSourceFoldersQueryKey(projectId, sourceId),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        sdk.projects.sources.folders.list({ projectId, sourceId, signal }),
      staleTime: 10_000,
    })),
  });
}
