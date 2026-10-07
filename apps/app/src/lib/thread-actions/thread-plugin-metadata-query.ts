import { useQueries } from "@tanstack/react-query";
import type { JsonObject } from "@bb/domain";
import { threadPluginMetadataQueryKey } from "@/hooks/queries/query-keys";
import { sdk } from "@/lib/sdk";

const THREAD_PLUGIN_METADATA_STALE_TIME_MS = 30_000;

const NO_METADATA: ReadonlyMap<string, JsonObject | null> = new Map();

export function useThreadPluginMetadata(
  pluginIds: readonly string[],
  threadId: string,
): ReadonlyMap<string, JsonObject | null> {
  return useQueries({
    queries: pluginIds.map((pluginId) => ({
      queryKey: threadPluginMetadataQueryKey(pluginId, threadId),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        sdk.threads.getPluginMetadata({ pluginId, threadId, signal }),
      staleTime: THREAD_PLUGIN_METADATA_STALE_TIME_MS,
    })),
    combine: (results) => {
      if (results.length === 0) return NO_METADATA;
      return new Map(
        results.map((result, index) => [
          pluginIds[index] ?? "",
          result.data ?? null,
        ]),
      );
    },
  });
}
