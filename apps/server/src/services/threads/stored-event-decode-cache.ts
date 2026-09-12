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
  current: Map<string, StoredEventDecodeEntry>;
  currentDataChars: number;
  previous: Map<string, StoredEventDecodeEntry>;
  previousDataChars: number;
}

export const STORED_EVENT_DECODE_CACHE_MAX_ENTRIES = 100_000;
export const STORED_EVENT_DECODE_CACHE_MAX_DATA_CHARS = 8_000_000;

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
  return {
    dataChars: cache.currentDataChars + cache.previousDataChars,
    entryCount: cache.current.size + cache.previous.size,
  };
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
    cache = {
      byRow: new WeakMap(),
      current: new Map(),
      currentDataChars: 0,
      previous: new Map(),
      previousDataChars: 0,
    };
    decodeCaches.set(db, cache);
  }
  return cache;
}

function rememberEntry(
  cache: StoredEventDecodeCache,
  rowId: string,
  entry: StoredEventDecodeEntry,
): void {
  const generationEntryLimit = STORED_EVENT_DECODE_CACHE_MAX_ENTRIES / 2;
  const generationDataCharLimit = STORED_EVENT_DECODE_CACHE_MAX_DATA_CHARS / 2;
  if (entry.data.length > generationDataCharLimit) {
    return;
  }
  const replaced = cache.current.get(rowId);
  if (replaced !== undefined) {
    cache.current.delete(rowId);
    cache.currentDataChars -= replaced.data.length;
  }
  if (
    cache.current.size + 1 > generationEntryLimit ||
    cache.currentDataChars + entry.data.length > generationDataCharLimit
  ) {
    cache.previous = cache.current;
    cache.previousDataChars = cache.currentDataChars;
    cache.current = new Map();
    cache.currentDataChars = 0;
  }
  cache.current.set(rowId, entry);
  cache.currentDataChars += entry.data.length;
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
  const current = cache.current.get(row.id);
  if (current !== undefined && entryMatchesRow(current, row)) {
    cache.byRow.set(row, current);
    return current.event;
  }
  const previous = cache.previous.get(row.id);
  if (previous !== undefined && entryMatchesRow(previous, row)) {
    rememberEntry(cache, row.id, previous);
    cache.byRow.set(row, previous);
    return previous.event;
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
