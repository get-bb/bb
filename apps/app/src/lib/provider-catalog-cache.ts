import {
  systemProviderCatalogEntrySchema,
  type SystemProviderCatalogEntry,
} from "@bb/server-contract";
import { createLastKnownCache } from "@/lib/last-known-cache";

const providerCatalogCache = createLastKnownCache({
  prefix: "bb.provider-catalog",
  version: "1",
  schema: systemProviderCatalogEntrySchema.array(),
});

const PROVIDER_CATALOG_CACHE_KEY = providerCatalogCache.key();

export function readCachedProviderCatalog():
  | SystemProviderCatalogEntry[]
  | null {
  return providerCatalogCache.read(PROVIDER_CATALOG_CACHE_KEY);
}

export function writeCachedProviderCatalog(
  catalog: SystemProviderCatalogEntry[],
): void {
  providerCatalogCache.write(PROVIDER_CATALOG_CACHE_KEY, catalog);
}
