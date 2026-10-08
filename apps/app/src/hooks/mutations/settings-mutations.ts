import {
  type QueryClient,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import {
  type AppKeybindingOverrides,
  type AppSettings,
  type AppThemeSelection,
  type ExperimentUpdates,
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
  beginExperimentsCacheTransaction,
  beginGeneralSettingsCacheTransaction,
  beginKeyboardSettingsCacheTransaction,
  readCachedGeneralSettings,
  rollbackExperimentsCacheTransaction,
  rollbackGeneralSettingsCacheTransaction,
  rollbackKeyboardSettingsCacheTransaction,
} from "../cache-owners/system-config-cache-owner";

const optimisticSettingsMutationKey = ["system", "settings"] as const;
const generalSettingsMutationKey = [
  ...optimisticSettingsMutationKey,
  "general",
] as const;
const experimentsMutationKey = [
  ...optimisticSettingsMutationKey,
  "experiments",
] as const;

function isLastPendingSettingsWrite(queryClient: QueryClient): boolean {
  return (
    queryClient.isMutating({ mutationKey: optimisticSettingsMutationKey }) === 1
  );
}

export function useUpdateExperiments() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: experimentsMutationKey,
    meta: {
      errorMessage: "Failed to update experiments.",
    },
    mutationFn: (updates: ExperimentUpdates) =>
      sdk.system.updateExperiments(updates),
    onMutate: (updates) =>
      beginExperimentsCacheTransaction({ queryClient, updates }),
    onError: (_error, updates, transaction) => {
      rollbackExperimentsCacheTransaction({
        queryClient,
        transaction,
        updates,
      });
      if (isLastPendingSettingsWrite(queryClient)) {
        invalidateSystemConfig({ queryClient });
      }
    },
    onSuccess: () => {
      if (isLastPendingSettingsWrite(queryClient)) {
        invalidateSystemConfig({ queryClient });
      }
    },
  });
}

export function useUpdateGeneralSettings() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: generalSettingsMutationKey,
    scope: { id: generalSettingsMutationKey.join(":") },
    meta: {
      errorMessage: "Failed to update general settings.",
    },
    mutationFn: (patch: Partial<AppSettings>) => {
      const settings = readCachedGeneralSettings(queryClient);
      if (settings === undefined) {
        throw new Error("General settings have not loaded yet.");
      }
      return sdk.system.updateGeneralSettings({ ...settings, ...patch });
    },
    onMutate: (patch) =>
      beginGeneralSettingsCacheTransaction({ patch, queryClient }),
    onError: (_error, patch, transaction) => {
      rollbackGeneralSettingsCacheTransaction({
        patch,
        queryClient,
        transaction,
      });
      if (isLastPendingSettingsWrite(queryClient)) {
        invalidateSystemConfig({ queryClient });
      }
    },
    onSuccess: (_settings, patch, transaction) => {
      const previous = transaction.previous;
      invalidateGeneralSettingsDependencies({
        includeSystemConfig: isLastPendingSettingsWrite(queryClient),
        queryClient,
      });
      if (
        patch.streamerMode !== undefined &&
        patch.streamerMode !== previous?.streamerMode
      ) {
        void resetModelCatalogsAfterStreamerModeChange({ queryClient });
      }
      const nextProviderOrder = patch.providerOrder;
      if (nextProviderOrder === undefined) return;
      const providerOrderChanged =
        previous === undefined ||
        previous.providerOrder.length !== nextProviderOrder.length ||
        previous.providerOrder.some(
          (providerId, index) => providerId !== nextProviderOrder[index],
        );
      if (providerOrderChanged) {
        return invalidateSystemProviders({ queryClient });
      }
    },
  });
}

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

export function useInstallCliSkills() {
  return useMutation({
    meta: {
      errorMessage: "Failed to install the bb CLI skills.",
    },
    mutationFn: (args: SystemInstallCliSkillsRequest) =>
      sdk.system.installCliSkills(args),
  });
}

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
