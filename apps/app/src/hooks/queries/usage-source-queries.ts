import { normalizeUsageMeasurement } from "@/lib/usage-normalization";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { sdk } from "@/lib/sdk";
import {
  usageListMethod,
  usageFetchMethod,
  usageResourceListSchema,
  usageMeasurementSchema,
} from "@/lib/usage-source-contract";

const discoveryKey = ["pluginRpcDiscovery", usageListMethod] as const;
const sourceKey = (pluginId: string) =>
  ["pluginUsageInventory", pluginId] as const;
const resourceKey = (pluginId: string, resourceId: string) =>
  ["pluginUsageMeasurement", pluginId, resourceId] as const;
let active = 0;
const waiting: Array<() => void> = [];

async function loadResource(
  pluginId: string,
  resourceId: string,
  refresh: boolean,
  signal: AbortSignal,
) {
  if (active >= 3) await new Promise<void>((resolve) => waiting.push(resolve));
  else active++;
  try {
    signal.throwIfAborted();
    const value = normalizeUsageMeasurement(
      await sdk.plugins.callRpc({
        pluginId,
        method: usageFetchMethod,
        input: { resourceId, refresh },
        outputSchema: usageMeasurementSchema,
        signal: AbortSignal.any([signal, AbortSignal.timeout(45_000)]),
      }),
    );
    if (value.usage.status === "error")
      throw new Error("Usage could not be refreshed.");
    return value;
  } finally {
    const next = waiting.shift();
    if (next === undefined) active--;
    else next();
  }
}

export function useUsageSources() {
  const discovery = useQuery({
    queryKey: discoveryKey,
    queryFn: () =>
      sdk.plugins.experimental_discoverRpc({ method: usageListMethod }),
    staleTime: 10_000,
    refetchInterval: 30_000,
  });
  const sources = discovery.data ?? [];
  const queries = useQueries({
    queries: sources.map((source) => ({
      queryKey: sourceKey(source.pluginId),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        sdk.plugins.callRpc({
          pluginId: source.pluginId,
          method: usageListMethod,
          input: {},
          outputSchema: usageResourceListSchema,
          signal: AbortSignal.any([signal, AbortSignal.timeout(45_000)]),
        }),
      staleTime: 30_000,
      refetchInterval: 30_000,
      retry: false,
    })),
  });
  return {
    discovery,
    sources: sources.map((source, index) => ({
      source,
      query: queries[index]!,
    })),
    isFetching:
      discovery.isFetching || queries.some((query) => query.isFetching),
    async refresh() {
      await discovery.refetch();
      await Promise.allSettled(queries.map((query) => query.refetch()));
    },
  };
}

export function useUsageMeasurements(
  resources: Array<{ pluginId: string; resourceId: string }>,
) {
  const client = useQueryClient();
  const queries = useQueries({
    queries: resources.map(({ pluginId, resourceId }) => ({
      queryKey: resourceKey(pluginId, resourceId),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        loadResource(pluginId, resourceId, false, signal),
      staleTime: 30_000,
      retry: false,
    })),
  });
  return {
    queries,
    isFetching: queries.some((query) => query.isFetching),
    async refresh() {
      await Promise.allSettled(
        resources.map(({ pluginId, resourceId }) =>
          client.fetchQuery({
            queryKey: resourceKey(pluginId, resourceId),
            queryFn: ({ signal }) =>
              loadResource(pluginId, resourceId, true, signal),
            staleTime: 0,
          }),
        ),
      );
    },
  };
}
