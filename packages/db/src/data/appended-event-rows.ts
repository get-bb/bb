import type { DbConnection } from "../connection.js";
import type { StoredEventRow } from "./events.js";

const MAX_THREADS = 64;
const MAX_ROWS_PER_THREAD = 128;
const MAX_ROW_DATA_CHARS = 64_000;

const appendedRows = new WeakMap<
  DbConnection,
  Map<string, Map<string, StoredEventRow>>
>();

export function rememberAppendedEventRow(
  db: DbConnection,
  row: StoredEventRow,
): void {
  let threads = appendedRows.get(db);
  if (threads === undefined) {
    threads = new Map();
    appendedRows.set(db, threads);
  }
  let rows = threads.get(row.threadId);
  if (rows === undefined) {
    rows = new Map();
  } else {
    threads.delete(row.threadId);
  }
  threads.set(row.threadId, rows);
  if (row.data.length <= MAX_ROW_DATA_CHARS) {
    rows.set(row.id, row);
  }
  while (rows.size > MAX_ROWS_PER_THREAD) {
    rows.delete(rows.keys().next().value!);
  }
  while (threads.size > MAX_THREADS) {
    threads.delete(threads.keys().next().value!);
  }
}

export function findAppendedEventRows(
  db: DbConnection,
  threadId: string,
  ids: readonly string[],
): StoredEventRow[] | null {
  const rows = appendedRows.get(db)?.get(threadId);
  if (rows === undefined) return null;
  const found: StoredEventRow[] = [];
  for (const id of ids) {
    const row = rows.get(id);
    if (row === undefined) return null;
    found.push(row);
  }
  return found;
}
