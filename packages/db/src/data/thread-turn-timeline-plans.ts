import { and, eq, inArray, sql } from "drizzle-orm";
import type { DbConnection } from "../connection.js";
import { threadTurnTimelinePlans } from "../schema.js";

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
  if (args.turnIds.length === 0) return [];
  return db
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
        inArray(threadTurnTimelinePlans.turnId, [...args.turnIds]),
      ),
    )
    .all();
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
  const parts = [
    sql`SELECT MAX(sequence) AS sequence
      FROM events INDEXED BY events_thread_turn_type_item_sequence_idx
      WHERE thread_id = ${args.threadId}
        AND turn_id = ${args.turnId}
        AND sequence <= ${args.maxSeq}`,
  ];
  if (args.delegatingItemIds.length > 0) {
    parts.push(sql`SELECT MAX(sequence) AS sequence
      FROM events INDEXED BY events_parent_tool_call_thread_parent_sequence_idx
      WHERE thread_id = ${args.threadId}
        AND parent_tool_call_id IN (${list(args.delegatingItemIds)})
        AND sequence <= ${args.maxSeq}`);
  }
  if (args.openItemIds.length > 0) {
    parts.push(sql`SELECT MAX(sequence) AS sequence
      FROM events INDEXED BY events_item_lifecycle_thread_item_sequence_idx
      WHERE thread_id = ${args.threadId}
        AND item_id IN (${list(args.openItemIds)})
        AND type IN (
          'item/started',
          'item/completed',
          'item/backgroundTask/completed'
        )
        AND sequence <= ${args.maxSeq}`);
  }
  return Math.max(
    0,
    ...parts.map(
      (part) => db.all<{ sequence: number | null }>(part)[0]?.sequence ?? 0,
    ),
  );
}
