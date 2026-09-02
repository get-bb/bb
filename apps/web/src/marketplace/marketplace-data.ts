import {
  parseMarketplaceV2Manifest,
  type MarketplaceV2Manifest,
} from "./marketplace-v2.js";
import {
  parseMarketplaceStats,
  type MarketplaceStats,
} from "./marketplace-stats.js";

export const MARKETPLACE_V2_MANIFEST_PATH = "/marketplace/v2/marketplace.json";
export const MARKETPLACE_STATS_PATH = "/marketplace/v1/stats.json";

export type PublicMarketplaceData =
  | {
      status: "available";
      manifest: MarketplaceV2Manifest;
      stats: MarketplaceStats | null;
    }
  | { status: "unavailable" };

export async function loadPublicMarketplace(
  readJson: (path: string) => Promise<unknown>,
): Promise<PublicMarketplaceData> {
  try {
    const manifest = parseMarketplaceV2Manifest(
      await readJson(MARKETPLACE_V2_MANIFEST_PATH),
    );
    let stats: MarketplaceStats | null = null;
    try {
      stats = parseMarketplaceStats(await readJson(MARKETPLACE_STATS_PATH));
    } catch {
      stats = null;
    }
    return { status: "available", manifest, stats };
  } catch {
    return { status: "unavailable" };
  }
}
