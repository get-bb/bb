import type { QueryClient } from "@tanstack/react-query";
import {
  applyAppKeybindingOverrides,
  type AppKeybindingOverrides,
  type AppSettings,
  type ExperimentUpdates,
  type Experiments,
} from "@bb/domain";
import type {
  SystemAiServicesResponse,
  SystemConfigResponse,
} from "@bb/server-contract";
import {
  systemAiServicesQueryKey,
  systemConfigQueryKey,
} from "../queries/query-keys";

interface KeyboardSettingsCacheTransaction {
  previous: SystemConfigResponse | undefined;
}

export function markSystemConfigStale(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({
    exact: true,
    queryKey: systemConfigQueryKey(),
    refetchType: "none",
  });
}

interface BeginKeyboardSettingsCacheTransactionArgs {
  overrides: AppKeybindingOverrides;
  queryClient: QueryClient;
}

export async function beginKeyboardSettingsCacheTransaction({
  overrides,
  queryClient,
}: BeginKeyboardSettingsCacheTransactionArgs): Promise<KeyboardSettingsCacheTransaction> {
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
}

interface RollbackKeyboardSettingsCacheTransactionArgs {
  queryClient: QueryClient;
  transaction: KeyboardSettingsCacheTransaction | undefined;
}

export function rollbackKeyboardSettingsCacheTransaction({
  queryClient,
  transaction,
}: RollbackKeyboardSettingsCacheTransactionArgs): void {
  if (transaction?.previous === undefined) return;
  queryClient.setQueryData(systemConfigQueryKey(), transaction.previous);
}

export interface GeneralSettingsCacheTransaction {
  previous: AppSettings | undefined;
}

interface BeginGeneralSettingsCacheTransactionArgs {
  patch: Partial<AppSettings>;
  queryClient: QueryClient;
}

export async function beginGeneralSettingsCacheTransaction({
  patch,
  queryClient,
}: BeginGeneralSettingsCacheTransactionArgs): Promise<GeneralSettingsCacheTransaction> {
  const queryKey = systemConfigQueryKey();
  await queryClient.cancelQueries({ queryKey });
  const previous = queryClient.getQueryData<SystemConfigResponse>(queryKey);
  if (previous !== undefined) {
    queryClient.setQueryData<SystemConfigResponse>(queryKey, {
      ...previous,
      generalSettings: { ...previous.generalSettings, ...patch },
    });
  }
  return { previous: previous?.generalSettings };
}

interface RollbackGeneralSettingsCacheTransactionArgs {
  patch: Partial<AppSettings>;
  queryClient: QueryClient;
  transaction: GeneralSettingsCacheTransaction | undefined;
}

export function rollbackGeneralSettingsCacheTransaction({
  patch,
  queryClient,
  transaction,
}: RollbackGeneralSettingsCacheTransactionArgs): void {
  const previous = transaction?.previous;
  if (previous === undefined) return;
  const queryKey = systemConfigQueryKey();
  const current = queryClient.getQueryData<SystemConfigResponse>(queryKey);
  if (current === undefined) return;
  const reverted = Object.fromEntries(
    Object.entries(previous).filter(([key]) => Object.hasOwn(patch, key)),
  );
  queryClient.setQueryData<SystemConfigResponse>(queryKey, {
    ...current,
    generalSettings: { ...current.generalSettings, ...reverted },
  });
}

export function readCachedGeneralSettings(
  queryClient: QueryClient,
): AppSettings | undefined {
  return queryClient.getQueryData<SystemConfigResponse>(systemConfigQueryKey())
    ?.generalSettings;
}

export interface ExperimentsCacheTransaction {
  previous: Experiments | undefined;
}

interface BeginExperimentsCacheTransactionArgs {
  queryClient: QueryClient;
  updates: ExperimentUpdates;
}

export async function beginExperimentsCacheTransaction({
  queryClient,
  updates,
}: BeginExperimentsCacheTransactionArgs): Promise<ExperimentsCacheTransaction> {
  const queryKey = systemConfigQueryKey();
  await queryClient.cancelQueries({ queryKey });
  const previous = queryClient.getQueryData<SystemConfigResponse>(queryKey);
  if (previous !== undefined) {
    queryClient.setQueryData<SystemConfigResponse>(queryKey, {
      ...previous,
      experiments: { ...previous.experiments, ...updates },
    });
  }
  return { previous: previous?.experiments };
}

interface RollbackExperimentsCacheTransactionArgs {
  queryClient: QueryClient;
  transaction: ExperimentsCacheTransaction | undefined;
  updates: ExperimentUpdates;
}

export function rollbackExperimentsCacheTransaction({
  queryClient,
  transaction,
  updates,
}: RollbackExperimentsCacheTransactionArgs): void {
  const previous = transaction?.previous;
  if (previous === undefined) return;
  const queryKey = systemConfigQueryKey();
  const current = queryClient.getQueryData<SystemConfigResponse>(queryKey);
  if (current === undefined) return;
  const reverted = Object.fromEntries(
    Object.entries(previous).filter(([key]) => Object.hasOwn(updates, key)),
  );
  queryClient.setQueryData<SystemConfigResponse>(queryKey, {
    ...current,
    experiments: { ...current.experiments, ...reverted },
  });
}

export function writeCachedAiServices(
  queryClient: QueryClient,
  view: SystemAiServicesResponse,
): void {
  queryClient.setQueryData(systemAiServicesQueryKey(), view);
}
