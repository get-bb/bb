export const OFFICIAL_PLUGIN_MARKETPLACE = "bb-official";

export function isOfficialMarketplace(
  marketplace: string | null | undefined,
): boolean {
  return marketplace === OFFICIAL_PLUGIN_MARKETPLACE;
}

export function isOfficialPlugin(plugin: {
  provenance: string;
  catalogMarketplaceName?: string | null;
}): boolean {
  return (
    plugin.provenance === "builtin" ||
    isOfficialMarketplace(plugin.catalogMarketplaceName)
  );
}
