import type { DbConnection, StoredEventRow } from "@bb/db";
import type { ThreadEvent } from "@bb/domain";
import { parseStoredEvent } from "./thread-data.js";

interface StoredEventDecodeEntry {
  data: string;
  event: ThreadEvent;
  providerThreadId: string | null;
  scopeKind: StoredEventRow["scopeKind"];
  threadId: string;
  turnId: string | null;
  type: StoredEventRow["type"];
}

interface StoredEventDecodeCache {
  byRow: WeakMap<StoredEventRow, StoredEventDecodeEntry>;
  dataChars: number;
  entries: Map<string, StoredEventDecodeEntry>;
}

export const STORED_EVENT_DECODE_CACHE_MAX_ENTRIES = 100_000;
export const STORED_EVENT_DECODE_CACHE_MAX_DATA_CHARS = 16_000_000;
const STORED_EVENT_DECODE_CACHE_EVICTED_ENTRIES =
  STORED_EVENT_DECODE_CACHE_MAX_ENTRIES * 0.9;
const STORED_EVENT_DECODE_CACHE_EVICTED_DATA_CHARS =
  STORED_EVENT_DECODE_CACHE_MAX_DATA_CHARS * 0.9;

const decodeCaches = new WeakMap<DbConnection, StoredEventDecodeCache>();
let freezeDecodedEvents = false;

export function setStoredEventDecodeCacheFreezeForTesting(
  enabled: boolean,
): void {
  freezeDecodedEvents = enabled;
}

export function clearStoredEventDecodeCache(db: DbConnection): void {
  decodeCaches.delete(db);
}

export function readStoredEventDecodeCacheSize(db: DbConnection): {
  dataChars: number;
  entryCount: number;
} {
  const cache = decodeCaches.get(db);
  if (cache === undefined) {
    return { dataChars: 0, entryCount: 0 };
  }
  return { dataChars: cache.dataChars, entryCount: cache.entries.size };
}

function deepFreeze(value: unknown): void {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return;
  }
  Object.freeze(value);
  for (const child of Object.values(value)) {
    deepFreeze(child);
  }
}

function entryMatchesRow(
  entry: StoredEventDecodeEntry,
  row: StoredEventRow,
): boolean {
  return (
    entry.type === row.type &&
    entry.threadId === row.threadId &&
    entry.providerThreadId === row.providerThreadId &&
    entry.scopeKind === row.scopeKind &&
    entry.turnId === row.turnId &&
    entry.data === row.data
  );
}

function getDecodeCache(db: DbConnection): StoredEventDecodeCache {
  let cache = decodeCaches.get(db);
  if (cache === undefined) {
    cache = { byRow: new WeakMap(), dataChars: 0, entries: new Map() };
    decodeCaches.set(db, cache);
  }
  return cache;
}

function forgetEntry(cache: StoredEventDecodeCache, rowId: string): void {
  const entry = cache.entries.get(rowId);
  if (entry === undefined) return;
  cache.entries.delete(rowId);
  cache.dataChars -= entry.data.length;
}

function rememberEntry(
  cache: StoredEventDecodeCache,
  rowId: string,
  entry: StoredEventDecodeEntry,
): void {
  forgetEntry(cache, rowId);
  if (entry.data.length > STORED_EVENT_DECODE_CACHE_MAX_DATA_CHARS / 2) {
    return;
  }
  cache.entries.set(rowId, entry);
  cache.dataChars += entry.data.length;
  if (
    cache.entries.size <= STORED_EVENT_DECODE_CACHE_MAX_ENTRIES &&
    cache.dataChars <= STORED_EVENT_DECODE_CACHE_MAX_DATA_CHARS
  ) {
    return;
  }
  for (const oldest of cache.entries.keys()) {
    if (
      cache.entries.size <= STORED_EVENT_DECODE_CACHE_EVICTED_ENTRIES &&
      cache.dataChars <= STORED_EVENT_DECODE_CACHE_EVICTED_DATA_CHARS
    ) {
      return;
    }
    forgetEntry(cache, oldest);
  }
}

export function decodeStoredEventRowCached(
  db: DbConnection,
  row: StoredEventRow,
): ThreadEvent {
  const cache = getDecodeCache(db);
  const byRow = cache.byRow.get(row);
  if (byRow !== undefined && entryMatchesRow(byRow, row)) {
    return byRow.event;
  }
  const cached = cache.entries.get(row.id);
  if (cached !== undefined && entryMatchesRow(cached, row)) {
    rememberEntry(cache, row.id, cached);
    cache.byRow.set(row, cached);
    return cached.event;
  }
  const event = parseStoredEvent(row);
  if (freezeDecodedEvents) {
    deepFreeze(event);
  }
  const entry: StoredEventDecodeEntry = {
    data: row.data,
    event,
    providerThreadId: row.providerThreadId,
    scopeKind: row.scopeKind,
    threadId: row.threadId,
    turnId: row.turnId,
    type: row.type,
  };
  rememberEntry(cache, row.id, entry);
  cache.byRow.set(row, entry);
  return event;
}
