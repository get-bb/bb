import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { sdk } from "@/lib/sdk";
import { usageSnapshotSchema } from "@/lib/usage-source-contract";

const method = "provider-usage.v1.get";
const discoveryKey = ["pluginRpcDiscovery", method] as const;
const sourceKey = (pluginId: string) =>
  ["pluginUsageSource", pluginId, method] as const;
let active = 0;
const waiting: Array<() => void> = [];

async function loadSource(
  pluginId: string,
  refresh: boolean,
  signal: AbortSignal,
) {
  if (active >= 3) await new Promise<void>((resolve) => waiting.push(resolve));
  else active++;
  try {
    signal.throwIfAborted();
    return await sdk.plugins.callRpc({
      pluginId,
      method,
      input: { refresh },
      outputSchema: usageSnapshotSchema,
      signal: AbortSignal.any([signal, AbortSignal.timeout(45_000)]),
    });
  } finally {
    const next = waiting.shift();
    if (next === undefined) active--;
    else next();
  }
}

export function useUsageSources() {
  const client = useQueryClient();
  const discovery = useQuery({
    queryKey: discoveryKey,
    queryFn: () => sdk.plugins.experimental_discoverRpc({ method }),
    staleTime: 10_000,
    refetchInterval: 30_000,
  });
  const sources = discovery.data ?? [];
  const queries = useQueries({
    queries: sources.map((source) => ({
      queryKey: sourceKey(source.pluginId),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        loadSource(source.pluginId, false, signal),
      staleTime: 30_000,
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
      const result = await discovery.refetch();
      await Promise.allSettled(
        (result.data ?? []).map((source) =>
          client.fetchQuery({
            queryKey: sourceKey(source.pluginId),
            queryFn: ({ signal }) => loadSource(source.pluginId, true, signal),
            staleTime: 0,
          }),
        ),
      );
    },
  };
}
