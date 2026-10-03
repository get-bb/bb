import type { MarketplaceV2Entry } from "./marketplace-v2.js";

export const MARKETPLACE_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/u;

export interface MarketplaceStats {
  schemaVersion: 1;
  generatedAt: string;
  plugins: Record<string, { installs: number }>;
}

export function marketplaceEntryInstalls(
  entry: MarketplaceV2Entry,
  stats: MarketplaceStats | null,
): number | undefined {
  return stats?.plugins[entry.id]?.installs;
}

const INSTALL_COUNT_DISPLAY_MINIMUM = 25;
const NEW_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export function marketplaceInstallDisplay(
  entry: MarketplaceV2Entry,
  stats: MarketplaceStats | null,
  now: number = Date.now(),
): number | "new" | null {
  const installs = marketplaceEntryInstalls(entry, stats);
  if (installs !== undefined && installs >= INSTALL_COUNT_DISPLAY_MINIMUM) {
    return installs;
  }
  const publishedAt =
    entry.publishedAt === undefined ? NaN : Date.parse(entry.publishedAt);
  if (now - publishedAt < NEW_WINDOW_MS) return "new";
  return installs ?? null;
}
