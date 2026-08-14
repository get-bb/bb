import { and, eq } from "drizzle-orm";
import type { DbConnection } from "../connection.js";
import { pluginMarketplaceIcons, pluginMarketplaces } from "../schema.js";

export interface PluginMarketplaceRow {
  name: string;
  manifestUrl: string;
  manifestJson: string;
  etag: string | null;
  lastModified: string | null;
  lastSuccessfulRefreshAt: number | null;
  lastAttemptedRefreshAt: number | null;
  lastError: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface UpsertPluginMarketplaceInput {
  name: string;
  manifestUrl: string;
  manifestJson: string;
  etag: string | null;
  lastModified: string | null;
  lastSuccessfulRefreshAt: number | null;
  lastAttemptedRefreshAt: number | null;
  lastError: string | null;
}

export interface PluginMarketplaceIconRow {
  marketplaceName: string;
  entryId: string;
  sourceUrl: string;
  contentType: string;
  etag: string | null;
  contentHash: string;
  bytes: Buffer;
  updatedAt: number;
}

export type UpsertPluginMarketplaceIconInput = Omit<
  PluginMarketplaceIconRow,
  "updatedAt"
>;

export function getPluginMarketplace(
  db: DbConnection,
  name: string,
): PluginMarketplaceRow | undefined {
  return db
    .select()
    .from(pluginMarketplaces)
    .where(eq(pluginMarketplaces.name, name))
    .get();
}

export function upsertPluginMarketplace(
  db: DbConnection,
  input: UpsertPluginMarketplaceInput,
): PluginMarketplaceRow {
  const now = Date.now();
  const { name, ...columns } = input;
  db.insert(pluginMarketplaces)
    .values({ name, ...columns, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: pluginMarketplaces.name,
      set: { ...columns, updatedAt: now },
    })
    .run();
  const row = getPluginMarketplace(db, name);
  if (row === undefined) {
    throw new Error(`plugin marketplace "${name}" missing after upsert`);
  }
  return row;
}

/**
 * Record a failed refresh attempt. The stored manifest is deliberately
 * untouched: a failure keeps the last-known-good catalog serving.
 */
export function recordPluginMarketplaceRefreshFailure(
  db: DbConnection,
  name: string,
  attemptedAt: number,
  error: string,
): PluginMarketplaceRow | undefined {
  db.update(pluginMarketplaces)
    .set({
      lastAttemptedRefreshAt: attemptedAt,
      lastError: error,
      updatedAt: attemptedAt,
    })
    .where(eq(pluginMarketplaces.name, name))
    .run();
  return getPluginMarketplace(db, name);
}

export function listPluginMarketplaceIcons(
  db: DbConnection,
  marketplaceName: string,
): PluginMarketplaceIconRow[] {
  return db
    .select()
    .from(pluginMarketplaceIcons)
    .where(eq(pluginMarketplaceIcons.marketplaceName, marketplaceName))
    .all();
}

export function getPluginMarketplaceIcon(
  db: DbConnection,
  marketplaceName: string,
  entryId: string,
): PluginMarketplaceIconRow | undefined {
  return db
    .select()
    .from(pluginMarketplaceIcons)
    .where(
      and(
        eq(pluginMarketplaceIcons.marketplaceName, marketplaceName),
        eq(pluginMarketplaceIcons.entryId, entryId),
      ),
    )
    .get();
}

export function upsertPluginMarketplaceIcon(
  db: DbConnection,
  input: UpsertPluginMarketplaceIconInput,
): void {
  const now = Date.now();
  db.insert(pluginMarketplaceIcons)
    .values({ ...input, updatedAt: now })
    .onConflictDoUpdate({
      target: [
        pluginMarketplaceIcons.marketplaceName,
        pluginMarketplaceIcons.entryId,
      ],
      set: {
        sourceUrl: input.sourceUrl,
        contentType: input.contentType,
        etag: input.etag,
        contentHash: input.contentHash,
        bytes: input.bytes,
        updatedAt: now,
      },
    })
    .run();
}

export function deletePluginMarketplaceIcon(
  db: DbConnection,
  marketplaceName: string,
  entryId: string,
): boolean {
  return (
    db
      .delete(pluginMarketplaceIcons)
      .where(
        and(
          eq(pluginMarketplaceIcons.marketplaceName, marketplaceName),
          eq(pluginMarketplaceIcons.entryId, entryId),
        ),
      )
      .run().changes > 0
  );
}
