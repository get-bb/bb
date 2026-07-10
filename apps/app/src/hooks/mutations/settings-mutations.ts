import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  applyAppKeybindingOverrides,
  type AppKeybindingOverrides,
  type AppSettings,
  type AppThemeSelection,
  type Experiments,
} from "@bb/domain";
import type { SystemConfigResponse } from "@bb/server-contract";
import * as api from "@/lib/api";
import { invalidateSystemConfig } from "../cache-owners/system-cache-effects";
import { systemConfigQueryKey } from "../queries/query-keys";

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
 * Replace the user's server-backed Settings → General preferences. The server
 * broadcasts `config-changed` for other windows; the local invalidation gives
 * this window an immediate refresh.
 */
export function useUpdateGeneralSettings() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: {
      errorMessage: "Failed to update general settings.",
    },
    mutationFn: (settings: AppSettings) => api.updateGeneralSettings(settings),
    onSuccess: () => {
      invalidateSystemConfig({ queryClient });
    },
  });
}

/** Replace the sparse server-backed keyboard overrides for every app window. */
export function useUpdateKeyboardSettings() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: {
      errorMessage: "Failed to update keyboard shortcuts.",
    },
    mutationFn: (overrides: AppKeybindingOverrides) =>
      api.updateKeyboardSettings(overrides),
    onMutate: async (overrides) => {
      const queryKey = systemConfigQueryKey();
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<SystemConfigResponse>(queryKey);
      if (previous !== undefined) {
        queryClient.setQueryData<SystemConfigResponse>(queryKey, {
          ...previous,
          keybindings: applyAppKeybindingOverrides(
            previous.defaultKeybindings,
            overrides,
          ),
          keybindingOverrides: overrides,
        });
      }
      return { previous };
    },
    onError: (_error, _overrides, context) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData(systemConfigQueryKey(), context.previous);
      }
    },
    onSuccess: () => {
      invalidateSystemConfig({ queryClient });
    },
  });
}

/**
 * Set the app-wide appearance: the palette id (built-in id or custom theme name)
 * and optionally the favicon tint (omit to leave it unchanged). Like
 * experiments, the server broadcasts `config-changed` for other windows; the
 * local invalidation refreshes this one.
 */
export function useUpdateAppearance() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: {
      errorMessage: "Failed to update appearance.",
    },
    mutationFn: (selection: AppThemeSelection) =>
      api.updateAppearance(selection),
    onSuccess: () => {
      invalidateSystemConfig({ queryClient });
    },
  });
}
