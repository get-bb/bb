import { availableModelSchema } from "@bb/domain";
import { z } from "zod";
import { createJsonLocalStorage } from "@/lib/browser-storage";

const CLAUDE_MODEL_CATALOG_CACHE_PREFIX = "bb.claude-model-catalog";
const CLAUDE_MODEL_CATALOG_CACHE_VERSION = "1";

const cachedClaudeModelCatalogSchema = z.object({
  models: z.array(availableModelSchema),
  selectedOnlyModels: z.array(availableModelSchema),
});

export type CachedClaudeModelCatalog = z.infer<
  typeof cachedClaudeModelCatalogSchema
>;

interface ClaudeModelCatalogCacheKeyArgs {
  environmentId: string | null;
  hostId: string | null;
}

const catalogStorage = createJsonLocalStorage<unknown>();

/**
 * Scoped to the same routing dimensions as the execution-options query, because
 * two hosts can be signed into different Claude accounts with different
 * entitlements. The version segment lets a shape change invalidate old entries
 * instead of relying on the parse below to reject every one of them.
 */
export function claudeModelCatalogCacheKey({
  environmentId,
  hostId,
}: ClaudeModelCatalogCacheKeyArgs): string {
  return [
    CLAUDE_MODEL_CATALOG_CACHE_PREFIX,
    CLAUDE_MODEL_CATALOG_CACHE_VERSION,
    environmentId ?? "-",
    hostId ?? "-",
  ].join(".");
}

/**
 * The last catalog a successful account-scoped probe returned, used to preload
 * the picker with this account's real model ids rather than generic aliases. A
 * cached catalog can be stale, so callers must keep reporting preloaded rows as
 * provisional: only a fresh probe may retire a stored selection.
 */
export function readCachedClaudeModelCatalog(
  key: string,
): CachedClaudeModelCatalog | null {
  const stored = catalogStorage.getItem(key, null);
  if (stored === null) {
    return null;
  }
  const parsed = cachedClaudeModelCatalogSchema.safeParse(stored);
  return parsed.success ? parsed.data : null;
}

export function writeCachedClaudeModelCatalog(
  key: string,
  catalog: CachedClaudeModelCatalog,
): void {
  catalogStorage.setItem(key, catalog);
}
