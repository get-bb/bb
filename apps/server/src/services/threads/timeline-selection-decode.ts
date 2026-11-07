import {
  getDatabaseDataVersion,
  getThreadEventRewriteGeneration,
  type DbConnection,
  type StoredEventRow,
} from "@bb/db";
import type { ThreadEvent } from "@bb/domain";
import type { ThreadEventWithMeta } from "@bb/thread-view";
import { decodeStoredEventRowCached } from "./stored-event-decode-cache.js";

interface DecodedTimelineSelection {
  dataBytes: number;
  dataVersion: number;
  events: readonly ThreadEventWithMeta[];
  generation: number;
  rows: readonly StoredEventRow[];
}

export interface DecodedTimelineRows {
  dataBytes: number;
  events: ThreadEventWithMeta[];
}

const DECODED_SELECTIONS_PER_THREAD = 4;
const DECODED_SELECTION_THREADS = 64;

const decodedSelections = new WeakMap<
  DbConnection,
  Map<string, DecodedTimelineSelection[]>
>();
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

function startsWithRows(
  rows: readonly StoredEventRow[],
  prefix: readonly StoredEventRow[],
): boolean {
  if (prefix.length === 0 || prefix.length > rows.length) return false;
  if (rows[prefix.length - 1] !== prefix[prefix.length - 1]) return false;
  for (let index = 0; index < prefix.length; index += 1) {
    if (rows[index] !== prefix[index]) return false;
  }
  return true;
}

export function clearDecodedTimelineSelections(db: DbConnection): void {
  decodedSelections.delete(db);
}

export function decodeTimelineSelectionRows(
  db: DbConnection,
  threadId: string,
  rows: readonly StoredEventRow[],
): DecodedTimelineRows {
  let threads = decodedSelections.get(db);
  if (threads === undefined) {
    threads = new Map();
    decodedSelections.set(db, threads);
  }
  const generation = getThreadEventRewriteGeneration(threadId);
  const dataVersion = getDatabaseDataVersion(db);
  const kept = (threads.get(threadId) ?? []).filter(
    (entry) =>
      entry.generation === generation && entry.dataVersion === dataVersion,
  );
  const prefix = kept.find((entry) => startsWithRows(rows, entry.rows));
  const events = prefix === undefined ? [] : prefix.events.slice();
  let dataBytes = prefix?.dataBytes ?? 0;
  for (let index = events.length; index < rows.length; index += 1) {
    const row = rows[index]!;
    events.push(withRowMeta(row, decodeStoredEventRowCached(db, row)));
    dataBytes += storedEventRowByteLength(row);
  }
  threads.delete(threadId);
  threads.set(
    threadId,
    [
      { dataBytes, dataVersion, events, generation, rows },
      ...kept.filter((entry) => entry !== prefix && entry.rows !== rows),
    ].slice(0, DECODED_SELECTIONS_PER_THREAD),
  );
  while (threads.size > DECODED_SELECTION_THREADS) {
    threads.delete(threads.keys().next().value!);
  }
  return { dataBytes, events: events.slice() };
}
