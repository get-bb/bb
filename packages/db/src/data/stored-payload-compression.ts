import type { DbConnection } from "../connection.js";
import {
  encodeStoredText,
  STORED_TEXT_MAX_BYTES,
  STORED_TEXT_MIN_BYTES,
} from "../stored-text.js";
import { getAppSettings } from "./app-settings.js";

const PASS_BYTES = 1024 * 1024;
const PASS_ROWS = 128;
const targets = [
  { table: "events", column: "data", key: "id" },
  { table: "retained_event_outputs", column: "value", key: "event_id" },
  { table: "prompt_history_entries", column: "input", key: "id" },
  { table: "thread_search_segments", column: "text", key: "id" },
] as const;
const states = new WeakMap<
  DbConnection,
  { next: number; cursors: Map<string, string> }
>();

export function runStoredPayloadCompressionMaintenance(db: DbConnection) {
  if (!getAppSettings(db).coldEventCompression)
    return { enabled: false, rowsCompressed: 0, bytesSaved: 0 };
  let state = states.get(db);
  if (!state) {
    state = { next: 0, cursors: new Map() };
    states.set(db, state);
  }
  let consumed = 0;
  let rowsCompressed = 0;
  let bytesSaved = 0;
  for (let visited = 0; visited < targets.length; visited += 1) {
    const target = targets[state.next];
    state.next = (state.next + 1) % targets.length;
    if (!target) throw new Error("Missing payload compression target");
    const cursor = state.cursors.get(target.table) ?? "";
    const rows = db.$client
      .prepare<[string], { id: string; bytes: number }>(
        `SELECT ${target.key} AS id, octet_length(${target.column}) AS bytes
         FROM ${target.table}
         WHERE ${target.key} > ?
           AND typeof(${target.column}) = 'text'
           AND octet_length(${target.column}) >= ${STORED_TEXT_MIN_BYTES}
         ORDER BY ${target.key} LIMIT ${PASS_ROWS}`,
      )
      .all(cursor);
    if (rows.length === 0) {
      state.cursors.delete(target.table);
      continue;
    }
    const read = db.$client.prepare<[string], { value: unknown }>(
      `SELECT ${target.column} AS value FROM ${target.table} WHERE ${target.key} = ?`,
    );
    const drafts: Array<{
      id: string;
      original: string;
      payload: Buffer;
      saved: number;
    }> = [];
    for (const row of rows) {
      if (row.bytes > STORED_TEXT_MAX_BYTES) {
        state.cursors.set(target.table, row.id);
        continue;
      }
      if (consumed > 0 && consumed + row.bytes > PASS_BYTES) break;
      consumed += row.bytes;
      state.cursors.set(target.table, row.id);
      const original = read.get(row.id)?.value;
      if (typeof original !== "string") continue;
      const payload = encodeStoredText(original);
      if (payload)
        drafts.push({
          id: row.id,
          original,
          payload,
          saved: row.bytes - payload.length,
        });
    }
    const timeout = db.$client
      .prepare<[], { timeout: number }>("PRAGMA busy_timeout")
      .get()?.timeout;
    if (timeout === undefined) throw new Error("Missing SQLite busy timeout");
    db.$client.pragma("busy_timeout = 0");
    try {
      const changes = db.transaction(() => {
        const update = db.$client.prepare(
          `UPDATE ${target.table} SET ${target.column} = ?
           WHERE ${target.key} = ? AND ${target.column} = ?`,
        );
        let count = 0;
        let saved = 0;
        for (const draft of drafts) {
          if (
            update.run(draft.payload, draft.id, draft.original).changes === 1
          ) {
            count += 1;
            saved += draft.saved;
          }
        }
        return { count, saved };
      });
      rowsCompressed += changes.count;
      bytesSaved += changes.saved;
    } catch (error) {
      state.cursors.set(target.table, cursor);
      if (
        typeof error !== "object" ||
        error === null ||
        !("code" in error) ||
        error.code !== "SQLITE_BUSY"
      )
        throw error;
    } finally {
      db.$client.pragma(`busy_timeout = ${timeout}`);
    }
    if (consumed >= PASS_BYTES || drafts.length > 0) break;
  }
  return { enabled: true, rowsCompressed, bytesSaved };
}
