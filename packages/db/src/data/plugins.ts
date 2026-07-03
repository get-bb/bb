import { eq } from "drizzle-orm";
import type { DbConnection } from "../connection.js";
import { installedPlugins } from "../schema.js";

export interface InstalledPluginRow {
  id: string;
  source: string;
  rootDir: string;
  version: string;
  enabled: boolean;
  installedAt: number;
  updatedAt: number;
}

export function listInstalledPlugins(db: DbConnection): InstalledPluginRow[] {
  return db.select().from(installedPlugins).all();
}

export function getInstalledPlugin(
  db: DbConnection,
  id: string,
): InstalledPluginRow | undefined {
  return db
    .select()
    .from(installedPlugins)
    .where(eq(installedPlugins.id, id))
    .get();
}

export function upsertInstalledPlugin(
  db: DbConnection,
  plugin: Omit<InstalledPluginRow, "installedAt" | "updatedAt">,
): InstalledPluginRow {
  const now = Date.now();
  db.insert(installedPlugins)
    .values({ ...plugin, installedAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: installedPlugins.id,
      set: {
        source: plugin.source,
        rootDir: plugin.rootDir,
        version: plugin.version,
        enabled: plugin.enabled,
        updatedAt: now,
      },
    })
    .run();
  const row = getInstalledPlugin(db, plugin.id);
  if (!row) throw new Error(`plugin row missing after upsert: ${plugin.id}`);
  return row;
}

export function setInstalledPluginEnabled(
  db: DbConnection,
  id: string,
  enabled: boolean,
): boolean {
  const result = db
    .update(installedPlugins)
    .set({ enabled, updatedAt: Date.now() })
    .where(eq(installedPlugins.id, id))
    .run();
  return result.changes > 0;
}

export function deleteInstalledPlugin(db: DbConnection, id: string): boolean {
  const result = db
    .delete(installedPlugins)
    .where(eq(installedPlugins.id, id))
    .run();
  return result.changes > 0;
}
