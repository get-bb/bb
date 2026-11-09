import type { DbConnection, StoredEventRow } from "@bb/db";
import type { ThreadEvent } from "@bb/domain";
import type { ThreadEventWithMeta } from "@bb/thread-view";
import { decodeStoredEventRowCached } from "./stored-event-decode-cache.js";

export interface DecodedTimelineRows {
  dataBytes: number;
  events: readonly ThreadEventWithMeta[];
}

const storedEventRowByteLengths = new WeakMap<StoredEventRow, number>();

export function withRowMeta(
  row: StoredEventRow,
  event: ThreadEvent,
): ThreadEventWithMeta {
  return {
    event,
    meta: {
      id: row.id,
      seq: row.sequence,
      createdAt: row.createdAt,
    },
  };
}

function storedEventRowByteLength(row: StoredEventRow): number {
  let byteLength = storedEventRowByteLengths.get(row);
  if (byteLength === undefined) {
    byteLength = Buffer.byteLength(row.data, "utf8");
    storedEventRowByteLengths.set(row, byteLength);
  }
  return byteLength;
}

export function byteLengthOfStoredEventRows(
  rows: readonly StoredEventRow[],
): number {
  let byteLength = 0;
  for (const row of rows) {
    byteLength += storedEventRowByteLength(row);
  }
  return byteLength;
}

export function decodeTimelineSelectionRows(
  db: DbConnection,
  rows: readonly StoredEventRow[],
  decodedPrefix: DecodedTimelineRows | null,
): DecodedTimelineRows {
  const events = decodedPrefix?.events.slice() ?? [];
  let dataBytes = decodedPrefix?.dataBytes ?? 0;
  for (let index = events.length; index < rows.length; index += 1) {
    const row = rows[index]!;
    events.push(withRowMeta(row, decodeStoredEventRowCached(db, row)));
    dataBytes += storedEventRowByteLength(row);
  }
  return { dataBytes, events };
}
