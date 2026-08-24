import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  type AppKeybindingOverrides,
  type AppSettings,
  type AppThemeSelection,
  type Experiments,
} from "@bb/domain";
import type { SystemInstallCliSkillsRequest } from "@bb/server-contract";
import { sdk } from "@/lib/sdk";
import {
  invalidateGeneralSettingsDependencies,
  invalidateSystemConfig,
  invalidateSystemProviders,
  resetModelCatalogsAfterStreamerModeChange,
} from "../cache-owners/system-cache-effects";
import {
  beginKeyboardSettingsCacheTransaction,
  readCachedProviderOrder,
  readCachedStreamerMode,
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
      sdk.system.updateExperiments(experiments),
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
    mutationFn: (settings: AppSettings) =>
      sdk.system.updateGeneralSettings(settings),
    onSuccess: (_settings, written) => {
      // Read the previous values before the config invalidation replaces them.
      const previousStreamerMode = readCachedStreamerMode(queryClient);
      const previousProviderOrder = readCachedProviderOrder(queryClient);
      invalidateGeneralSettingsDependencies({ queryClient });
      // An unknown previous value also resets: a stale preload is the risk.
      if (previousStreamerMode !== written.streamerMode) {
        void resetModelCatalogsAfterStreamerModeChange({ queryClient });
      }
      const providerOrderChanged =
        previousProviderOrder === undefined ||
        previousProviderOrder.length !== written.providerOrder.length ||
        previousProviderOrder.some(
          (providerId, index) => providerId !== written.providerOrder[index],
        );
      if (providerOrderChanged) {
        // Keep the reorder mutation pending until the server-sorted directory
        // replaces the optimistic row order.
        return invalidateSystemProviders({ queryClient });
      }
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
      sdk.system.updateKeyboardSettings(overrides),
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
 * Copy bb's built-in CLI skills into the chosen machines' global agent skill
 * roots so agents outside bb can drive it. Purely a filesystem action on those
 * machines — nothing in the system config changes, so nothing is invalidated.
 */
export function useInstallCliSkills() {
  return useMutation({
    meta: {
      errorMessage: "Failed to install the bb CLI skills.",
    },
    mutationFn: (args: SystemInstallCliSkillsRequest) =>
      sdk.system.installCliSkills(args),
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
    mutationFn: (selection: AppThemeSelection) => sdk.theme.set(selection),
    onSuccess: () => {
      invalidateSystemConfig({ queryClient });
    },
  });
}
