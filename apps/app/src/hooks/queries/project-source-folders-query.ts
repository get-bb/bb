import { useQuery } from "@tanstack/react-query";
import type { ProjectSourceFolder } from "@bb/domain";
import { sdk } from "@/lib/sdk";
import { useProjectDetailRealtimeSubscription } from "@/hooks/useRealtimeSubscription";
import { projectSourceFoldersQueryKey } from "./query-keys";

interface UseProjectSourceFoldersArgs {
  projectId: string;
  sourceId: string;
}

export function useProjectSourceFolders({
  projectId,
  sourceId,
}: UseProjectSourceFoldersArgs) {
  useProjectDetailRealtimeSubscription(projectId, { enabled: true });
  return useQuery<ProjectSourceFolder[]>({
    queryKey: projectSourceFoldersQueryKey(projectId, sourceId),
    queryFn: ({ signal }) =>
      sdk.projects.sources.experimental_folders.list({ projectId, sourceId, signal }),
    staleTime: 10_000,
  });
}
