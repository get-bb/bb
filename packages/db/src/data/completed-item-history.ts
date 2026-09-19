import type { JsonObject } from "@bb/domain";
import { and, inArray, isNotNull, sql } from "drizzle-orm";
import type { DbQueryConnection } from "../connection.js";
import { events } from "../schema.js";
import {
  decodeCompletedItemHistory,
  parseHistoryPayload,
  restoreHistoryPayloadObject,
} from "../completed-item-history.js";
import type { StoredEventRow } from "./events.js";

export type ProjectionStoredEventRow = StoredEventRow & {
  parsedData?: JsonObject;
};

function reconstructCompletedItemHistory(metadata: string, ownerData: string) {
  const history = decodeCompletedItemHistory(metadata);
  const payload = parseHistoryPayload(ownerData);
  return {
    sequence: history.sequence,
    createdAt: history.createdAt,
    payload,
    records: history.records.map((record) => {
      const data = restoreHistoryPayloadObject(record, payload);
      return {
        id: record.id,
        sequence: record.sequence,
        createdAt: record.createdAt,
        type: record.type,
        itemKind: record.itemKind,
        data: JSON.stringify(data),
        payload: data,
      };
    }),
  };
}

interface ReconstructionEntry {
  metadata: string;
  ownerData: string;
  history: ReturnType<typeof reconstructCompletedItemHistory>;
  chars: number;
  records: number;
}

interface ReconstructionCache {
  entries: Map<string, ReconstructionEntry>;
  chars: number;
  records: number;
}

const reconstructionCaches = new WeakMap<
  DbQueryConnection,
  ReconstructionCache
>();
const RECONSTRUCTION_CACHE_MAX_RECORDS = 10_000;
const RECONSTRUCTION_CACHE_MAX_CHARS = 8_000_000;

function reconstructCached(
  db: DbQueryConnection,
  id: string,
  metadata: string,
  ownerData: string,
) {
  let cache = reconstructionCaches.get(db);
  if (cache === undefined) {
    cache = { entries: new Map(), chars: 0, records: 0 };
    reconstructionCaches.set(db, cache);
  }
  const previous = cache.entries.get(id);
  if (previous !== undefined) {
    cache.entries.delete(id);
    cache.chars -= previous.chars;
    cache.records -= previous.records;
    if (previous.metadata === metadata && previous.ownerData === ownerData) {
      cache.entries.set(id, previous);
      cache.chars += previous.chars;
      cache.records += previous.records;
      return previous.history;
    }
  }
  const history = reconstructCompletedItemHistory(metadata, ownerData);
  const chars =
    metadata.length +
    ownerData.length +
    history.records.reduce((sum, record) => sum + record.data.length, 0);
  const records = history.records.length + 1;
  if (
    chars > RECONSTRUCTION_CACHE_MAX_CHARS ||
    records > RECONSTRUCTION_CACHE_MAX_RECORDS
  )
    return history;
  while (
    cache.records + records > RECONSTRUCTION_CACHE_MAX_RECORDS ||
    cache.chars + chars > RECONSTRUCTION_CACHE_MAX_CHARS
  ) {
    const oldest = cache.entries.entries().next().value;
    if (oldest === undefined) break;
    cache.entries.delete(oldest[0]);
    cache.chars -= oldest[1].chars;
    cache.records -= oldest[1].records;
  }
  cache.entries.set(id, { metadata, ownerData, history, chars, records });
  cache.chars += chars;
  cache.records += records;
  return history;
}

function expandSelectedCompletedItemRowsInternal(
  db: DbQueryConnection,
  rows: readonly StoredEventRow[],
  throughSequence: number,
  includeParsedData: boolean,
): ProjectionStoredEventRow[] {
  const ids = [
    ...new Set(
      rows
        .filter(
          (row) =>
            row.type === "item/completed" &&
            row.completedItemHistory === undefined,
        )
        .map((row) => row.id),
    ),
  ];
  const histories = new Map<string, string>();
  for (const row of rows) {
    if (row.type === "item/completed" && row.completedItemHistory != null)
      histories.set(row.id, row.completedItemHistory);
  }
  if (ids.length > 0) {
    const selected = db
      .select({ id: events.id, history: events.completedItemHistory })
      .from(events)
      .where(
        and(
          inArray(
            events.id,
            sql`(select value from json_each(${JSON.stringify(ids)}))`,
          ),
          isNotNull(events.completedItemHistory),
        ),
      )
      .all();
    for (const row of selected) {
      if (row.history !== null) histories.set(row.id, row.history);
    }
  }
  const expanded: ProjectionStoredEventRow[] = [];
  for (const selectedRow of rows) {
    const metadata = histories.get(selectedRow.id);
    if (metadata === undefined && includeParsedData) {
      if (selectedRow.sequence <= throughSequence) expanded.push(selectedRow);
      continue;
    }
    const { completedItemHistory: _history, ...row } = selectedRow;
    if (metadata === undefined) {
      if (row.sequence <= throughSequence) expanded.push(row);
      continue;
    }
    const history = reconstructCached(db, row.id, metadata, row.data);
    if (history.sequence <= throughSequence)
      expanded.push({
        ...row,
        sequence: history.sequence,
        createdAt: history.createdAt,
        ...(includeParsedData ? { parsedData: history.payload } : {}),
      });
    for (const record of history.records) {
      if (record.sequence <= throughSequence)
        expanded.push({
          ...row,
          id: record.id,
          sequence: record.sequence,
          createdAt: record.createdAt,
          type: record.type,
          itemKind: record.itemKind,
          data: record.data,
          ...(includeParsedData ? { parsedData: record.payload } : {}),
        });
    }
  }
  return expanded.sort((a, b) => a.sequence - b.sequence);
}

export function expandSelectedCompletedItemRows(
  db: DbQueryConnection,
  rows: readonly StoredEventRow[],
  throughSequence = Number.MAX_SAFE_INTEGER,
): StoredEventRow[] {
  return expandSelectedCompletedItemRowsInternal(
    db,
    rows,
    throughSequence,
    false,
  );
}

export function expandSelectedCompletedItemRowsForProjection(
  db: DbQueryConnection,
  rows: readonly StoredEventRow[],
  throughSequence = Number.MAX_SAFE_INTEGER,
): ProjectionStoredEventRow[] {
  return expandSelectedCompletedItemRowsInternal(
    db,
    rows,
    throughSequence,
    true,
  );
}
