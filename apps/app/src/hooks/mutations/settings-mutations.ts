import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  type AppKeybindingOverrides,
  type AppSettings,
  type AppThemeSelection,
  type Experiments,
} from "@bb/domain";
import * as api from "@/lib/api";
import {
  invalidateGeneralSettingsDependencies,
  invalidateSystemConfig,
} from "../cache-owners/system-cache-effects";
import {
  beginKeyboardSettingsCacheTransaction,
  rollbackKeyboardSettingsCacheTransaction,
} from "../cache-owners/system-config-cache-owner";

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
      invalidateGeneralSettingsDependencies({ queryClient });
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
    onMutate: (overrides) =>
      beginKeyboardSettingsCacheTransaction({ overrides, queryClient }),
    onError: (_error, _overrides, context) => {
      rollbackKeyboardSettingsCacheTransaction({
        queryClient,
        transaction: context,
      });
    },
    onSuccess: () => {
      invalidateSystemConfig({ queryClient });
    },
  });
}

/**
 * Set the complete app-wide appearance: the palette id (built-in id or custom
 * theme name) and favicon tint. Like experiments, the server broadcasts
 * `config-changed` for other windows; the local invalidation refreshes this one.
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
