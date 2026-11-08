import { and, eq, inArray, sql } from "drizzle-orm";
import type { DbConnection } from "../connection.js";
import { threadTurnTimelinePlans } from "../schema.js";
import { queryRawRowsInSqliteVariableBatches } from "./sqlite-variable-batches.js";

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
  return queryRawRowsInSqliteVariableBatches<ThreadTurnTimelinePlanRecord>(
    db,
    args.turnIds,
    (turnIds) =>
    db
      .select({
        planJson: sql<string>`${threadTurnTimelinePlans.planJson}`.as(
          "planJson",
        ),
        projectionKey: sql<string>`${threadTurnTimelinePlans.projectionKey}`.as(
          "projectionKey",
        ),
        turnId: sql<string>`${threadTurnTimelinePlans.turnId}`.as("turnId"),
        watermark: sql<number>`${threadTurnTimelinePlans.watermark}`.as(
          "watermark",
        ),
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
  const list = (values: readonly string[]) =>
    sql.join(
      values.map((value) => sql`${value}`),
      sql`, `,
    );
  const sequences = [
    ...db.all<{ sequence: number | null }>(sql`
      SELECT MAX(sequence) AS sequence
      FROM events INDEXED BY events_thread_turn_type_item_sequence_idx
      WHERE thread_id = ${args.threadId}
        AND turn_id = ${args.turnId}
        AND sequence <= ${args.maxSeq}
    `),
    ...queryRawRowsInSqliteVariableBatches<{ sequence: number | null }>(
      db,
      args.delegatingItemIds,
      (itemIds) => sql`
        SELECT MAX(sequence) AS sequence
        FROM events INDEXED BY events_parent_tool_call_thread_parent_sequence_idx
        WHERE thread_id = ${args.threadId}
          AND parent_tool_call_id IN (${list(itemIds)})
          AND sequence <= ${args.maxSeq}
      `,
    ),
    ...queryRawRowsInSqliteVariableBatches<{ sequence: number | null }>(
      db,
      args.openItemIds,
      (itemIds) => sql`
        SELECT MAX(sequence) AS sequence
        FROM events INDEXED BY events_item_lifecycle_thread_item_sequence_idx
        WHERE thread_id = ${args.threadId}
          AND item_id IN (${list(itemIds)})
          AND type IN (
            'item/started',
            'item/completed',
            'item/backgroundTask/completed'
          )
          AND sequence <= ${args.maxSeq}
      `,
    ),
  ];
  return Math.max(0, ...sequences.map((row) => row.sequence ?? 0));
}
