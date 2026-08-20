import type { AppSettings, AppThemeSelection, Experiments } from "@bb/domain";
import type { SystemConfigResponse } from "@bb/server-contract";
import {
  useMutation,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { useProfileClient } from "@/app-shell/ProfilesProvider";
import {
  allProjectDefaultExecutionOptionsQueryKeyPrefix,
  allSystemExecutionOptionsQueryKeyPrefix,
  systemConfigQueryKey,
} from "@/lib/query/query-keys";

/**
 * Server-backed settings writes (mirror of
 * apps/app/src/hooks/mutations/settings-mutations.ts). Each `PUT /settings/*`
 * replaces the whole object, so callers spread the current value and flip
 * one field. A toggle is written into the cached `/system/config` first and
 * rolled back on failure: the native switch must not lag the finger, and the
 * server broadcasts `config-changed` for the authoritative refetch anyway.
 */

interface ConfigTransaction {
  previous: SystemConfigResponse | undefined;
}

function beginConfigTransaction(
  queryClient: QueryClient,
  patch: Partial<SystemConfigResponse>,
): ConfigTransaction {
  const previous = queryClient.getQueryData<SystemConfigResponse>(
    systemConfigQueryKey(),
  );
  if (previous !== undefined) {
    queryClient.setQueryData<SystemConfigResponse>(systemConfigQueryKey(), {
      ...previous,
      ...patch,
    });
  }
  return { previous };
}

function rollbackConfigTransaction(
  queryClient: QueryClient,
  transaction: ConfigTransaction | undefined,
): void {
  if (transaction?.previous !== undefined) {
    queryClient.setQueryData(systemConfigQueryKey(), transaction.previous);
  }
}

function invalidateSystemConfig(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: systemConfigQueryKey() });
}

/** Replace the user's opt-in experiments (full object). */
export function useUpdateExperiments() {
  const { sdk } = useProfileClient();
  const queryClient = useQueryClient();
  return useMutation<Experiments, Error, Experiments, ConfigTransaction>({
    meta: { errorMessage: "Failed to update experiments." },
    mutationFn: (experiments) => sdk.system.updateExperiments(experiments),
    onMutate: (experiments) =>
      beginConfigTransaction(queryClient, { experiments }),
    onError: (_error, _experiments, transaction) => {
      rollbackConfigTransaction(queryClient, transaction);
    },
    onSuccess: (experiments) => {
      beginConfigTransaction(queryClient, { experiments });
    },
    onSettled: () => invalidateSystemConfig(queryClient),
  });
}

/**
 * Replace the server-backed Settings → General preferences. Provider memory /
 * subagent / workflow toggles live here too and change what the server
 * injects into sessions, so the execution-option caches refresh as well.
 */
export function useUpdateGeneralSettings() {
  const { sdk } = useProfileClient();
  const queryClient = useQueryClient();
  return useMutation<AppSettings, Error, AppSettings, ConfigTransaction>({
    meta: { errorMessage: "Failed to update general settings." },
    mutationFn: (settings) => sdk.system.updateGeneralSettings(settings),
    onMutate: (generalSettings) =>
      beginConfigTransaction(queryClient, { generalSettings }),
    onError: (_error, _settings, transaction) => {
      rollbackConfigTransaction(queryClient, transaction);
    },
    onSuccess: (generalSettings) => {
      beginConfigTransaction(queryClient, { generalSettings });
      void queryClient.invalidateQueries({
        queryKey: allSystemExecutionOptionsQueryKeyPrefix(),
      });
      void queryClient.invalidateQueries({
        queryKey: allProjectDefaultExecutionOptionsQueryKeyPrefix(),
      });
    },
    onSettled: () => invalidateSystemConfig(queryClient),
  });
}

/**
 * Set the app-wide appearance (palette id + favicon tint) in one request
 * (`PUT /settings/appearance`). The palette the phone renders follows the
 * refetched `/system/config` (`ServerPaletteSync`), so no local write here.
 */
export function useUpdateAppearance() {
  const { sdk } = useProfileClient();
  const queryClient = useQueryClient();
  return useMutation({
    meta: { errorMessage: "Failed to update appearance." },
    mutationFn: (selection: AppThemeSelection) => sdk.theme.set(selection),
    onSuccess: (appearance) => {
      beginConfigTransaction(queryClient, { appearance });
      invalidateSystemConfig(queryClient);
    },
  });
}
