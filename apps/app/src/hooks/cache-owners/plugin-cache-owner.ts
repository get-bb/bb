import type { PluginUpdateJob } from "@bb/server-contract";
import { trackPluginUpdate } from "@/lib/plugin-update-tracking";
import type { QueryClient } from "@tanstack/react-query";
import {
  pluginListQueryOptions,
  type PluginSettingsView,
} from "../queries/plugin-settings-queries";
import type { InstalledPlugin, PluginInstallJob } from "@bb/server-contract";
import {
  allPluginCatalogSearchQueryKeyPrefix,
  allPluginListQueryKeyPrefix,
  pluginInstallJobsQueryKey,
  pluginUpdateJobsQueryKey,
  pluginListQueryKey,
  pluginMarketplacesQueryKey,
  pluginSafeModeQueryKey,
  pluginSettingsViewQueryKey,
} from "../queries/query-keys";

export function applyPluginSettingsView(args: {
  queryClient: QueryClient;
  pluginId: string;
  view: PluginSettingsView;
}): void {
  args.queryClient.setQueryData(
    pluginSettingsViewQueryKey(args.pluginId),
    args.view,
  );
}

export function applyInstalledPlugin(args: {
  queryClient: QueryClient;
  plugin: InstalledPlugin;
}): void {
  args.queryClient.setQueryData<InstalledPlugin[]>(
    pluginListQueryKey(true),
    (current) => {
      const plugins = current ?? [];
      const existingIndex = plugins.findIndex(
        (candidate) => candidate.id === args.plugin.id,
      );
      if (existingIndex === -1) {
        return [...plugins, args.plugin];
      }
      return plugins.map((candidate, index) =>
        index === existingIndex ? args.plugin : candidate,
      );
    },
  );
}

export function applyPluginInstallJob(args: {
  queryClient: QueryClient;
  job: PluginInstallJob;
}): void {
  args.queryClient.setQueryData<PluginInstallJob[]>(
    pluginInstallJobsQueryKey(),
    (current) => {
      const jobs = current ?? [];
      return jobs.some((candidate) => candidate.id === args.job.id)
        ? jobs.map((candidate) =>
            candidate.id === args.job.id ? args.job : candidate,
          )
        : [...jobs, args.job];
    },
  );
}

export function applyPluginSafeMode(args: {
  queryClient: QueryClient;
  enabled: boolean;
}): void {
  args.queryClient.setQueryData(pluginSafeModeQueryKey(), args.enabled);
}

export function invalidatePluginList(args: {
  queryClient: QueryClient;
}): Promise<void> {
  return args.queryClient.invalidateQueries({
    queryKey: allPluginListQueryKeyPrefix(),
  });
}

export async function markEnabledPluginListStale(args: {
  queryClient: QueryClient;
}): Promise<void> {
  const queryKey = pluginListQueryKey(true);
  if (args.queryClient.getQueryState(queryKey)?.fetchStatus === "fetching") {
    try {
      await args.queryClient.fetchQuery(
        pluginListQueryOptions({ enabled: true }),
      );
    } catch {}
  }
  await args.queryClient.invalidateQueries({
    exact: true,
    queryKey,
    refetchType: "none",
  });
}

export function invalidatePluginCatalogSearch(args: {
  queryClient: QueryClient;
}): void {
  void args.queryClient.invalidateQueries({
    queryKey: allPluginCatalogSearchQueryKeyPrefix(),
  });
}

export function invalidatePluginMarketplaces(args: {
  queryClient: QueryClient;
}): void {
  void args.queryClient.invalidateQueries({
    queryKey: pluginMarketplacesQueryKey(),
  });
  invalidatePluginCatalogSearch(args);
}

export function applyPluginUpdateJob(args: {
  queryClient: QueryClient;
  job: PluginUpdateJob;
}): void {
  trackPluginUpdate(args.job.id, true);
  args.queryClient.setQueryData<PluginUpdateJob[]>(
    pluginUpdateJobsQueryKey(),
    (current) => {
      const jobs = current ?? [];
      return jobs.some((job) => job.id === args.job.id)
        ? jobs.map((job) => (job.id === args.job.id ? args.job : job))
        : [...jobs, args.job];
    },
  );
}
