import type { BbPluginApi } from "@get-bb/plugin-sdk";

const MIGRATIONS = [
  "CREATE TABLE scans (host_id TEXT PRIMARY KEY, result_json TEXT NOT NULL)",
  "CREATE TABLE archive_cleanup (thread_id TEXT PRIMARY KEY, archived_at INTEGER NOT NULL)",
  "ALTER TABLE archive_cleanup ADD COLUMN failure_count INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE archive_cleanup ADD COLUMN next_attempt_at INTEGER NOT NULL DEFAULT 0",
  `CREATE TABLE saved_threads (
    thread_id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    title TEXT,
    provider_id TEXT NOT NULL,
    thread_created_at INTEGER NOT NULL,
    archived_at INTEGER,
    requested_at INTEGER NOT NULL,
    saved_at INTEGER,
    file BLOB,
    file_bytes INTEGER
  )`,
  "CREATE INDEX saved_threads_saved_at_idx ON saved_threads (saved_at)",
];

export function openPluginDatabase(bb: BbPluginApi) {
  const db = bb.storage.database();
  bb.storage.migrate(db, MIGRATIONS);
  return db;
}
