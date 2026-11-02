import { CURATED_PLUGIN_MARKETPLACE_NAME } from "@bb/server-contract";
import { BUNDLED_MARKETPLACE_NAME } from "./bundled-marketplace-paths.js";
import {
  isBundledMarketplaceEntry,
  type MarketplaceEntry,
  type MarketplaceManifest,
} from "./marketplace-manifest.js";

const MARKETPLACE_PAGE_ORIGIN = "https://getbb.app";

export interface MarketplacePage {
  marketplace: string;
  entryId: string;
  pluginId: string;
  url: string;
}

export interface MarketplacePageCatalogs {
  official: MarketplaceManifest | null;
  community: MarketplaceManifest | null;
}

export function marketplacePageUrl(entryId: string): string {
  const url = new URL(
    `/marketplace/${encodeURIComponent(entryId)}`,
    MARKETPLACE_PAGE_ORIGIN,
  );
  url.searchParams.set("utm_source", "bb");
  url.searchParams.set("utm_medium", "share");
  return url.href;
}

function isUnlisted(entry: MarketplaceEntry): boolean {
  return "unlisted" in entry && entry.unlisted === true;
}

function catalogFor(
  catalogs: MarketplacePageCatalogs,
  marketplace: string,
): MarketplaceManifest | null {
  if (marketplace === BUNDLED_MARKETPLACE_NAME) return catalogs.official;
  if (marketplace === CURATED_PLUGIN_MARKETPLACE_NAME) {
    return catalogs.community;
  }
  return null;
}

export function marketplacePageForEntry(
  catalogs: MarketplacePageCatalogs,
  marketplace: string,
  entry: MarketplaceEntry,
): MarketplacePage | null {
  if (catalogFor(catalogs, marketplace) === null) return null;
  if (marketplace === BUNDLED_MARKETPLACE_NAME) {
    if (isUnlisted(entry)) return null;
    if (catalogs.community?.plugins.some(({ id }) => id === entry.id)) {
      return null;
    }
  }
  return {
    marketplace,
    entryId: entry.id,
    pluginId: entry.id,
    url: marketplacePageUrl(entry.id),
  };
}

export function findMarketplacePage(
  catalogs: MarketplacePageCatalogs,
  marketplace: string,
  entryId: string,
): MarketplacePage | null {
  const entry = catalogFor(catalogs, marketplace)?.plugins.find(
    (candidate) =>
      candidate.id === entryId ||
      (isBundledMarketplaceEntry(candidate) &&
        candidate.source.bundled.plugin === entryId),
  );
  return entry === undefined
    ? null
    : marketplacePageForEntry(catalogs, marketplace, entry);
}

export function findBuiltinMarketplacePage(
  catalogs: MarketplacePageCatalogs,
  builtinName: string,
): MarketplacePage | null {
  const entry = catalogs.official?.plugins.find(
    (candidate) =>
      isBundledMarketplaceEntry(candidate) &&
      candidate.source.bundled.plugin === builtinName,
  );
  return entry === undefined
    ? null
    : marketplacePageForEntry(catalogs, BUNDLED_MARKETPLACE_NAME, entry);
}
