import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Experiments } from "@bb/domain";
import * as api from "@/lib/api";
import { invalidateSystemConfig } from "../cache-owners/system-cache-effects";

/**
 * Replace the user's opt-in experiments (full object). The server broadcasts
 * system `config-changed` for other windows; the local invalidation gives this
 * window an immediate refresh.
 */
export function useUpdateExperiments() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: {
      errorMessage: "Failed to update experiments.",
    },
    mutationFn: (experiments: Experiments) =>
      api.updateExperiments(experiments),
    onSuccess: () => {
      invalidateSystemConfig({ queryClient });
    },
  });
}

/**
 * Set the app-wide color palette by id (built-in id or custom theme name). Like
 * experiments, the server broadcasts `config-changed` for other windows; the
 * local invalidation refreshes this one.
 */
export function useUpdateAppearance() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: {
      errorMessage: "Failed to update appearance.",
    },
    mutationFn: (themeId: string) => api.updateAppearance(themeId),
    onSuccess: () => {
      invalidateSystemConfig({ queryClient });
    },
  });
}
