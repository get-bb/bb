import { useQuery } from "@tanstack/react-query";
import type { PluginUpdateJob } from "@bb/server-contract";
import { createPluginsClient } from "./plugin-client";
import { pluginUpdateJobsQueryKey } from "./query-keys";

export function isActivePluginUpdateJob(job: PluginUpdateJob): boolean {
  return job.state === "queued" || job.state === "running";
}

export function usePluginUpdateJobs() {
  return useQuery({
    queryKey: pluginUpdateJobsQueryKey(),
    queryFn: () => createPluginsClient(fetch).experimental_updateJobs.list(),
    refetchInterval: (query) =>
      query.state.data?.some(isActivePluginUpdateJob) ? 1000 : false,
  });
}

export function startPluginUpdate(pluginId: string): Promise<PluginUpdateJob> {
  return createPluginsClient(fetch).experimental_startUpdate({ pluginId });
}
