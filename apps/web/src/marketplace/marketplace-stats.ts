import { z } from "zod";

import type { MarketplaceV2Entry } from "./marketplace-v2.js";

const ENTRY_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/u;

const marketplaceStatsSchema = z.object({
  schemaVersion: z.literal(1),
  generatedAt: z.string(),
  plugins: z.record(
    z.string(),
    z.object({ installs: z.number().int().nonnegative() }),
  ),
});

export type MarketplaceStats = z.infer<typeof marketplaceStatsSchema>;

export function parseMarketplaceStats(input: unknown): MarketplaceStats {
  const parsed = marketplaceStatsSchema.parse(input);
  return {
    ...parsed,
    plugins: Object.fromEntries(
      Object.entries(parsed.plugins).filter(([entryId]) =>
        ENTRY_ID_PATTERN.test(entryId),
      ),
    ),
  };
}

export function marketplaceEntryInstalls(
  entry: MarketplaceV2Entry,
  stats: MarketplaceStats | null,
): number | undefined {
  return stats?.plugins[entry.id]?.installs;
}
