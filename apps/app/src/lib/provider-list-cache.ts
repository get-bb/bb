import { providerInfoSchema } from "@bb/domain";
import { z } from "zod";
import { createLastKnownCache } from "@/lib/last-known-cache";

/**
 * The provider list the execution-options endpoint last returned for a
 * routing (environment, host): the built-in providers plus whatever custom
 * and installed ACP agents that host reports. Replayed with the model-catalog
 * placeholder so a composer whose selected provider is not built in paints
 * that provider from the first frame instead of the first built-in one, and
 * so the provider picker does not grow by a few rows when the live answer
 * lands. Provisional like every last-known value: consumers keep gating
 * irreversible choices on the live response.
 */
const providerListCache = createLastKnownCache({
  prefix: "bb.provider-list",
  // Bumped to 2 when `ProviderInfo.capabilities` gained the required
  // `modelCatalogScope`: a version-1 entry parses as invalid and is dropped,
  // which is one cold paint rather than a replayed shape the schema rejects.
  version: "2",
  schema: z.array(providerInfoSchema),
});

export function providerListCacheKey({
  environmentId,
  hostId,
}: {
  environmentId: string | null;
  hostId: string | null;
}): string {
  return providerListCache.key(environmentId, hostId);
}

export const readCachedProviderList = providerListCache.read;
export const writeCachedProviderList = providerListCache.write;
