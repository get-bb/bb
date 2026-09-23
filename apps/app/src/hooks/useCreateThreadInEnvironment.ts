import { useCallback } from "react";
import { useRouteNavigate } from "@/components/ui/app-route-anchor";
import { getRootComposeRoutePath } from "@/lib/route-paths";
import { useSetRootComposeProjectId } from "@/lib/root-compose-selection";

interface UseCreateThreadInEnvironmentArgs {
  projectId: string;
  environmentId: string;
  sectionId: string | null;
}

export function useCreateThreadInEnvironment({
  projectId,
  environmentId,
  sectionId,
}: UseCreateThreadInEnvironmentArgs): () => void {
  const navigate = useRouteNavigate();
  const setRootComposeProjectId = useSetRootComposeProjectId();
  return useCallback(() => {
    setRootComposeProjectId(projectId);
    navigate(getRootComposeRoutePath(), {
      state: {
        focusPrompt: true,
        reuseEnvironmentId: environmentId,
        sectionId,
      },
    });
  }, [environmentId, navigate, projectId, sectionId, setRootComposeProjectId]);
}
