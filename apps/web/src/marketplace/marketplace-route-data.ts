import { notFound, redirect } from "@tanstack/react-router";

import { unfurlMeta } from "../landing/site.js";
import type { PublicMarketplaceData } from "./marketplace-data.js";
import type { MarketplaceV2Entry } from "./marketplace-v2.js";
import {
  isMarketplaceSort,
  marketplaceAuthorEntries,
  parseMarketplaceCategory,
} from "./marketplace-view-model.js";

export const MARKETPLACE_PAGE_TITLE = "Plugin Marketplace — bb";
export const MARKETPLACE_PAGE_DESCRIPTION =
  "Find built-in and community plugins that add new features to bb.";

export function validateMarketplaceSearch(search: Record<string, unknown>) {
  const category = parseMarketplaceCategory(search.category);
  return {
    ...(category === undefined ? {} : { category }),
    ...(isMarketplaceSort(search.sort) ? { sort: search.sort } : {}),
  };
}

export function marketplaceIndexMeta(available: boolean) {
  return [
    { title: MARKETPLACE_PAGE_TITLE },
    { name: "description", content: MARKETPLACE_PAGE_DESCRIPTION },
    { name: "robots", content: available ? "index, follow" : "noindex" },
    ...unfurlMeta(
      MARKETPLACE_PAGE_TITLE,
      MARKETPLACE_PAGE_DESCRIPTION,
      "/marketplace",
    ),
  ];
}

export function marketplacePluginRouteEntry(
  marketplace: PublicMarketplaceData | undefined,
  pluginId: string,
  pathname: string,
): MarketplaceV2Entry | null {
  if (marketplace === undefined || marketplace.status === "unavailable") {
    return null;
  }
  if (pathSegmentCount(pathname) !== 2) throw notFound();
  const entry = marketplace.manifest.plugins.find(
    (candidate) => candidate.id === pluginId,
  );
  if (entry === undefined) throw redirectToMarketplace();
  return entry;
}

export function marketplaceAuthorRouteEntries(
  marketplace: PublicMarketplaceData | undefined,
  github: string,
  pathname: string,
): MarketplaceV2Entry[] | null {
  if (marketplace === undefined || marketplace.status === "unavailable") {
    return null;
  }
  if (pathSegmentCount(pathname) !== 3) throw notFound();
  const entries = marketplaceAuthorEntries(marketplace.manifest, github);
  if (entries.length === 0) throw redirectToMarketplace();
  const canonicalGithub = entries[0]?.author.github;
  if (canonicalGithub !== undefined && canonicalGithub !== github) {
    throw redirect({
      to: "/marketplace/author/$github",
      params: { github: canonicalGithub },
      statusCode: 301,
      headers: UNCACHED_REDIRECT_HEADERS,
    });
  }
  return entries;
}

const UNCACHED_REDIRECT_HEADERS = { "cache-control": "no-store" };

function pathSegmentCount(pathname: string): number {
  return pathname.split("/").filter((segment) => segment !== "").length;
}

function redirectToMarketplace() {
  return redirect({
    to: "/marketplace",
    statusCode: 301,
    headers: UNCACHED_REDIRECT_HEADERS,
  });
}
