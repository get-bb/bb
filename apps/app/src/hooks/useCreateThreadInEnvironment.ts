import { useCallback } from "react";
import { useOpenNewThread } from "@/hooks/useOpenNewThread";

interface UseCreateThreadInEnvironmentArgs {
  projectId: string;
  environmentId: string;
  sectionId: string | null;
  pinned: boolean;
}

export function useCreateThreadInEnvironment({
  projectId,
  environmentId,
  sectionId,
  pinned,
}: UseCreateThreadInEnvironmentArgs): () => void {
  const openNewThread = useOpenNewThread();
  return useCallback(() => {
    openNewThread({
      projectId,
      environmentId,
      placement: { sectionId, pinned },
      focusPrompt: true,
    });
  }, [environmentId, openNewThread, projectId, sectionId, pinned]);
}
