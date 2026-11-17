import type { DbConnection, DbQueryConnection } from "../connection.js";
import { deleteThreadConversationOutlineRecord } from "./thread-conversation-outlines.js";

const generationsByThreadId = new Map<string, number>();

export function getThreadEventRewriteGeneration(threadId: string): number {
  return generationsByThreadId.get(threadId) ?? 0;
}

export function bumpThreadEventRewriteGeneration(
  db: DbQueryConnection,
  threadId: string,
): void {
  deleteThreadConversationOutlineRecord(db, threadId);
  generationsByThreadId.set(
    threadId,
    getThreadEventRewriteGeneration(threadId) + 1,
  );
}

export function forgetThreadEventRewriteGenerations(): void {
  generationsByThreadId.clear();
}

export function getDatabaseDataVersion(db: DbConnection): number {
  const version: unknown = db.$client.pragma("data_version", { simple: true });
  if (typeof version !== "number") {
    throw new Error("PRAGMA data_version did not return a number");
  }
  return version;
}
