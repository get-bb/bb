import { and, eq, inArray } from "drizzle-orm";
import type { JsonObject, JsonValue } from "@bb/domain";
import { validatePluginMetadata } from "@bb/domain";
import type { DbConnection, DbQueryConnection, DbTransaction } from "../connection.js";
import { threadPluginMetadata } from "../schema.js";

type WriteConnection = DbConnection | DbTransaction;

export interface ThreadPluginMetadataRecord {
  threadId: string;
  pluginId: string;
  metadata: JsonObject;
}

export interface ThreadPluginMetadataPatch {
  threadId: string;
  pluginId: string;
  set?: Record<string, JsonValue>;
  remove?: string[];
}

function parsePersistedMetadata(value: string): JsonObject {
  try {
    return validatePluginMetadata(JSON.parse(value));
  } catch (error) {
    throw new Error("invalid persisted thread plugin metadata", { cause: error });
  }
}

function toRecord(row: typeof threadPluginMetadata.$inferSelect): ThreadPluginMetadataRecord {
  return { threadId: row.threadId, pluginId: row.pluginId, metadata: parsePersistedMetadata(row.metadataJson) };
}

export function getThreadPluginMetadataRow(db: DbQueryConnection, threadId: string, pluginId: string): ThreadPluginMetadataRecord | null {
  const row = db.select().from(threadPluginMetadata).where(and(eq(threadPluginMetadata.threadId, threadId), eq(threadPluginMetadata.pluginId, pluginId))).get();
  return row === undefined ? null : toRecord(row);
}

/** Returns the namespace, using an empty object for an absent namespace. */
export function getThreadPluginMetadata(db: DbQueryConnection, threadId: string, pluginId: string): JsonObject {
  return getThreadPluginMetadataRow(db, threadId, pluginId)?.metadata ?? {};
}

export function listThreadPluginMetadataRows(db: DbQueryConnection, threadId: string): ThreadPluginMetadataRecord[] {
  return db.select().from(threadPluginMetadata).where(eq(threadPluginMetadata.threadId, threadId)).all().map(toRecord);
}

export function listThreadPluginMetadata(db: DbQueryConnection, threadId: string): Record<string, JsonObject> {
  return Object.fromEntries(listThreadPluginMetadataRows(db, threadId).map((row) => [row.pluginId, row.metadata]));
}

export interface PersistedThreadPluginMetadataRecord {
  threadId: string;
  pluginId: string;
  metadataJson: string;
}

/** Returns raw rows so callers can isolate corrupt persisted namespaces. */
export function listPersistedThreadPluginMetadataByThreadIds(
  db: DbQueryConnection,
  threadIds: readonly string[],
): PersistedThreadPluginMetadataRecord[] {
  if (threadIds.length === 0) return [];
  return db
    .select()
    .from(threadPluginMetadata)
    .where(inArray(threadPluginMetadata.threadId, [...threadIds]))
    .all();
}

export function insertThreadPluginMetadata(db: WriteConnection, input: { threadId: string; pluginId: string; metadata: JsonObject }): ThreadPluginMetadataRecord {
  const metadata = validatePluginMetadata(input.metadata);
  db.insert(threadPluginMetadata).values({ threadId: input.threadId, pluginId: input.pluginId, metadataJson: JSON.stringify(metadata) }).run();
  return { threadId: input.threadId, pluginId: input.pluginId, metadata };
}

export function patchThreadPluginMetadata(db: DbConnection, input: ThreadPluginMetadataPatch): JsonObject {
  return db.transaction((tx) => patchThreadPluginMetadataInTransaction(tx, input), { behavior: "immediate" });
}

export function patchThreadPluginMetadataInTransaction(db: DbTransaction, input: ThreadPluginMetadataPatch): JsonObject {
  // Validate the supplied set independently, before reading or mutating the row.
  const set = input.set === undefined ? {} : validatePluginMetadata(input.set);
  const remove = input.remove ?? [];
  if (!Array.isArray(remove) || remove.some((key) => typeof key !== "string")) {
    throw new Error("metadata remove must be an array of strings");
  }
  if (new Set(remove).size !== remove.length) {
    throw new Error("metadata remove contains duplicate keys");
  }
  if (remove.some((key) => Object.hasOwn(set, key))) {
    throw new Error("metadata set and remove overlap");
  }
  const existing = getThreadPluginMetadataRow(db, input.threadId, input.pluginId);
  const merged: JsonObject = { ...(existing?.metadata ?? {}), ...set };
  for (const key of remove) delete merged[key];
  const metadata = validatePluginMetadata(merged);
  if (Object.keys(metadata).length === 0) {
    db.delete(threadPluginMetadata).where(and(eq(threadPluginMetadata.threadId, input.threadId), eq(threadPluginMetadata.pluginId, input.pluginId))).run();
    return {};
  }
  db.insert(threadPluginMetadata).values({ threadId: input.threadId, pluginId: input.pluginId, metadataJson: JSON.stringify(metadata) }).onConflictDoUpdate({ target: [threadPluginMetadata.threadId, threadPluginMetadata.pluginId], set: { metadataJson: JSON.stringify(metadata) } }).run();
  return metadata;
}
