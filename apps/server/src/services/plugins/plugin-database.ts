import { mkdirSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";

export function openPluginDatabase(
  dataDir: string,
  pluginId: string,
): Database.Database {
  const dir = join(dataDir, "plugins", pluginId);
  mkdirSync(dir, { recursive: true });
  const database = new Database(join(dir, "data.db"));
  database.pragma("auto_vacuum = INCREMENTAL");
  database.pragma("journal_mode = WAL");
  database.pragma("busy_timeout = 5000");
  return database;
}
