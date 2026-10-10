import type { TimelineRow } from "@bb/server-contract";
import type {
  EventProjection,
  EventProjectionMessage,
} from "../src/event-projection-types.js";
import { getProjectionEntryMessages } from "../src/event-projection-flatten.js";
import type { ThreadEventWithMeta } from "../src/group-event-projection-turns.js";

export function assertTimelineSourceOwnership(
  events: readonly ThreadEventWithMeta[],
  projection: EventProjection,
  rows: readonly TimelineRow[],
  pendingMessages: readonly EventProjectionMessage[],
): void {
  const sourceByRowId = new Map<
    string,
    Pick<EventProjectionMessage, "threadId" | "sourceEvent">
  >();
  function collect(current: EventProjection, prefix: string): void {
    for (const entry of current.entries) {
      for (const message of getProjectionEntryMessages(entry)) {
        const id = `${prefix}${message.id}`;
        if (sourceByRowId.has(id))
          throw new Error(`Duplicate projected message ${id}`);
        if (message.kind === "file-edit" && message.changes.length > 0) {
          for (const [index] of message.changes.entries()) {
            sourceByRowId.set(`${id}:file-change:${index}`, {
              threadId: message.threadId,
              sourceEvent: {
                seq: message.sourceEvent.seq,
                part: message.sourceEvent.part + index,
              },
            });
          }
        } else {
          sourceByRowId.set(id, message);
        }
        if (message.kind === "delegation") {
          collect(message.childProjection, `${id}:child:`);
        }
      }
    }
  }
  collect(projection, "");
  for (const message of pendingMessages) sourceByRowId.set(message.id, message);
  const eventsByIdentity = new Map(
    events.map((value) => [
      JSON.stringify([value.event.threadId, value.meta.seq]),
      value.event,
    ]),
  );
  const ownerBySource = new Map<string, string>();
  const rowIds = new Set<string>();
  function visit(current: readonly TimelineRow[]): void {
    for (const row of current) {
      if (rowIds.has(row.id))
        throw new Error(`Duplicate timeline row ${row.id}`);
      rowIds.add(row.id);
      if (row.kind === "turn") {
        visit(row.children ?? []);
        continue;
      }
      const source = sourceByRowId.get(row.id);
      if (!source)
        throw new Error(`Missing source identity for timeline row ${row.id}`);
      const {
        threadId,
        sourceEvent: { seq, part },
      } = source;
      const event = eventsByIdentity.get(JSON.stringify([threadId, seq]));
      if (!event)
        throw new Error(`Missing source event for timeline row ${row.id}`);
      const partCount =
        event.type === "client/turn/requested"
          ? (event.inputGroups?.length ?? 1)
          : (event.type === "item/started" ||
                event.type === "item/completed") &&
              event.item.type === "fileChange"
            ? Math.max(1, event.item.changes.length)
            : 1;
      if (!Number.isInteger(part) || part < 0 || part >= partCount)
        throw new Error(`Invalid source part for timeline row ${row.id}`);
      const key = JSON.stringify([threadId, seq, part]);
      const previous = ownerBySource.get(key);
      if (previous)
        throw new Error(
          `Duplicate source ownership ${key}: ${previous} and ${row.id}`,
        );
      ownerBySource.set(key, row.id);
      if (row.kind === "work" && row.workKind === "delegation")
        visit(row.childRows ?? []);
    }
  }
  visit(rows);
}
