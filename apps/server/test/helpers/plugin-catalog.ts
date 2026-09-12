import { CURATED_PLUGIN_MARKETPLACE_NAME } from "@bb/server-contract";
import type { PluginCatalogService } from "../../src/services/plugin-catalog/plugin-catalog-service.js";

export async function refreshCuratedMarketplace(
  catalog: Pick<PluginCatalogService, "refreshMarketplaces">,
  attemptedAt: number,
): Promise<void> {
  const [result] = await catalog.refreshMarketplaces({
    name: CURATED_PLUGIN_MARKETPLACE_NAME,
    attemptedAt,
  });
  if (result !== undefined && !result.ok) {
    throw new Error(result.error ?? "marketplace refresh failed");
  }
}
