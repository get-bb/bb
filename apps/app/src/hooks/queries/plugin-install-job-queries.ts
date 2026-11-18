import type {
  PluginCatalogResolvedSource,
  PluginInstallJob,
} from "@bb/server-contract";
import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { applyPluginInstallJob } from "../cache-owners/plugin-cache-owner";
import {
  catalogEntryListings,
  type PluginCatalogSearchEntry,
} from "./plugin-catalog-queries";
import { createPluginsClient } from "./plugin-client";
import { pluginInstallJobsQueryKey } from "./query-keys";

type FetchLike = typeof fetch;

export type ActivePluginInstallJob = Extract<
  PluginInstallJob,
  { state: "queued" | "running" | "cancelling" }
>;

export function isActivePluginInstallJob(
  job: PluginInstallJob,
): job is ActivePluginInstallJob {
  return (
    job.state === "queued" ||
    job.state === "running" ||
    job.state === "cancelling"
  );
}

const pluginInstallJobsQueryOptions = queryOptions({
  queryKey: pluginInstallJobsQueryKey(),
  queryFn: () => createPluginsClient(fetch).installJobs.list(),
});

export function usePluginInstallJobs() {
  return useQuery(pluginInstallJobsQueryOptions);
}

export function startPluginInstall(
  fetchImpl: FetchLike,
  source: string,
): Promise<PluginInstallJob> {
  return createPluginsClient(fetchImpl).startInstall({ source });
}

export function startCatalogPluginInstall(
  fetchImpl: FetchLike,
  args: {
    entryId: string;
    marketplace?: string;
    confirmedSource?: PluginCatalogResolvedSource;
  },
): Promise<PluginInstallJob> {
  return createPluginsClient(fetchImpl).catalog.startInstall(args);
}

export function useCancelPluginInstallJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (jobId: string) =>
      createPluginsClient(fetch).installJobs.cancel({ jobId }),
    onSuccess: (job) => applyPluginInstallJob({ queryClient, job }),
  });
}

export function useCatalogEntryInstallJob(
  entry: Pick<PluginCatalogSearchEntry, "marketplace" | "entryId" | "listings">,
): ActivePluginInstallJob | null {
  const listings = catalogEntryListings(entry);
  const { data } = useQuery({
    ...pluginInstallJobsQueryOptions,
    select: (jobs) =>
      jobs.filter(isActivePluginInstallJob).find(({ target }) => {
        if (target.kind !== "catalog") return false;
        return listings.some(
          (listing) =>
            listing.marketplace === target.marketplace &&
            listing.entryId === target.entryId,
        );
      }) ?? null,
  });
  return data ?? null;
}

export function usePluginInstallJob(jobId: string | null) {
  const { data } = useQuery({
    ...pluginInstallJobsQueryOptions,
    enabled: jobId !== null,
    select: (jobs) => jobs.find((job) => job.id === jobId) ?? null,
  });
  return data ?? null;
}
