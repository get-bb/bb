import {
  pluginInstallBadge,
  type PluginInstallBadge,
} from "@bb/domain/plugin-install-badge";

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

export function marketplaceInstallBadge(
  entry: MarketplaceV2Entry,
  stats: MarketplaceStats | null,
  now: number,
  options: { installedByDefault: boolean } = { installedByDefault: false },
): PluginInstallBadge | null {
  return pluginInstallBadge(
    {
      installs: marketplaceEntryInstalls(entry, stats) ?? null,
      installedByDefault: options.installedByDefault,
      ...(entry.publishedAt === undefined
        ? {}
        : { publishedAt: entry.publishedAt }),
    },
    now,
  );
}
