import { systemEnvironmentProviderSchema } from "@bb/server-contract";
import { z } from "zod";
import { createLastKnownCache } from "@/lib/last-known-cache";

const environmentProviderListCache = createLastKnownCache({
  prefix: "bb.environment-provider-list",
  version: "1",
  schema: z.array(systemEnvironmentProviderSchema),
  maxEntries: 64,
});

export function environmentProviderListCacheKey({
  projectId,
  hostId,
}: {
  projectId: string | null;
  hostId: string | null;
}): string {
  return environmentProviderListCache.key(projectId, hostId);
}

export const readCachedEnvironmentProviderList =
  environmentProviderListCache.read;
export const writeCachedEnvironmentProviderList =
  environmentProviderListCache.write;
