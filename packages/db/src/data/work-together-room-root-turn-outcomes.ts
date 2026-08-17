import { and, eq, inArray, sql } from "drizzle-orm";
import type { ThreadEventType } from "@bb/domain";

import type { DbQueryConnection } from "../connection.js";
import { events } from "../schema.js";

const ROOT_TURN_TERMINAL_OUTCOMES = [
  "completed",
  "failed",
  "interrupted",
] as const;

export type RootTurnTerminalOutcome =
  (typeof ROOT_TURN_TERMINAL_OUTCOMES)[number];

export type LatestRootTurnTerminalOutcomeRow = Readonly<{
  outcome: RootTurnTerminalOutcome;
  threadId: string;
}>;

export class InvalidWorkTogetherRoomRootTurnOutcomeError extends Error {
  constructor() {
    super("invalid latest root-turn terminal outcome");
    this.name = "InvalidWorkTogetherRoomRootTurnOutcomeError";
  }
}

function isRootTurnTerminalOutcome(
  value: string,
): value is RootTurnTerminalOutcome {
  return ROOT_TURN_TERMINAL_OUTCOMES.some((outcome) => outcome === value);
}

/**
 * Latest durable root-turn terminal outcome per thread. Nested (parented)
 * turns are ignored; threads with no root completion are omitted. Selection
 * happens in SQL so callers do not load the event log.
 */
export function listLatestRootTurnTerminalOutcomesByThreadIds(
  db: DbQueryConnection,
  threadIds: readonly string[],
): LatestRootTurnTerminalOutcomeRow[] {
  if (threadIds.length === 0) {
    return [];
  }

  const uniqueThreadIds = [...new Set(threadIds)];
  const completedType = "turn/completed" satisfies ThreadEventType;
  const startedType = "turn/started" satisfies ThreadEventType;
  let rows: { outcome: string; threadId: string }[];
  try {
    rows = db
      .select({
        outcome: sql<string>`json_extract(${events.data}, '$.status')`,
        threadId: events.threadId,
      })
      .from(events)
      .where(
        and(
          inArray(events.threadId, uniqueThreadIds),
          eq(events.type, completedType),
          sql`${events.turnId} = (
            SELECT latest_root.turn_id
            FROM events AS latest_root
            WHERE latest_root.thread_id = ${events.threadId}
              AND latest_root.type = ${startedType}
              AND COALESCE(json_extract(latest_root.data, '$.parentToolCallId'), '') = ''
            ORDER BY latest_root.sequence DESC
            LIMIT 1
          )`,
          sql`${events.sequence} = (
            SELECT MAX(latest_completion.sequence)
            FROM events AS latest_completion
            WHERE latest_completion.thread_id = ${events.threadId}
              AND latest_completion.turn_id = ${events.turnId}
              AND latest_completion.type = ${completedType}
          )`,
        ),
      )
      .orderBy(events.threadId)
      .all();
  } catch {
    throw new InvalidWorkTogetherRoomRootTurnOutcomeError();
  }

  return rows.map((row) => {
    if (!isRootTurnTerminalOutcome(row.outcome)) {
      throw new InvalidWorkTogetherRoomRootTurnOutcomeError();
    }
    return { outcome: row.outcome, threadId: row.threadId };
  });
}
