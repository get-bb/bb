import type { DbConnection } from "../connection.js";

const generationsByThreadId = new Map<string, number>();
let latestGeneration = 0;

export function getThreadEventRewriteGeneration(threadId: string): number {
  return generationsByThreadId.get(threadId) ?? 0;
}

export function bumpThreadEventRewriteGeneration(threadId: string): void {
  latestGeneration += 1;
  generationsByThreadId.set(threadId, latestGeneration);
}

export function getDatabaseDataVersion(db: DbConnection): number {
  const version: unknown = db.$client.pragma("data_version", { simple: true });
  if (typeof version !== "number") {
    throw new Error("PRAGMA data_version did not return a number");
  }
  return version;
}
