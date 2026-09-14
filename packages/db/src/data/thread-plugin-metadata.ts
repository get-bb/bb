import { and, eq, inArray } from "drizzle-orm";
import {
  exceedsPluginMetadataLimit,
  parsePersistedPluginMetadata,
  type JsonObject,
} from "@bb/domain";
import type {
  DbConnection,
  DbQueryConnection,
  DbTransaction,
} from "../connection.js";
import { threadPluginMetadata } from "../schema.js";

export interface ThreadPluginMetadataPatch {
  threadId: string;
  pluginId: string;
  set: JsonObject;
  remove: readonly string[];
}

export interface ThreadPluginMetadataRead {
  metadata: JsonObject;
  corrupt: boolean;
}

export type ThreadPluginMetadataPatchResult =
  | { ok: true; metadata: JsonObject; replacedCorrupt: boolean }
  | { ok: false; reason: "too_large" };

function namespaceWhere(threadId: string, pluginId: string) {
  return and(
    eq(threadPluginMetadata.threadId, threadId),
    eq(threadPluginMetadata.pluginId, pluginId),
  );
}

export function getThreadPluginMetadata(
  db: DbQueryConnection,
  threadId: string,
  pluginId: string,
): ThreadPluginMetadataRead {
  const row = db
    .select({ metadataJson: threadPluginMetadata.metadataJson })
    .from(threadPluginMetadata)
    .where(namespaceWhere(threadId, pluginId))
    .get();
  if (row === undefined) return { metadata: {}, corrupt: false };
  const metadata = parsePersistedPluginMetadata(row.metadataJson);
  return metadata === undefined
    ? { metadata: {}, corrupt: true }
    : { metadata, corrupt: false };
}

export function listThreadPluginMetadataRows(
  db: DbQueryConnection,
  threadId: string,
  pluginIds: readonly string[],
): Array<{ pluginId: string; metadataJson: string }> {
  if (pluginIds.length === 0) return [];
  return db
    .select({
      pluginId: threadPluginMetadata.pluginId,
      metadataJson: threadPluginMetadata.metadataJson,
    })
    .from(threadPluginMetadata)
    .where(
      and(
        eq(threadPluginMetadata.threadId, threadId),
        inArray(threadPluginMetadata.pluginId, [...pluginIds]),
      ),
    )
    .all();
}

export function insertThreadPluginMetadata(
  db: DbConnection | DbTransaction,
  input: { threadId: string; pluginId: string; metadata: JsonObject },
): void {
  db.insert(threadPluginMetadata)
    .values({
      threadId: input.threadId,
      pluginId: input.pluginId,
      metadataJson: JSON.stringify(input.metadata),
    })
    .run();
}

export function patchThreadPluginMetadata(
  db: DbConnection,
  input: ThreadPluginMetadataPatch,
): ThreadPluginMetadataPatchResult {
  return db.transaction(
    (tx) => {
      const existing = getThreadPluginMetadata(
        tx,
        input.threadId,
        input.pluginId,
      );
      const metadata: JsonObject = { ...existing.metadata, ...input.set };
      for (const key of input.remove) delete metadata[key];
      if (Object.keys(metadata).length === 0) {
        tx.delete(threadPluginMetadata)
          .where(namespaceWhere(input.threadId, input.pluginId))
          .run();
        return { ok: true, metadata, replacedCorrupt: existing.corrupt };
      }
      const metadataJson = JSON.stringify(metadata);
      if (exceedsPluginMetadataLimit(metadataJson)) {
        return { ok: false, reason: "too_large" };
      }
      tx.insert(threadPluginMetadata)
        .values({
          threadId: input.threadId,
          pluginId: input.pluginId,
          metadataJson,
        })
        .onConflictDoUpdate({
          target: [
            threadPluginMetadata.threadId,
            threadPluginMetadata.pluginId,
          ],
          set: { metadataJson },
        })
        .run();
      return { ok: true, metadata, replacedCorrupt: existing.corrupt };
    },
    { behavior: "immediate" },
  );
}
