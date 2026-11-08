import { and, eq, inArray, lte, sql } from "drizzle-orm";
import type { DbConnection } from "../connection.js";
import { events, threadTurnTimelinePlans } from "../schema.js";
import { queryBuiltInSqliteVariableBatches } from "./sqlite-variable-batches.js";

export interface ThreadTurnTimelinePlanRecord {
  planJson: string;
  projectionKey: string;
  turnId: string;
  watermark: number;
}

export function listThreadTurnTimelinePlanRecords(
  db: DbConnection,
  args: { threadId: string; turnIds: readonly string[] },
): ThreadTurnTimelinePlanRecord[] {
  return queryBuiltInSqliteVariableBatches(args.turnIds, (turnIds) =>
    db
      .select({
        planJson: threadTurnTimelinePlans.planJson,
        projectionKey: threadTurnTimelinePlans.projectionKey,
        turnId: threadTurnTimelinePlans.turnId,
        watermark: threadTurnTimelinePlans.watermark,
      })
      .from(threadTurnTimelinePlans)
      .where(
        and(
          eq(threadTurnTimelinePlans.threadId, args.threadId),
          inArray(threadTurnTimelinePlans.turnId, [...turnIds]),
        ),
      ),
  );
}

export function upsertThreadTurnTimelinePlanRecord(
  db: DbConnection,
  args: ThreadTurnTimelinePlanRecord & { threadId: string },
): void {
  db.insert(threadTurnTimelinePlans)
    .values(args)
    .onConflictDoUpdate({
      target: [threadTurnTimelinePlans.threadId, threadTurnTimelinePlans.turnId],
      set: {
        planJson: args.planJson,
        projectionKey: args.projectionKey,
        watermark: args.watermark,
      },
    })
    .run();
}

export function getTimelineTurnPlanWatermark(
  db: DbConnection,
  args: {
    delegatingItemIds: readonly string[];
    maxSeq: number;
    openItemIds: readonly string[];
    threadId: string;
    turnId: string;
  },
): number {
  const maxSequence = sql<number | null>`MAX(${events.sequence})`;
  const turnSequences = db
    .select({ sequence: maxSequence })
    .from(sql`${events} INDEXED BY events_thread_turn_type_item_sequence_idx`)
    .where(
      and(
        eq(events.threadId, args.threadId),
        eq(events.turnId, args.turnId),
        lte(events.sequence, args.maxSeq),
      ),
    )
    .all();
  const childSequences = queryBuiltInSqliteVariableBatches(
    args.delegatingItemIds,
    (itemIds) =>
      db
        .select({ sequence: maxSequence })
        .from(
          sql`${events} INDEXED BY events_parent_tool_call_thread_parent_sequence_idx`,
        )
        .where(
          and(
            eq(events.threadId, args.threadId),
            inArray(events.parentToolCallId, [...itemIds]),
            lte(events.sequence, args.maxSeq),
          ),
        ),
  );
  const openItemSequences = queryBuiltInSqliteVariableBatches(
    args.openItemIds,
    (itemIds) =>
      db
        .select({ sequence: maxSequence })
        .from(
          sql`${events} INDEXED BY events_item_lifecycle_thread_item_sequence_idx`,
        )
        .where(
          and(
            eq(events.threadId, args.threadId),
            inArray(events.itemId, [...itemIds]),
            sql`${events.type} IN (
              'item/started',
              'item/completed',
              'item/backgroundTask/completed'
            )`,
            lte(events.sequence, args.maxSeq),
          ),
        ),
  );
  return Math.max(
    0,
    ...[...turnSequences, ...childSequences, ...openItemSequences].map(
      (row) => row.sequence ?? 0,
    ),
  );
}
