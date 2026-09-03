import {
  events,
  getLatestStoredThreadEventOfTypes,
  type DbConnection,
} from "@bb/db";
import type { Thread } from "@bb/domain";
import { and, desc, eq, gt, sql } from "drizzle-orm";
import { loadFailedTurn, type FailedTurnRecord } from "./turn-failed.js";

export function loadStoppedUnacceptedTurn(
  db: DbConnection,
  thread: Thread,
): FailedTurnRecord | null {
  if (
    thread.status !== "idle" ||
    thread.archivedAt !== null ||
    thread.deletedAt !== null
  ) {
    return null;
  }
  const pending = loadFailedTurn(db, thread.id);
  if (pending === null) return null;
  const settled = getLatestStoredThreadEventOfTypes(db, {
    threadId: thread.id,
    types: [
      "client/turn/rejected",
      "turn/input/accepted",
      "turn/started",
      "turn/completed",
    ],
    afterSequence: pending.requestSequence,
  });
  if (settled !== null) return null;
  const interruption = db
    .select({ sequence: events.sequence })
    .from(events)
    .where(
      and(
        eq(events.threadId, thread.id),
        eq(events.type, "system/thread/interrupted"),
        gt(events.sequence, pending.requestSequence),
        sql`json_extract(${events.data}, '$.reason') = 'manual-stop'`,
      ),
    )
    .orderBy(desc(events.sequence))
    .limit(1)
    .get();
  return interruption === undefined ? null : pending;
}
