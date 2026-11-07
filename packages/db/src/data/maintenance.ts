import type Database from "better-sqlite3";
import { and, count, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import type { DbConnection } from "../connection.js";
import {
  environments,
  pendingInteractions,
  projects,
  threads,
} from "../schema.js";
import { runWithMaintenanceBusyTimeout } from "../sqlite-maintenance.js";

export const ACTIVE_THREAD_STATUSES = ["active", "starting"] as const;
export const ACTIVE_PENDING_INTERACTION_STATUSES = [
  "pending",
  "resolving",
] as const;

interface CountRow {
  value: number;
}

interface ForeignKeysRow {
  foreign_keys: number;
}

interface SqliteTableNameRow {
  name: string;
}

export interface DatabaseMaintenanceActivity {
  activeEnvironmentProvisioningCount: number;
  activePendingInteractionCount: number;
  activeProjectDeletionCount: number;
  activeThreadCount: number;
  activeThreadProvisioningCount: number;
}

export interface DropDeferredLegacyTablesResult {
  droppedTables: string[];
}

const DEFERRED_LEGACY_TABLE_NAMES = [
  "client_turn_requests",
  "environment_operations",
  "host_daemon_command_attempts",
  "host_daemon_commands",
  "project_operations",
  "thread_operations",
] as const;
const DEFERRED_LEGACY_TABLE_NAME_SET = new Set<string>(
  DEFERRED_LEGACY_TABLE_NAMES,
);
const DEFERRED_LEGACY_TABLE_NAME_LIST_SQL = DEFERRED_LEGACY_TABLE_NAMES.map(
  quoteSqlString,
).join(", ");

function quoteSqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function quoteSqlIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function countValue(row: CountRow | undefined): number {
  return row?.value ?? 0;
}

function readForeignKeysEnabled(client: Database.Database): boolean {
  return (
    client.prepare<[], ForeignKeysRow>("PRAGMA foreign_keys").get()
      ?.foreign_keys === 1
  );
}

export function getDatabaseMaintenanceActivity(
  db: DbConnection,
): DatabaseMaintenanceActivity {
  const activeThreadCount = countValue(
    db
      .select({ value: count() })
      .from(threads)
      .where(
        and(
          inArray(threads.status, [...ACTIVE_THREAD_STATUSES]),
          isNull(threads.deletedAt),
        ),
      )
      .get(),
  );
  const activeProjectDeletionCount = countValue(
    db
      .select({ value: count() })
      .from(projects)
      .where(isNotNull(projects.deletedAt))
      .get(),
  );
  const activeEnvironmentProvisioningCount = countValue(
    db
      .select({ value: count() })
      .from(environments)
      .where(eq(environments.status, "provisioning"))
      .get(),
  );
  const activeThreadProvisioningCount = countValue(
    db
      .select({ value: count() })
      .from(threads)
      .where(eq(threads.status, "starting"))
      .get(),
  );
  const activePendingInteractionCount = countValue(
    db
      .select({ value: count() })
      .from(pendingInteractions)
      .where(
        inArray(pendingInteractions.status, [
          ...ACTIVE_PENDING_INTERACTION_STATUSES,
        ]),
      )
      .get(),
  );

  return {
    activeEnvironmentProvisioningCount,
    activePendingInteractionCount,
    activeProjectDeletionCount,
    activeThreadCount,
    activeThreadProvisioningCount,
  };
}

export function isDatabaseMaintenanceIdle(
  activity: DatabaseMaintenanceActivity,
): boolean {
  return (
    activity.activeEnvironmentProvisioningCount === 0 &&
    activity.activePendingInteractionCount === 0 &&
    activity.activeProjectDeletionCount === 0 &&
    activity.activeThreadCount === 0 &&
    activity.activeThreadProvisioningCount === 0
  );
}

export function listDeferredLegacyTables(db: DbConnection): string[] {
  return db.$client
    .prepare<[], SqliteTableNameRow>(
      `
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
          AND name IN (${DEFERRED_LEGACY_TABLE_NAME_LIST_SQL})
        ORDER BY name
      `,
    )
    .all()
    .map((row) => row.name)
    .filter((name) => DEFERRED_LEGACY_TABLE_NAME_SET.has(name));
}

export function dropDeferredLegacyTables(
  db: DbConnection,
): DropDeferredLegacyTablesResult {
  return runWithMaintenanceBusyTimeout({
    client: db.$client,
    work: () => {
      const droppedTables = listDeferredLegacyTables(db);
      if (droppedTables.length === 0) {
        return { droppedTables };
      }

      const foreignKeysEnabled = readForeignKeysEnabled(db.$client);
      db.$client.pragma("foreign_keys = OFF");
      try {
        for (const tableName of droppedTables) {
          db.$client.prepare(
            `DROP TABLE IF EXISTS ${quoteSqlIdentifier(tableName)}`,
          ).run();
        }
      } finally {
        db.$client.pragma(
          `foreign_keys = ${foreignKeysEnabled ? "ON" : "OFF"}`,
        );
      }

      return { droppedTables };
    },
  });
}

