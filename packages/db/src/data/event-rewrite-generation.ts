import type { DbConnection, DbQueryConnection } from "../connection.js";
import { invalidateThreadConversationOutlineFrom } from "./thread-conversation-outlines.js";

const generationsByThreadId = new Map<string, number>();

export function getThreadEventRewriteGeneration(threadId: string): number {
  return generationsByThreadId.get(threadId) ?? 0;
}

export function bumpThreadEventRewriteGeneration(
  db: DbQueryConnection,
  args: { threadId: string; conversationFromSequence: number | null },
): void {
  generationsByThreadId.set(
    args.threadId,
    getThreadEventRewriteGeneration(args.threadId) + 1,
  );
  if (args.conversationFromSequence !== null)
    invalidateThreadConversationOutlineFrom(db, {
      threadId: args.threadId,
      sequence: args.conversationFromSequence,
    });
}

export function getDatabaseDataVersion(db: DbConnection): number {
  const version: unknown = db.$client.pragma("data_version", { simple: true });
  if (typeof version !== "number") {
    throw new Error("PRAGMA data_version did not return a number");
  }
  return version;
}
