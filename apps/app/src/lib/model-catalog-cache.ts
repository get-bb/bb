import { availableModelSchema } from "@bb/domain";
import { z } from "zod";
import { createLastKnownCache } from "@/lib/last-known-cache";

const cachedModelCatalogSchema = z.object({
  models: z.array(availableModelSchema),
  selectedOnlyModels: z.array(availableModelSchema),
});

export type CachedModelCatalog = z.infer<typeof cachedModelCatalogSchema>;

/**
 * The last catalog a successful probe returned, keyed by the same routing
 * dimensions as the execution-options query: two hosts can be signed into
 * different accounts with different entitlements, and each provider reports
 * its own catalog. Used to preload the picker with real model ids rather than
 * a loading placeholder. A cached catalog can be stale, so callers must keep
 * reporting preloaded rows as provisional: only a fresh probe may retire a
 * stored selection.
 */
const modelCatalogCache = createLastKnownCache({
  prefix: "bb.model-catalog",
  version: "1",
  schema: cachedModelCatalogSchema,
});

export function modelCatalogCacheKey({
  environmentId,
  hostId,
  providerId,
}: {
  environmentId: string | null;
  hostId: string | null;
  providerId: string | null;
}): string {
  return modelCatalogCache.key(environmentId, hostId, providerId);
}

export const readCachedModelCatalog = modelCatalogCache.read;
export const writeCachedModelCatalog = modelCatalogCache.write;
