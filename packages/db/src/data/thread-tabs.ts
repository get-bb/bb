import { eq } from "drizzle-orm";
import type { DbConnection } from "../connection.js";
import { threadTabs } from "../schema.js";

export interface StoredThreadTabs {
  revision: number;
  tabsJson: string;
}

export type ReplaceThreadTabsResult =
  | { outcome: "updated"; revision: number }
  | { outcome: "conflict"; revision: number };

export function getStoredThreadTabs(
  db: DbConnection,
  threadId: string,
): StoredThreadTabs | null {
  return (
    db
      .select({
        revision: threadTabs.revision,
        tabsJson: threadTabs.tabsJson,
      })
      .from(threadTabs)
      .where(eq(threadTabs.threadId, threadId))
      .get() ?? null
  );
}

export function replaceStoredThreadTabs(
  db: DbConnection,
  args: {
    expectedRevision: number;
    tabsJson: string;
    threadId: string;
  },
): ReplaceThreadTabsResult {
  return db.transaction((tx) => {
    const current = tx
      .select({ revision: threadTabs.revision })
      .from(threadTabs)
      .where(eq(threadTabs.threadId, args.threadId))
      .get();
    const currentRevision = current?.revision ?? 0;
    if (currentRevision !== args.expectedRevision) {
      return { outcome: "conflict", revision: currentRevision };
    }

    const revision = currentRevision + 1;
    const updatedAt = Date.now();
    tx.insert(threadTabs)
      .values({
        revision,
        tabsJson: args.tabsJson,
        threadId: args.threadId,
        updatedAt,
      })
      .onConflictDoUpdate({
        target: threadTabs.threadId,
        set: {
          revision,
          tabsJson: args.tabsJson,
          updatedAt,
        },
      })
      .run();
    return { outcome: "updated", revision };
  });
}
