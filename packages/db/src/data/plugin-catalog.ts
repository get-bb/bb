import { eq } from "drizzle-orm";
import type { DbConnection } from "../connection.js";
import { pluginCatalog } from "../schema.js";

const PLUGIN_CATALOG_SINGLETON_ID = 1;

export interface PluginCatalogRow {
  id: number;
  catalogJson: string;
  etag: string | null;
  lastModified: string | null;
  lastSuccessfulRefreshAt: number | null;
  lastAttemptedRefreshAt: number | null;
  lastError: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface UpsertPluginCatalogInput {
  catalogJson: string;
  etag: string | null;
  lastModified: string | null;
  lastSuccessfulRefreshAt: number | null;
  lastAttemptedRefreshAt: number | null;
  lastError: string | null;
}

export function getPluginCatalog(
  db: DbConnection,
): PluginCatalogRow | undefined {
  return db
    .select()
    .from(pluginCatalog)
    .where(eq(pluginCatalog.id, PLUGIN_CATALOG_SINGLETON_ID))
    .get();
}

export function upsertPluginCatalog(
  db: DbConnection,
  input: UpsertPluginCatalogInput,
): PluginCatalogRow {
  const now = Date.now();
  db.insert(pluginCatalog)
    .values({
      id: PLUGIN_CATALOG_SINGLETON_ID,
      ...input,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: pluginCatalog.id,
      set: { ...input, updatedAt: now },
    })
    .run();
  const row = getPluginCatalog(db);
  if (row === undefined) throw new Error("plugin catalog missing after upsert");
  return row;
}

export function updatePluginCatalogRefreshFailure(
  db: DbConnection,
  attemptedAt: number,
  error: string,
): PluginCatalogRow {
  db.update(pluginCatalog)
    .set({
      lastAttemptedRefreshAt: attemptedAt,
      lastError: error,
      updatedAt: attemptedAt,
    })
    .where(eq(pluginCatalog.id, PLUGIN_CATALOG_SINGLETON_ID))
    .run();
  const row = getPluginCatalog(db);
  if (row === undefined) throw new Error("plugin catalog is not initialized");
  return row;
}
