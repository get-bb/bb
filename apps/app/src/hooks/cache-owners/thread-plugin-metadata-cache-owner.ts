import type { QueryClient } from "@tanstack/react-query";
import type { JsonObject } from "@bb/domain";
import { threadPluginMetadataQueryKey } from "../queries/query-keys";

export function invalidateCachedThreadPluginMetadata(
  queryClient: QueryClient,
  pluginId: string,
  threadId: string,
): void {
  queryClient.invalidateQueries({
    queryKey: threadPluginMetadataQueryKey(pluginId, threadId),
  });
}

export function setCachedThreadPluginMetadata(
  queryClient: QueryClient,
  pluginId: string,
  threadId: string,
  metadata: JsonObject,
): void {
  queryClient.setQueryData(
    threadPluginMetadataQueryKey(pluginId, threadId),
    metadata,
  );
}
