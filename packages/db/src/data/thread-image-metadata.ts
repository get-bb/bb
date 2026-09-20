import { eq } from "drizzle-orm";
import type { DbConnection, DbQueryConnection } from "../connection.js";
import { threadImageMetadata } from "../schema.js";

export function listThreadImageMetadata(db: DbQueryConnection, threadId: string) {
  return db.select({
    source: threadImageMetadata.source,
    width: threadImageMetadata.width,
    height: threadImageMetadata.height,
    etag: threadImageMetadata.etag,
  }).from(threadImageMetadata).where(eq(threadImageMetadata.threadId, threadId)).all();
}

export function saveThreadImageMetadata(
  db: DbConnection,
  input: typeof threadImageMetadata.$inferInsert,
): void {
  db.insert(threadImageMetadata).values(input).onConflictDoUpdate({
    target: [threadImageMetadata.threadId, threadImageMetadata.source],
    set: { width: input.width, height: input.height, etag: input.etag },
  }).run();
}
