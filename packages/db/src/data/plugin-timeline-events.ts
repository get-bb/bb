import { and, eq, gt, inArray, sql } from "drizzle-orm";
import {
  pluginTimelineEventSchema,
  threadEventTurnStatusSchema,
  type PluginTimelineEvent,
  type PluginTimelineEventSeed,
  type PluginTimelineEventUpdate,
} from "@bb/domain";
import type { DbQueryConnection } from "../connection.js";
import { events, pluginTimelineEvents } from "../schema.js";

export function insertPluginTimelineEvent(
  db: DbQueryConnection,
  args: {
    threadId: string;
    requestId: string;
    requestSequence: number;
    seed: PluginTimelineEventSeed;
  },
): void {
  const request = db
    .select({ id: events.id, createdAt: events.createdAt })
    .from(events)
    .where(
      and(
        eq(events.threadId, args.threadId),
        eq(events.sequence, args.requestSequence),
      ),
    )
    .get();
  if (!request)
    throw new Error("Timeline event requires a stored turn request");
  db.insert(pluginTimelineEvents)
    .values({
      threadId: args.threadId,
      pluginId: args.seed.pluginId,
      id: args.seed.id,
      rendererId: args.seed.rendererId,
      requestEventId: request.id,
      requestId: args.requestId,
      requestSequence: args.requestSequence,
      payloadJson: JSON.stringify(args.seed.payload),
      presentationJson: JSON.stringify(args.seed.presentation),
      status: null,
      createdAt: request.createdAt,
      updatedAt: request.createdAt,
    })
    .run();
}

type StoredMarker = typeof pluginTimelineEvents.$inferSelect;

function materialize(
  db: DbQueryConnection,
  row: StoredMarker,
): PluginTimelineEvent {
  const accepted = db
    .select({ turnId: events.turnId })
    .from(events)
    .where(
      and(
        eq(events.threadId, row.threadId),
        eq(events.type, "turn/input/accepted"),
        sql`json_extract(${events.data}, '$.clientRequestId') = ${row.requestId}`,
      ),
    )
    .orderBy(events.sequence)
    .limit(1)
    .get();
  const started = accepted
    ? null
    : db
        .select({ turnId: events.turnId })
        .from(events)
        .where(
          and(
            eq(events.threadId, row.threadId),
            eq(events.type, "turn/started"),
            gt(events.sequence, row.requestSequence),
            sql`EXISTS (SELECT 1 FROM events request WHERE request.id = ${row.requestEventId} AND (json_extract(request.data, '$.target.kind') IN ('thread-start', 'new-turn') OR (json_extract(request.data, '$.target.kind') = 'auto' AND json_extract(request.data, '$.target.expectedTurnId') IS NULL)))`,
            sql`NOT EXISTS (SELECT 1 FROM events next_request WHERE next_request.thread_id = ${row.threadId} AND next_request.type = 'client/turn/requested' AND next_request.sequence > ${row.requestSequence} AND next_request.sequence < ${events.sequence})`,
          ),
        )
        .orderBy(events.sequence)
        .limit(1)
        .get();
  const turnId = accepted?.turnId ?? started?.turnId ?? null;
  const settled = db
    .select({
      type: events.type,
      data: events.data,
      createdAt: events.createdAt,
    })
    .from(events)
    .where(
      and(
        eq(events.threadId, row.threadId),
        gt(events.sequence, row.requestSequence),
        sql`(
      (${events.type} = 'client/turn/rejected' AND json_extract(${events.data}, '$.requestId') = ${row.requestId})
      OR (${events.type} = 'turn/completed' AND ${events.turnId} = ${turnId})
      OR ((${events.type} = 'system/thread/interrupted' OR (
        ${turnId} IS NULL AND ${events.type} = 'system/error'
        AND json_extract(${events.data}, '$.code') IN ('thread_command_failed', 'thread_provisioning_failed')
      )) AND NOT EXISTS (
        SELECT 1 FROM events next_request
        WHERE next_request.thread_id = ${row.threadId} AND next_request.type = 'client/turn/requested'
          AND next_request.sequence > ${row.requestSequence} AND next_request.sequence < ${events.sequence}
      ))
    )`,
      ),
    )
    .orderBy(events.sequence)
    .limit(1)
    .get();
  const turnStatus =
    settled?.type === "turn/completed"
      ? threadEventTurnStatusSchema.parse(JSON.parse(settled.data).status)
      : null;
  const status =
    row.status ??
    (settled?.type === "client/turn/rejected" ||
    settled?.type === "system/error" ||
    turnStatus === "failed"
      ? "error"
      : settled?.type === "system/thread/interrupted" ||
          turnStatus === "interrupted"
        ? "interrupted"
        : turnStatus === "completed"
          ? "completed"
          : "pending");
  return pluginTimelineEventSchema.parse({
    id: row.id,
    pluginId: row.pluginId,
    rendererId: row.rendererId,
    payload: JSON.parse(row.payloadJson),
    presentation: JSON.parse(row.presentationJson),
    threadId: row.threadId,
    requestId: row.requestId,
    requestSequence: row.requestSequence,
    turnId,
    status,
    startedAt: row.createdAt,
    completedAt:
      status === "pending"
        ? null
        : row.status === null
          ? (settled?.createdAt ?? row.updatedAt)
          : row.updatedAt,
  });
}

function markerWhere(args: {
  threadId: string;
  pluginId: string;
  eventId: string;
}) {
  return and(
    eq(pluginTimelineEvents.threadId, args.threadId),
    eq(pluginTimelineEvents.pluginId, args.pluginId),
    eq(pluginTimelineEvents.id, args.eventId),
  );
}

export function getPluginTimelineEvent(
  db: DbQueryConnection,
  args: { threadId: string; pluginId: string; eventId: string },
): PluginTimelineEvent | null {
  const row = db
    .select()
    .from(pluginTimelineEvents)
    .where(markerWhere(args))
    .get();
  return row ? materialize(db, row) : null;
}

export function listPluginTimelineEvents(
  db: DbQueryConnection,
  args: { threadId: string; requestSequences: number[] },
): PluginTimelineEvent[] {
  if (args.requestSequences.length === 0) return [];
  return db
    .select()
    .from(pluginTimelineEvents)
    .where(
      and(
        eq(pluginTimelineEvents.threadId, args.threadId),
        inArray(pluginTimelineEvents.requestSequence, args.requestSequences),
      ),
    )
    .orderBy(pluginTimelineEvents.requestSequence)
    .all()
    .map((row) => materialize(db, row));
}

export function updatePluginTimelineEvent(
  db: DbQueryConnection,
  args: {
    threadId: string;
    pluginId: string;
    eventId: string;
    update: PluginTimelineEventUpdate;
  },
): PluginTimelineEvent | null {
  db.update(pluginTimelineEvents)
    .set({
      status: args.update.status,
      ...(args.update.payload === undefined
        ? {}
        : { payloadJson: JSON.stringify(args.update.payload) }),
      ...(args.update.presentation === undefined
        ? {}
        : { presentationJson: JSON.stringify(args.update.presentation) }),
      updatedAt: Date.now(),
    })
    .where(markerWhere(args))
    .run();
  return getPluginTimelineEvent(db, args);
}
