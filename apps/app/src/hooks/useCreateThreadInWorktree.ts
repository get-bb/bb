import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { getRootComposeRoutePath } from "@/lib/route-paths";
import { useSetRootComposeProjectId } from "@/lib/root-compose-selection";

interface UseCreateThreadInWorktreeArgs {
  projectId: string;
  environmentId: string;
}

// Navigates to root compose and signals the env id via transient
// location.state. RootComposeView consumes it once on mount,
// seeds the picker to reuse mode for that env, and clears state — refresh
// reverts to the user's host-mode default. Reuse intent is never persisted
// to localStorage or to project-level server defaults.
export function useCreateThreadInWorktree({
  projectId,
  environmentId,
}: UseCreateThreadInWorktreeArgs): () => void {
  const navigate = useNavigate();
  const setRootComposeProjectId = useSetRootComposeProjectId();
  return useCallback(() => {
    setRootComposeProjectId(projectId);
    navigate(getRootComposeRoutePath(), {
      state: { reuseEnvironmentId: environmentId },
    });
  }, [environmentId, navigate, projectId, setRootComposeProjectId]);
}
