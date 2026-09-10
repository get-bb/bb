import { eq } from "drizzle-orm";
import type { DbConnection, DbQueryConnection } from "../connection.js";
import { uiPreferences } from "../schema.js";

export interface StoredUiPreference {
  key: string;
  revision: number;
  valueJson: string;
}

export type ReplaceUiPreferenceResult =
  | { outcome: "updated"; revision: number }
  | { outcome: "conflict"; revision: number };

export function listStoredUiPreferences(
  db: DbConnection,
): StoredUiPreference[] {
  return db
    .select({
      key: uiPreferences.key,
      revision: uiPreferences.revision,
      valueJson: uiPreferences.valueJson,
    })
    .from(uiPreferences)
    .all();
}

function upsertStoredUiPreference(
  db: DbQueryConnection,
  args: { key: string; revision: number; valueJson: string },
): void {
  const updatedAt = Date.now();
  db.insert(uiPreferences)
    .values({
      key: args.key,
      revision: args.revision,
      updatedAt,
      valueJson: args.valueJson,
    })
    .onConflictDoUpdate({
      target: uiPreferences.key,
      set: { revision: args.revision, updatedAt, valueJson: args.valueJson },
    })
    .run();
}

export function replaceStoredUiPreference(
  db: DbConnection,
  args: { expectedRevision: number; key: string; valueJson: string },
): ReplaceUiPreferenceResult {
  return db.transaction((tx) => {
    const current = tx
      .select({ revision: uiPreferences.revision })
      .from(uiPreferences)
      .where(eq(uiPreferences.key, args.key))
      .get();
    const currentRevision = current?.revision ?? 0;
    if (currentRevision !== args.expectedRevision) {
      return { outcome: "conflict", revision: currentRevision };
    }
    const revision = currentRevision + 1;
    upsertStoredUiPreference(tx, {
      key: args.key,
      revision,
      valueJson: args.valueJson,
    });
    return { outcome: "updated", revision };
  });
}

export function overwriteStoredUiPreference(
  db: DbConnection,
  args: { key: string; valueJson: string },
): { revision: number } {
  return db.transaction((tx) => {
    const current = tx
      .select({ revision: uiPreferences.revision })
      .from(uiPreferences)
      .where(eq(uiPreferences.key, args.key))
      .get();
    const revision = (current?.revision ?? 0) + 1;
    upsertStoredUiPreference(tx, {
      key: args.key,
      revision,
      valueJson: args.valueJson,
    });
    return { revision };
  });
}
