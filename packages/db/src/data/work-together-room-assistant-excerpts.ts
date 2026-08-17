import { and, eq, inArray, sql } from "drizzle-orm";
import type { ThreadEventItemType, ThreadEventType } from "@bb/domain";

import type { DbQueryConnection } from "../connection.js";
import { events } from "../schema.js";

export type LatestCompletedAgentMessageExcerptRow = Readonly<{
  excerpt: string;
  threadId: string;
}>;

export class InvalidWorkTogetherRoomAssistantExcerptError extends Error {
  constructor() {
    super("invalid latest completed agent message");
    this.name = "InvalidWorkTogetherRoomAssistantExcerptError";
  }
}

function invalidLatestCompletedAgentMessage(): never {
  throw new InvalidWorkTogetherRoomAssistantExcerptError();
}

function parseCompletedAgentMessageExcerpt(data: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    invalidLatestCompletedAgentMessage();
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    invalidLatestCompletedAgentMessage();
  }
  if (!("item" in parsed)) invalidLatestCompletedAgentMessage();
  const item = parsed.item;
  if (item === null || typeof item !== "object" || Array.isArray(item)) {
    invalidLatestCompletedAgentMessage();
  }
  if (!("type" in item) || item.type !== "agentMessage") {
    invalidLatestCompletedAgentMessage();
  }
  if (!("text" in item) || typeof item.text !== "string") {
    invalidLatestCompletedAgentMessage();
  }
  return item.text;
}

/**
 * Latest already-public assistant excerpt per thread. Only completed
 * `agentMessage` items are considered; manager user messages are ignored.
 * Selection happens in SQL so callers do not load the event log.
 */
export function listLatestCompletedAgentMessageExcerptsByThreadIds(
  db: DbQueryConnection,
  threadIds: readonly string[],
): LatestCompletedAgentMessageExcerptRow[] {
  if (threadIds.length === 0) {
    return [];
  }

  const uniqueThreadIds = [...new Set(threadIds)];
  const completedType = "item/completed" satisfies ThreadEventType;
  const agentMessageKind = "agentMessage" satisfies ThreadEventItemType;
  const startedType = "turn/started" satisfies ThreadEventType;
  let rows: { data: string; threadId: string }[];
  try {
    rows = db
      .select({
        data: events.data,
        threadId: events.threadId,
      })
      .from(events)
      .where(
        and(
          inArray(events.threadId, uniqueThreadIds),
          eq(events.type, completedType),
          eq(events.itemKind, agentMessageKind),
          sql`${events.sequence} = (
            SELECT MAX(latest_message.sequence)
            FROM events AS latest_message
            WHERE latest_message.thread_id = ${events.threadId}
              AND latest_message.type = ${completedType}
              AND latest_message.item_kind = ${agentMessageKind}
              AND EXISTS (
                SELECT 1
                FROM events AS owning_turn
                WHERE owning_turn.thread_id = latest_message.thread_id
                  AND owning_turn.turn_id = latest_message.turn_id
                  AND owning_turn.type = ${startedType}
                  AND COALESCE(
                    json_extract(owning_turn.data, '$.parentToolCallId'),
                    ''
                  ) = ''
              )
              AND COALESCE(
                json_extract(latest_message.data, '$.item.parentToolCallId'),
                json_extract(latest_message.data, '$.parentToolCallId'),
                ''
              ) = ''
          )`,
        ),
      )
      .orderBy(events.threadId)
      .all();
  } catch {
    invalidLatestCompletedAgentMessage();
  }

  return rows.flatMap((row) => {
    const excerpt = parseCompletedAgentMessageExcerpt(row.data);
    if (excerpt.length === 0) return [];
    return [{ excerpt, threadId: row.threadId }];
  });
}
