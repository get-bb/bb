import { eq, sql } from "drizzle-orm";
import type { DbConnection, DbQueryConnection } from "../connection.js";
import { threadEventRewriteGenerations } from "../schema.js";

const generationsByThreadId = new Map<string, number>();

export function getThreadEventRewriteGeneration(threadId: string): number {
  return generationsByThreadId.get(threadId) ?? 0;
}

export function bumpThreadEventRewriteGeneration(
  db: DbQueryConnection,
  threadId: string,
): void {
  db.insert(threadEventRewriteGenerations)
    .values({ generation: 1, threadId })
    .onConflictDoUpdate({
      target: threadEventRewriteGenerations.threadId,
      set: { generation: sql`${threadEventRewriteGenerations.generation} + 1` },
    })
    .run();
  generationsByThreadId.set(
    threadId,
    getThreadEventRewriteGeneration(threadId) + 1,
  );
}

export function getStoredThreadEventRewriteGeneration(
  db: DbQueryConnection,
  threadId: string,
): number {
  return (
    db
      .select({ generation: threadEventRewriteGenerations.generation })
      .from(threadEventRewriteGenerations)
      .where(eq(threadEventRewriteGenerations.threadId, threadId))
      .get()?.generation ?? 0
  );
}

export function getDatabaseDataVersion(db: DbConnection): number {
  const version: unknown = db.$client.pragma("data_version", { simple: true });
  if (typeof version !== "number") {
    throw new Error("PRAGMA data_version did not return a number");
  }
  return version;
}
