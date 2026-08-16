import { availableModelSchema, providerInfoSchema } from "@bb/domain";
import { z } from "zod";
import { createJsonLocalStorage } from "@/lib/browser-storage";

const MODEL_CATALOG_CACHE_PREFIX = "bb.model-catalog";
const MODEL_CATALOG_CACHE_VERSION = "1";

const cachedModelCatalogSchema = z.object({
  models: z.array(availableModelSchema),
  selectedOnlyModels: z.array(availableModelSchema),
  /**
   * The provider set the last successful probe reported, so the preload
   * window shows this install's real providers (including plugin-registered
   * ones) instead of a static list.
   */
  providers: z.array(providerInfoSchema).optional(),
});

export type CachedModelCatalog = z.infer<typeof cachedModelCatalogSchema>;

interface ModelCatalogCacheKeyArgs {
  environmentId: string | null;
  hostId: string | null;
  providerId: string | null;
}

const catalogStorage = createJsonLocalStorage<unknown>();

/**
 * Scoped to the same routing dimensions as the execution-options query: two
 * hosts can be signed into different accounts with different entitlements, and
 * each provider reports its own catalog. The version segment lets a shape
 * change invalidate old entries instead of relying on the parse below to
 * reject every one of them.
 */
export function modelCatalogCacheKey({
  environmentId,
  hostId,
  providerId,
}: ModelCatalogCacheKeyArgs): string {
  return [
    MODEL_CATALOG_CACHE_PREFIX,
    MODEL_CATALOG_CACHE_VERSION,
    environmentId ?? "-",
    hostId ?? "-",
    providerId ?? "-",
  ].join(".");
}

/**
 * The last catalog a successful probe returned for this routing, used to
 * preload the picker with real model ids rather than a loading placeholder. A
 * cached catalog can be stale, so callers must keep reporting preloaded rows as
 * provisional: only a fresh probe may retire a stored selection.
 */
export function readCachedModelCatalog(key: string): CachedModelCatalog | null {
  const stored = catalogStorage.getItem(key, null);
  if (stored === null) {
    return null;
  }
  const parsed = cachedModelCatalogSchema.safeParse(stored);
  return parsed.success ? parsed.data : null;
}

export function writeCachedModelCatalog(
  key: string,
  catalog: CachedModelCatalog,
): void {
  catalogStorage.setItem(key, catalog);
}
