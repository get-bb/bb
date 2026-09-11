import { useOpenNewThreadDraft } from "@/hooks/useOpenNewThreadDraft";
import { useCallback } from "react";
import { useSetRootComposeProjectId } from "@/lib/root-compose-selection";

interface UseCreateThreadInEnvironmentArgs {
  projectId: string;
  environmentId: string;
}

export function useCreateThreadInEnvironment({
  projectId,
  environmentId,
}: UseCreateThreadInEnvironmentArgs): () => void {
  const openNewDraft = useOpenNewThreadDraft();
  const setRootComposeProjectId = useSetRootComposeProjectId();
  return useCallback(() => {
    setRootComposeProjectId(projectId);
    openNewDraft(
      { projectId },
      {
        state: { reuseEnvironmentId: environmentId },
      },
    );
  }, [environmentId, openNewDraft, projectId, setRootComposeProjectId]);
}
