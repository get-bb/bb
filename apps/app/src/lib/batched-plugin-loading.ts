import type { SystemConfigResponse } from "@bb/server-contract";
import { systemConfigQueryKey } from "@/hooks/queries/query-keys";
import { appQueryClient } from "./app-query-client";

let enabled: boolean | null = null;

export function batchedPluginLoadingEnabled(): boolean {
  if (enabled !== null) return enabled;
  const config = appQueryClient.getQueryData<SystemConfigResponse>(
    systemConfigQueryKey(),
  );
  if (config === undefined) return false;
  enabled = config.experiments.batchedPluginLoading;
  return enabled;
}
