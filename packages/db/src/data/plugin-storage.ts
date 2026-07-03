import { and, asc, eq, sql } from "drizzle-orm";
import type { DbConnection } from "../connection.js";
import { pluginKv, pluginSettings } from "../schema.js";

// --- plugin_kv: namespaced JSON-text values (`bb.storage.kv`) ---

export function getPluginKvValue(
  db: DbConnection,
  pluginId: string,
  key: string,
): string | undefined {
  return db
    .select({ value: pluginKv.value })
    .from(pluginKv)
    .where(and(eq(pluginKv.pluginId, pluginId), eq(pluginKv.key, key)))
    .get()?.value;
}

export function setPluginKvValue(
  db: DbConnection,
  pluginId: string,
  key: string,
  value: string,
): void {
  const updatedAt = Date.now();
  db.insert(pluginKv)
    .values({ pluginId, key, value, updatedAt })
    .onConflictDoUpdate({
      target: [pluginKv.pluginId, pluginKv.key],
      set: { value, updatedAt },
    })
    .run();
}

export function deletePluginKvValue(
  db: DbConnection,
  pluginId: string,
  key: string,
): boolean {
  const result = db
    .delete(pluginKv)
    .where(and(eq(pluginKv.pluginId, pluginId), eq(pluginKv.key, key)))
    .run();
  return result.changes > 0;
}

export function listPluginKvKeys(
  db: DbConnection,
  pluginId: string,
  prefix?: string,
): string[] {
  const conditions = [eq(pluginKv.pluginId, pluginId)];
  if (prefix !== undefined && prefix.length > 0) {
    // Escape LIKE wildcards so the prefix matches literally.
    const escaped = prefix.replace(/[\\%_]/g, (match) => `\\${match}`);
    conditions.push(sql`${pluginKv.key} LIKE ${`${escaped}%`} ESCAPE '\\'`);
  }
  return db
    .select({ key: pluginKv.key })
    .from(pluginKv)
    .where(and(...conditions))
    .orderBy(asc(pluginKv.key))
    .all()
    .map((row) => row.key);
}

// --- plugin_settings: non-secret settings values (`bb.settings`) ---

export function getPluginSettingsValues(
  db: DbConnection,
  pluginId: string,
): Record<string, string> {
  const rows = db
    .select({ key: pluginSettings.key, value: pluginSettings.value })
    .from(pluginSettings)
    .where(eq(pluginSettings.pluginId, pluginId))
    .all();
  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}

/** Upserts each string value; a `null` value deletes the stored row. */
export function setPluginSettingsValues(
  db: DbConnection,
  pluginId: string,
  values: Record<string, string | null>,
): void {
  const updatedAt = Date.now();
  db.transaction((tx) => {
    for (const [key, value] of Object.entries(values)) {
      if (value === null) {
        tx.delete(pluginSettings)
          .where(
            and(
              eq(pluginSettings.pluginId, pluginId),
              eq(pluginSettings.key, key),
            ),
          )
          .run();
        continue;
      }
      tx.insert(pluginSettings)
        .values({ pluginId, key, value, updatedAt })
        .onConflictDoUpdate({
          target: [pluginSettings.pluginId, pluginSettings.key],
          set: { value, updatedAt },
        })
        .run();
    }
  });
}

export function deleteAllPluginSettings(
  db: DbConnection,
  pluginId: string,
): void {
  db.delete(pluginSettings)
    .where(eq(pluginSettings.pluginId, pluginId))
    .run();
}
