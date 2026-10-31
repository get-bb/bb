import type { InstalledPlugin } from "@bb/server-contract";

const BB_OFFICIAL_MARKETPLACE_NAME = "bb-official";

export interface PluginLinkTarget {
  url: string;
  marketplace: string;
  entryId: string;
}

export function catalogEntryLinkTarget(entry: {
  marketplacePageUrl: string | null;
  marketplace: string;
  entryId: string;
}): PluginLinkTarget | null {
  if (entry.marketplacePageUrl === null) return null;
  return {
    url: entry.marketplacePageUrl,
    marketplace: entry.marketplace,
    entryId: entry.entryId,
  };
}

export function installedPluginLinkTarget(plugin: {
  id: string;
  provenance: InstalledPlugin["provenance"];
  catalogEntryId: string | null;
  catalogMarketplaceName: string | null;
  marketplacePageUrl: string | null;
}): PluginLinkTarget | null {
  if (plugin.marketplacePageUrl === null) return null;
  if (plugin.catalogMarketplaceName !== null && plugin.catalogEntryId !== null) {
    return {
      url: plugin.marketplacePageUrl,
      marketplace: plugin.catalogMarketplaceName,
      entryId: plugin.catalogEntryId,
    };
  }
  if (plugin.provenance !== "builtin") return null;
  return {
    url: plugin.marketplacePageUrl,
    marketplace: BB_OFFICIAL_MARKETPLACE_NAME,
    entryId: plugin.id,
  };
}
