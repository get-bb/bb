import { sql } from "drizzle-orm";
import type { ThreadEventType } from "@bb/domain";
import type { DbConnection } from "../connection.js";
import type { DbNotifier } from "../notifier.js";
import { createEventId } from "../ids.js";

/**
 * One event from a shared thread bundle, ready to be re-inserted verbatim under
 * a new local thread id. Sequence/scopeKind/turnId are preserved exactly so the
 * `(thread_id, sequence)` uniqueness and the scope-shape CHECK constraint hold,
 * and the timeline reconstructs identically to the source. `data` is the
 * canonical JSON string from the source `events.data` column.
 */
export interface ImportedThreadEventInput {
  sequence: number;
  scopeKind: "turn" | "thread";
  turnId: string | null;
  providerThreadId: string | null;
  type: string;
  itemId: string | null;
  itemKind: string | null;
  data: string;
  createdAt: number;
}

export interface ImportThreadEventsArgs {
  threadId: string;
  events: readonly ImportedThreadEventInput[];
}

/**
 * Insert a shared thread's events under a freshly created local thread. The
 * imported thread is environment-less (read-only snapshot), so `environment_id`
 * is null for every row. Runs in a single immediate transaction.
 */
export function importThreadEvents(
  db: DbConnection,
  notifier: DbNotifier,
  args: ImportThreadEventsArgs,
): number {
  if (args.events.length === 0) {
    return 0;
  }
  const eventTypes = new Set<ThreadEventType>();
  db.transaction(
    (tx) => {
      for (const event of args.events) {
        tx.run(
          sql`INSERT OR IGNORE INTO events (id, thread_id, environment_id, scope_kind, turn_id, provider_thread_id, sequence, type, item_id, item_kind, data, created_at)
              VALUES (${createEventId()}, ${args.threadId}, ${null}, ${event.scopeKind}, ${event.turnId}, ${event.providerThreadId}, ${event.sequence}, ${event.type}, ${event.itemId}, ${event.itemKind}, ${event.data}, ${event.createdAt})`,
        );
        eventTypes.add(event.type as ThreadEventType);
      }
    },
    { behavior: "immediate" },
  );
  notifier.notifyThread(args.threadId, ["events-appended"], {
    eventTypes: Array.from(eventTypes),
  });
  return args.events.length;
}
