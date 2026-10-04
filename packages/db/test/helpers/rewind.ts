import type { DbConnection } from "../../src/index.js";

export function dropPluginEnabledFollowsDefaultColumn(db: DbConnection): void {
  db.$client.exec("DROP TABLE IF EXISTS plugin_timeline_events");
  const queuedColumns = db.$client
    .prepare<[], { name: string }>("PRAGMA table_info(queued_thread_messages)")
    .all();
  if (queuedColumns.some((column) => column.name === "timeline_event_json")) {
    db.$client.exec(
      "ALTER TABLE queued_thread_messages DROP COLUMN timeline_event_json",
    );
  }
  const columns = db.$client
    .prepare<[], { name: string }>("PRAGMA table_info(plugins)")
    .all();
  if (columns.some((column) => column.name === "enabled_follows_default")) {
    db.$client.exec("ALTER TABLE plugins DROP COLUMN enabled_follows_default");
  }
}
