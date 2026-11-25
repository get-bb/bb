import type { BbPluginApi } from "@get-bb/plugin-sdk";

const MIGRATIONS = [
  "CREATE TABLE scans (host_id TEXT PRIMARY KEY, result_json TEXT NOT NULL)",
  "CREATE TABLE archive_cleanup (thread_id TEXT PRIMARY KEY, archived_at INTEGER NOT NULL)",
  "ALTER TABLE archive_cleanup ADD COLUMN failure_count INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE archive_cleanup ADD COLUMN next_attempt_at INTEGER NOT NULL DEFAULT 0",
  `CREATE TABLE cold_threads (
    thread_id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    title TEXT,
    provider_id TEXT NOT NULL,
    thread_created_at INTEGER NOT NULL,
    archived_at INTEGER,
    requested_at INTEGER NOT NULL,
    stored_at INTEGER,
    file_bytes INTEGER
  )`,
  "CREATE INDEX cold_threads_stored_at_idx ON cold_threads (stored_at)",
  "ALTER TABLE cold_threads ADD COLUMN linked_thread_ids TEXT NOT NULL DEFAULT '[]'",
];

export function openPluginDatabase(bb: BbPluginApi) {
  const db = bb.storage.database();
  bb.storage.migrate(db, MIGRATIONS);
  return db;
}
