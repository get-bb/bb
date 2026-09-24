// bb-fork(parent-mute): keep migration 0131 replay-safe for legacy databases
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { DbConnection } from "./connection.js";

const MIGRATION_TAG = "0131_cute_praxagora";
const MUTED_AT_COLUMN = "parent_notifications_muted_at";
const STAGED_MUTED_AT_COLUMN = "_bb_parent_notifications_muted_at_pending";
const JOURNAL_PATH = "meta/_journal.json";

function tableExists(db: DbConnection, tableName: string): boolean {
  return (
    db.$client
      .prepare<
        [string],
        { name: string }
      >("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(tableName) !== undefined
  );
}

function columnExists(
  db: DbConnection,
  tableName: string,
  columnName: string,
): boolean {
  const rows = db.$client.pragma(`table_info(${tableName})`);
  if (!Array.isArray(rows)) {
    return false;
  }
  return rows.some((row) => (row as { name?: unknown }).name === columnName);
}

function migrationCreatedAt(migrationsFolder: string): number | null {
  const journal: unknown = JSON.parse(
    readFileSync(resolve(migrationsFolder, JOURNAL_PATH), "utf-8"),
  );
  const entries = (journal as { entries?: readonly unknown[] }).entries;
  if (!Array.isArray(entries)) {
    return null;
  }
  const entry = entries.find(
    (candidate) => (candidate as { tag?: unknown }).tag === MIGRATION_TAG,
  );
  const when = (entry as { when?: unknown } | undefined)?.when;
  return typeof when === "number" ? when : null;
}

function readAppliedMigrationCreatedAts(db: DbConnection): Set<number> {
  if (!tableExists(db, "__drizzle_migrations")) {
    return new Set();
  }
  const rows = db.$client
    .prepare<
      [],
      { createdAt: number | null }
    >("SELECT created_at AS createdAt FROM __drizzle_migrations WHERE created_at IS NOT NULL")
    .all();
  return new Set(
    rows
      .map((row) => row.createdAt)
      .filter((createdAt): createdAt is number => createdAt !== null),
  );
}

export function stageExistingParentNotificationsMutedAtColumn(
  db: DbConnection,
  migrationsFolder: string,
): boolean {
  if (
    !tableExists(db, "__drizzle_migrations") ||
    !tableExists(db, "threads") ||
    !columnExists(db, "threads", MUTED_AT_COLUMN)
  ) {
    return false;
  }
  const createdAt = migrationCreatedAt(migrationsFolder);
  if (createdAt === null || readAppliedMigrationCreatedAts(db).has(createdAt)) {
    return false;
  }
  db.$client.exec(
    `ALTER TABLE threads RENAME COLUMN ${MUTED_AT_COLUMN} TO ${STAGED_MUTED_AT_COLUMN}`,
  );
  return true;
}

export function restoreStagedParentNotificationsMutedAtColumn(
  db: DbConnection,
): void {
  if (!columnExists(db, "threads", STAGED_MUTED_AT_COLUMN)) {
    return;
  }
  if (!columnExists(db, "threads", MUTED_AT_COLUMN)) {
    db.$client.exec(
      `ALTER TABLE threads RENAME COLUMN ${STAGED_MUTED_AT_COLUMN} TO ${MUTED_AT_COLUMN}`,
    );
    return;
  }
  db.$client.exec(
    `UPDATE threads SET ${MUTED_AT_COLUMN} = ${STAGED_MUTED_AT_COLUMN};
     ALTER TABLE threads DROP COLUMN ${STAGED_MUTED_AT_COLUMN};`,
  );
}
