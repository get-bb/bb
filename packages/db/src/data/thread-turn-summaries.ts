import { and, eq, inArray, sql } from "drizzle-orm";
import type { DbConnection, DbQueryConnection } from "../connection.js";
import { threadConversationOutlines, threadTurnSummaries } from "../schema.js";
import { queryInSqliteVariableBatches } from "./sqlite-variable-batches.js";

export interface ThreadTurnSummaryRecord {
  projectionKey: string;
  summaryJson: string;
  turnId: string;
  validatedThrough: number;
}

export interface CompletedRootTurn {
  end: number;
  startedSequence: number;
}

export interface EventTurnRef {
  itemId: string | null;
  parentToolCallId: string | null;
  sequence: number;
  turnId: string | null;
}

function sqlList(values: readonly string[]) {
  return sql.join(
    values.map((value) => sql`${value}`),
    sql`, `,
  );
}

export function listThreadTurnSummaryRecords(
  db: DbConnection,
  args: { threadId: string; turnIds: readonly string[] },
): ThreadTurnSummaryRecord[] {
  return queryInSqliteVariableBatches({
    dedupeKey: (turnId) => turnId,
    fixedVariableCount: 1,
    queryBatch: (turnIds) =>
      db
        .select({
          projectionKey: threadTurnSummaries.projectionKey,
          summaryJson: threadTurnSummaries.summaryJson,
          turnId: threadTurnSummaries.turnId,
          validatedThrough: threadTurnSummaries.validatedThrough,
        })
        .from(threadTurnSummaries)
        .where(
          and(
            eq(threadTurnSummaries.threadId, args.threadId),
            inArray(threadTurnSummaries.turnId, [...turnIds]),
          ),
        )
        .all(),
    values: args.turnIds,
    variableCountPerValue: 1,
  });
}

export function upsertThreadTurnSummaryRecords(
  db: DbConnection,
  args: { records: readonly ThreadTurnSummaryRecord[]; threadId: string },
): void {
  for (const record of args.records) {
    db.insert(threadTurnSummaries)
      .values({ ...record, threadId: args.threadId })
      .onConflictDoUpdate({
        target: [threadTurnSummaries.threadId, threadTurnSummaries.turnId],
        set: {
          projectionKey: record.projectionKey,
          summaryJson: record.summaryJson,
          validatedThrough: record.validatedThrough,
        },
      })
      .run();
  }
}

export function markThreadTurnSummariesValidated(
  db: DbConnection,
  args: {
    threadId: string;
    turnIds: readonly string[];
    validatedThrough: number;
  },
): void {
  queryInSqliteVariableBatches({
    dedupeKey: (turnId) => turnId,
    fixedVariableCount: 2,
    queryBatch: (turnIds) => {
      db.update(threadTurnSummaries)
        .set({ validatedThrough: args.validatedThrough })
        .where(
          and(
            eq(threadTurnSummaries.threadId, args.threadId),
            inArray(threadTurnSummaries.turnId, [...turnIds]),
          ),
        )
        .run();
      return [];
    },
    values: args.turnIds,
    variableCountPerValue: 1,
  });
}

export function deleteStoredThreadTimelineProjections(
  db: DbQueryConnection,
  threadId: string,
): void {
  db.delete(threadConversationOutlines)
    .where(eq(threadConversationOutlines.threadId, threadId))
    .run();
  db.delete(threadTurnSummaries)
    .where(eq(threadTurnSummaries.threadId, threadId))
    .run();
}

export function listCompletedRootTurns(
  db: DbConnection,
  args: { maxSeq: number; threadId: string; turnIds: readonly string[] },
): Map<string, CompletedRootTurn> {
  const rows = queryInSqliteVariableBatches({
    dedupeKey: (turnId) => turnId,
    fixedVariableCount: 2,
    queryBatch: (turnIds) =>
      db.all<{
        nested: number;
        sequence: number;
        turnId: string;
        type: string;
      }>(sql`
        SELECT turn_id AS turnId, type, sequence,
          parent_tool_call_id IS NOT NULL AS nested
        FROM events INDEXED BY events_thread_turn_type_item_sequence_idx
        WHERE thread_id = ${args.threadId}
          AND turn_id IN (${sqlList(turnIds)})
          AND type IN ('turn/started', 'turn/completed')
          AND sequence <= ${args.maxSeq}
      `),
    values: args.turnIds,
    variableCountPerValue: 1,
  });
  const started = new Map<string, number>();
  const ended = new Map<string, number>();
  const nested = new Set<string>();
  for (const row of rows) {
    if (row.type === "turn/started") {
      if (row.nested === 1) nested.add(row.turnId);
      started.set(
        row.turnId,
        Math.min(started.get(row.turnId) ?? row.sequence, row.sequence),
      );
    } else {
      ended.set(
        row.turnId,
        Math.max(ended.get(row.turnId) ?? row.sequence, row.sequence),
      );
    }
  }
  const turns = new Map<string, CompletedRootTurn>();
  for (const [turnId, startedSequence] of started) {
    const end = ended.get(turnId);
    if (end !== undefined && !nested.has(turnId)) {
      turns.set(turnId, { end, startedSequence });
    }
  }
  return turns;
}

export function listEventTurnRefsBetween(
  db: DbConnection,
  args: { afterSequence: number; threadId: string; throughSequence: number },
): EventTurnRef[] {
  if (args.throughSequence <= args.afterSequence) return [];
  return db.all<EventTurnRef>(sql`
    SELECT turn_id AS turnId, item_id AS itemId,
      parent_tool_call_id AS parentToolCallId, sequence
    FROM events INDEXED BY events_thread_sequence_idx
    WHERE thread_id = ${args.threadId}
      AND sequence > ${args.afterSequence}
      AND sequence <= ${args.throughSequence}
  `);
}
